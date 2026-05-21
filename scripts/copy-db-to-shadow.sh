#!/bin/bash
# =============================================================================
# Copy Production Database to Shadow Environment
# =============================================================================
#
# PURPOSE:
# Copies the dev/production database to the shadow environment for testing
# UDM v2 migration changes. Uses pg_dump/pg_restore for flexibility.
#
# PREREQUISITES:
# - AWS CLI configured with appropriate credentials
# - psql and pg_dump installed (via postgresql client)
# - Network access to both Aurora clusters (via VPN or bastion)
#
# USAGE:
# ./scripts/copy-db-to-shadow.sh
#
# ENVIRONMENT VARIABLES (optional overrides):
# DEV_DB_HOST, DEV_DB_USER, DEV_DB_PASS, DEV_DB_NAME
# SHADOW_DB_HOST, SHADOW_DB_USER, SHADOW_DB_PASS, SHADOW_DB_NAME
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# =============================================================================
# Fetch Database Credentials from SSM
# =============================================================================
fetch_credentials() {
    log_info "Fetching database credentials from AWS SSM..."

    # Dev (source) database
    DEV_DB_HOST="${DEV_DB_HOST:-$(aws ssm get-parameter --name "/ship/dev/DB_HOST" --query "Parameter.Value" --output text)}"
    DEV_DB_USER="${DEV_DB_USER:-$(aws ssm get-parameter --name "/ship/dev/DB_USERNAME" --query "Parameter.Value" --output text)}"
    DEV_DB_PASS="${DEV_DB_PASS:-$(aws ssm get-parameter --name "/ship/dev/DB_PASSWORD" --with-decryption --query "Parameter.Value" --output text)}"
    DEV_DB_NAME="${DEV_DB_NAME:-$(aws ssm get-parameter --name "/ship/dev/DB_NAME" --query "Parameter.Value" --output text)}"

    # Shadow (target) database
    SHADOW_DB_HOST="${SHADOW_DB_HOST:-$(aws ssm get-parameter --name "/ship/shadow/DB_HOST" --query "Parameter.Value" --output text)}"
    SHADOW_DB_USER="${SHADOW_DB_USER:-$(aws ssm get-parameter --name "/ship/shadow/DB_USERNAME" --query "Parameter.Value" --output text)}"
    SHADOW_DB_PASS="${SHADOW_DB_PASS:-$(aws ssm get-parameter --name "/ship/shadow/DB_PASSWORD" --with-decryption --query "Parameter.Value" --output text)}"
    SHADOW_DB_NAME="${SHADOW_DB_NAME:-$(aws ssm get-parameter --name "/ship/shadow/DB_NAME" --query "Parameter.Value" --output text)}"

    log_success "Credentials fetched successfully"
    echo ""
    log_info "Source (dev): $DEV_DB_HOST / $DEV_DB_NAME"
    log_info "Target (shadow): $SHADOW_DB_HOST / $SHADOW_DB_NAME"
}

# =============================================================================
# Test Database Connections
# =============================================================================
test_connections() {
    log_info "Testing database connections..."

    # Test dev connection
    if PGPASSWORD="$DEV_DB_PASS" psql -h "$DEV_DB_HOST" -U "$DEV_DB_USER" -d "$DEV_DB_NAME" -c "SELECT 1;" > /dev/null 2>&1; then
        log_success "Dev database connection successful"
    else
        log_error "Cannot connect to dev database"
        exit 1
    fi

    # Test shadow connection
    if PGPASSWORD="$SHADOW_DB_PASS" psql -h "$SHADOW_DB_HOST" -U "$SHADOW_DB_USER" -d "$SHADOW_DB_NAME" -c "SELECT 1;" > /dev/null 2>&1; then
        log_success "Shadow database connection successful"
    else
        log_error "Cannot connect to shadow database"
        exit 1
    fi
}

