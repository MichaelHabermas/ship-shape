#!/bin/bash
# =============================================================================
# Copy Database via SSM Port Forwarding
# =============================================================================
# Uses SSM Session Manager to create port forwards and copy data
# =============================================================================

set -euo pipefail

export PATH="/opt/homebrew/opt/libpq/bin:/usr/local/sessionmanagerplugin/bin:$PATH"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Cleanup function
cleanup() {
    log_info "Cleaning up port forwarding sessions..."
    pkill -f "session-manager-plugin" 2>/dev/null || true
}
trap cleanup EXIT

# Configuration
BASTION_INSTANCE="i-042fb0a1194dbfe8b"  # fpki-dev-test-app in the same VPC
DEV_HOST="ship-dev-aurora.cluster-cah0qe8uir1k.us-east-1.rds.amazonaws.com"
SHADOW_HOST="ship-shadow-aurora.cluster-cah0qe8uir1k.us-east-1.rds.amazonaws.com"
DEV_LOCAL_PORT=15432
SHADOW_LOCAL_PORT=15433

log_info "Fetching credentials..."
DEV_PASS=$(aws ssm get-parameter --name "/ship/dev/DB_PASSWORD" --with-decryption --query "Parameter.Value" --output text)
SHADOW_PASS=$(aws ssm get-parameter --name "/ship/shadow/DB_PASSWORD" --with-decryption --query "Parameter.Value" --output text)
log_success "Credentials retrieved"

# Start port forwarding to DEV
log_info "Starting port forward to dev database (localhost:$DEV_LOCAL_PORT -> $DEV_HOST:5432)..."
aws ssm start-session --target "$BASTION_INSTANCE" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$DEV_HOST\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$DEV_LOCAL_PORT\"]}" \
  > /tmp/ssm_dev.log 2>&1 &
DEV_PID=$!

# Start port forwarding to SHADOW
log_info "Starting port forward to shadow database (localhost:$SHADOW_LOCAL_PORT -> $SHADOW_HOST:5432)..."
aws ssm start-session --target "$BASTION_INSTANCE" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$SHADOW_HOST\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"$SHADOW_LOCAL_PORT\"]}" \
  > /tmp/ssm_shadow.log 2>&1 &
SHADOW_PID=$!

log_info "Waiting for port forwards to establish..."
sleep 10

# Verify port forwards are running
if ! ps -p $DEV_PID > /dev/null 2>&1; then
    log_error "Dev port forward failed to start"
    cat /tmp/ssm_dev.log
    exit 1
fi

if ! ps -p $SHADOW_PID > /dev/null 2>&1; then
    log_error "Shadow port forward failed to start"
    cat /tmp/ssm_shadow.log
    exit 1
fi

log_success "Both port forwards running"

# Test connections
log_info "Testing dev database connection..."
if ! PGPASSWORD="$DEV_PASS" psql -h localhost -p $DEV_LOCAL_PORT -U postgres -d ship_main -c "SELECT 1" > /dev/null 2>&1; then
    log_error "Cannot connect to dev database"
    exit 1
fi
log_success "Dev database connected"

log_info "Testing shadow database connection..."
if ! PGPASSWORD="$SHADOW_PASS" psql -h localhost -p $SHADOW_LOCAL_PORT -U postgres -d ship_main -c "SELECT 1" > /dev/null 2>&1; then
    log_error "Cannot connect to shadow database"
    exit 1
fi
log_success "Shadow database connected"

# Get current counts
log_info "Current database stats:"
echo "Dev users: $(PGPASSWORD="$DEV_PASS" psql -h localhost -p $DEV_LOCAL_PORT -U postgres -d ship_main -t -c "SELECT COUNT(*) FROM users")"
echo "Dev documents: $(PGPASSWORD="$DEV_PASS" psql -h localhost -p $DEV_LOCAL_PORT -U postgres -d ship_main -t -c "SELECT COUNT(*) FROM documents")"
echo "Shadow users: $(PGPASSWORD="$SHADOW_PASS" psql -h localhost -p $SHADOW_LOCAL_PORT -U postgres -d ship_main -t -c "SELECT COUNT(*) FROM users")"
echo "Shadow documents: $(PGPASSWORD="$SHADOW_PASS" psql -h localhost -p $SHADOW_LOCAL_PORT -U postgres -d ship_main -t -c "SELECT COUNT(*) FROM documents")"