# =============================================================================
# Dump Dev Database
# =============================================================================
dump_dev_database() {
    local DUMP_FILE="${1:-/tmp/ship_dev_dump.sql}"

    log_info "Dumping dev database to $DUMP_FILE..."
    log_warn "This may take several minutes depending on database size..."

    PGPASSWORD="$DEV_DB_PASS" pg_dump \
        -h "$DEV_DB_HOST" \
        -U "$DEV_DB_USER" \
        -d "$DEV_DB_NAME" \
        --no-owner \
        --no-acl \
        --clean \
        --if-exists \
        -F p \
        -f "$DUMP_FILE"

    local DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
    log_success "Dump complete: $DUMP_FILE ($DUMP_SIZE)"
}

# =============================================================================
# Restore to Shadow Database
# =============================================================================
restore_to_shadow() {
    local DUMP_FILE="${1:-/tmp/ship_dev_dump.sql}"

    if [[ ! -f "$DUMP_FILE" ]]; then
        log_error "Dump file not found: $DUMP_FILE"
        exit 1
    fi

    log_info "Restoring to shadow database from $DUMP_FILE..."
    log_warn "This will OVERWRITE all data in the shadow database!"

    # Drop and recreate schema to ensure clean slate
    log_info "Dropping existing schema..."
    local SCHEMA_LOG
    SCHEMA_LOG="$(mktemp /tmp/ship_shadow_schema.XXXXXX.log)"
    if ! PGPASSWORD="$SHADOW_DB_PASS" psql -h "$SHADOW_DB_HOST" -U "$SHADOW_DB_USER" -d "$SHADOW_DB_NAME" -v ON_ERROR_STOP=1 -c "
        DROP SCHEMA IF EXISTS public CASCADE;
        CREATE SCHEMA public;
        GRANT ALL ON SCHEMA public TO postgres;
        GRANT ALL ON SCHEMA public TO public;
    " > "$SCHEMA_LOG" 2>&1; then
        log_error "Failed to reset shadow schema. Details:"
        sed '/NOTICE:/d' "$SCHEMA_LOG" >&2
        exit 1
    fi

    log_info "Restoring data..."
    local RESTORE_LOG
    RESTORE_LOG="$(mktemp /tmp/ship_shadow_restore.XXXXXX.log)"
    if ! PGPASSWORD="$SHADOW_DB_PASS" psql \
        -h "$SHADOW_DB_HOST" \
        -U "$SHADOW_DB_USER" \
        -d "$SHADOW_DB_NAME" \
        -v ON_ERROR_STOP=1 \
        -f "$DUMP_FILE" \
        --quiet > "$RESTORE_LOG" 2>&1; then
        log_error "Restore failed. Details:"
        sed '/NOTICE:/d' "$RESTORE_LOG" >&2
        exit 1
    fi

    log_info "Restore command completed; verifying copied data next"
}

# =============================================================================
# Verify Data Copy
# =============================================================================
verify_copy() {
    log_info "Verifying data copy..."

    # Get row counts from both databases
    local DEV_USERS
    local SHADOW_USERS
    local DEV_DOCS
    local SHADOW_DOCS

    DEV_USERS=$(PGPASSWORD="$DEV_DB_PASS" psql -h "$DEV_DB_HOST" -U "$DEV_DB_USER" -d "$DEV_DB_NAME" -v ON_ERROR_STOP=1 -t -c "SELECT COUNT(*) FROM users;" | tr -d ' ')
    SHADOW_USERS=$(PGPASSWORD="$SHADOW_DB_PASS" psql -h "$SHADOW_DB_HOST" -U "$SHADOW_DB_USER" -d "$SHADOW_DB_NAME" -v ON_ERROR_STOP=1 -t -c "SELECT COUNT(*) FROM users;" | tr -d ' ')

    DEV_DOCS=$(PGPASSWORD="$DEV_DB_PASS" psql -h "$DEV_DB_HOST" -U "$DEV_DB_USER" -d "$DEV_DB_NAME" -v ON_ERROR_STOP=1 -t -c "SELECT COUNT(*) FROM documents;" | tr -d ' ')
    SHADOW_DOCS=$(PGPASSWORD="$SHADOW_DB_PASS" psql -h "$SHADOW_DB_HOST" -U "$SHADOW_DB_USER" -d "$SHADOW_DB_NAME" -v ON_ERROR_STOP=1 -t -c "SELECT COUNT(*) FROM documents;" | tr -d ' ')

    echo ""
    echo "=== Data Verification ==="
    echo "Users:     Dev=$DEV_USERS  Shadow=$SHADOW_USERS"
    echo "Documents: Dev=$DEV_DOCS  Shadow=$SHADOW_DOCS"
    echo ""

    if [[ "$DEV_USERS" == "$SHADOW_USERS" ]] && [[ "$DEV_DOCS" == "$SHADOW_DOCS" ]]; then
        log_success "Data verification passed - counts match"
    else
        log_error "Data verification failed - copied counts do not match"
        exit 1
    fi
}

# =============================================================================
# Check Specific User
# =============================================================================
check_user() {
    local EMAIL="${1:-shawn.jones@treasury.gov}"

    log_info "Checking for user: $EMAIL"

    PGPASSWORD="$SHADOW_DB_PASS" psql -h "$SHADOW_DB_HOST" -U "$SHADOW_DB_USER" -d "$SHADOW_DB_NAME" -c "
        SELECT id, email, name,
               CASE WHEN password_hash IS NOT NULL THEN 'SET' ELSE 'NULL' END as password_status,
               created_at
        FROM users
        WHERE LOWER(email) = LOWER('$EMAIL');
    "
}

# =============================================================================
# Run Migrations
# =============================================================================
run_migrations() {
    log_info "Running database migrations on shadow..."

    cd "$PROJECT_ROOT"

    # Set environment for shadow database
    export DATABASE_URL="postgresql://$SHADOW_DB_USER:$SHADOW_DB_PASS@$SHADOW_DB_HOST:5432/$SHADOW_DB_NAME"

    # Run migrations via the API migrate script
    if [[ -f "$PROJECT_ROOT/api/src/db/migrate.ts" ]]; then
        cd "$PROJECT_ROOT/api"
        npx tsx src/db/migrate.ts
        log_success "Migrations complete"
    else
        log_warn "Migration script not found, skipping..."
    fi
}

# =============================================================================
# Main
# =============================================================================
main() {
    echo ""
    echo "=========================================="
    echo "  Ship Database Copy: Dev -> Shadow"
    echo "=========================================="
    echo ""

    local DUMP_FILE="/tmp/ship_dev_dump_$(date +%Y%m%d_%H%M%S).sql"

    # Parse arguments
    local SKIP_DUMP=false
    local SKIP_RESTORE=false
    local SKIP_MIGRATIONS=false
    local EXISTING_DUMP=""

    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-dump)
                SKIP_DUMP=true
                shift
                ;;
            --skip-restore)
                SKIP_RESTORE=true
                shift
                ;;
            --skip-migrations)
                SKIP_MIGRATIONS=true
                shift
                ;;
            --use-dump)
                EXISTING_DUMP="$2"
                SKIP_DUMP=true
                shift 2
                ;;
            --verify-only)
                fetch_credentials
                test_connections
                verify_copy
                check_user
                exit 0
                ;;
            --help)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --skip-dump        Skip dumping dev database (use existing dump)"
                echo "  --skip-restore     Skip restore step"
                echo "  --skip-migrations  Skip running migrations"
                echo "  --use-dump FILE    Use existing dump file"
                echo "  --verify-only      Only verify data and check user"
                echo "  --help             Show this help"
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    if [[ -n "$EXISTING_DUMP" ]]; then
        DUMP_FILE="$EXISTING_DUMP"
    fi

    # Execute steps
    fetch_credentials
    test_connections

    if [[ "$SKIP_DUMP" != "true" ]]; then
        dump_dev_database "$DUMP_FILE"
    else
        log_info "Skipping dump step"
    fi

    if [[ "$SKIP_RESTORE" != "true" ]]; then
        restore_to_shadow "$DUMP_FILE"
    else
        log_info "Skipping restore step"
    fi

    verify_copy

    if [[ "$SKIP_MIGRATIONS" != "true" ]]; then
        run_migrations
    else
        log_info "Skipping migrations step"
    fi

    check_user "shawn.jones@treasury.gov"

    echo ""
    log_success "Database copy complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Deploy the API to shadow: ./scripts/deploy-api.sh shadow"
    echo "  2. Test login at: https://shadow.ship.awsdev.treasury.gov"
    echo ""
}

main "$@"