# Dump dev database
DUMP_FILE="/tmp/ship_dev_dump_$(date +%Y%m%d_%H%M%S).sql"
log_info "Dumping dev database to $DUMP_FILE..."
log_warn "This may take several minutes..."

PGPASSWORD="$DEV_PASS" pg_dump \
    -h localhost \
    -p $DEV_LOCAL_PORT \
    -U postgres \
    -d ship_main \
    --no-owner \
    --no-acl \
    --clean \
    --if-exists \
    -F p \
    -f "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
log_success "Dump complete: $DUMP_FILE ($DUMP_SIZE)"

# Clear shadow database
log_info "Clearing shadow database..."
SCHEMA_LOG="$(mktemp /tmp/ship_shadow_schema.XXXXXX.log)"
if ! PGPASSWORD="$SHADOW_PASS" psql -h localhost -p $SHADOW_LOCAL_PORT -U postgres -d ship_main -v ON_ERROR_STOP=1 -c "
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO postgres;
    GRANT ALL ON SCHEMA public TO public;
" > "$SCHEMA_LOG" 2>&1; then
    log_error "Failed to reset shadow schema. Details:"
    sed '/NOTICE:/d' "$SCHEMA_LOG" >&2
    exit 1
fi

# Restore to shadow
log_info "Restoring to shadow database..."
log_warn "This may take several minutes..."

RESTORE_LOG="$(mktemp /tmp/ship_shadow_restore.XXXXXX.log)"
if ! PGPASSWORD="$SHADOW_PASS" psql \
    -h localhost \
    -p $SHADOW_LOCAL_PORT \
    -U postgres \
    -d ship_main \
    -v ON_ERROR_STOP=1 \
    -f "$DUMP_FILE" \
    --quiet > "$RESTORE_LOG" 2>&1; then
    log_error "Restore failed. Details:"
    sed '/NOTICE:/d' "$RESTORE_LOG" >&2
    exit 1
fi

log_info "Restore command completed; verifying copied data next"

# Verify
log_info "Verifying data copy..."
DEV_USERS=$(PGPASSWORD="$DEV_PASS" psql -h localhost -p $DEV_LOCAL_PORT -U postgres -d ship_main -t -c "SELECT COUNT(*) FROM users" | tr -d ' ')
SHADOW_USERS=$(PGPASSWORD="$SHADOW_PASS" psql -h localhost -p $SHADOW_LOCAL_PORT -U postgres -d ship_main -t -c "SELECT COUNT(*) FROM users" | tr -d ' ')
DEV_DOCS=$(PGPASSWORD="$DEV_PASS" psql -h localhost -p $DEV_LOCAL_PORT -U postgres -d ship_main -t -c "SELECT COUNT(*) FROM documents" | tr -d ' ')
SHADOW_DOCS=$(PGPASSWORD="$SHADOW_PASS" psql -h localhost -p $SHADOW_LOCAL_PORT -U postgres -d ship_main -t -c "SELECT COUNT(*) FROM documents" | tr -d ' ')

echo ""
echo "=== Verification ==="
echo "Users:     Dev=$DEV_USERS  Shadow=$SHADOW_USERS"
echo "Documents: Dev=$DEV_DOCS  Shadow=$SHADOW_DOCS"
echo ""

if [[ "$DEV_USERS" == "$SHADOW_USERS" ]] && [[ "$DEV_DOCS" == "$SHADOW_DOCS" ]]; then
    log_success "Data verification passed - counts match"
else
    log_error "Data verification failed - copied counts do not match"
    exit 1
fi

# Check for specific user
log_info "Checking for shawn.jones@treasury.gov..."
PGPASSWORD="$SHADOW_PASS" psql -h localhost -p $SHADOW_LOCAL_PORT -U postgres -d ship_main -c "
    SELECT id, email, name,
           CASE WHEN password_hash IS NOT NULL THEN 'SET' ELSE 'NULL' END as password_status
    FROM users
    WHERE LOWER(email) = LOWER('shawn.jones@treasury.gov');
"

log_success "Database copy complete!"
echo ""
echo "Dump file saved at: $DUMP_FILE"
echo ""
echo "Next steps:"
echo "  1. Run migrations: DATABASE_URL=\$(aws ssm get-parameter --name '/ship/shadow/DATABASE_URL' --with-decryption --query 'Parameter.Value' --output text) && cd api && npx tsx src/db/migrate.ts"
echo "  2. Deploy API: ./scripts/deploy-api.sh shadow"
echo "  3. Test at: https://shadow.ship.awsdev.treasury.gov"
