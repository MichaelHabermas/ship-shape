#!/bin/bash
# Dev server wrapper that finds available ports for multi-worktree development
#
# Strategy:
# 1. Scan actual port usage (not files) to find what's in use
# 2. Pick first available port pair (API: 3000+, Web: 5173+)
# 3. Write .ports file for reference (which worktree is where)
# 4. Start dev servers with those ports

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Ensure api/.env.local exists
if [ ! -f "$ROOT_DIR/api/.env.local" ]; then
  # Derive database name from worktree/directory name
  WORKTREE_NAME=$(basename "$ROOT_DIR")
  # Convert to valid postgres db name (lowercase, replace non-alphanumeric with _)
  DB_NAME="ship_$(echo "$WORKTREE_NAME" | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '_' | sed 's/_*$//')"

  echo "Creating api/.env.local with DATABASE_URL for $DB_NAME..."

  # Check if database exists, create if not
  NEEDS_SEED=false
  if ! psql -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    echo "Creating database $DB_NAME..."
    createdb "$DB_NAME" 2>/dev/null || {
      echo "ERROR: Could not create database $DB_NAME"
      echo "Please create it manually: createdb $DB_NAME"
      exit 1
    }
    NEEDS_SEED=true
  fi

  cat > "$ROOT_DIR/api/.env.local" << EOF
DATABASE_URL=postgresql://localhost/$DB_NAME
SESSION_SECRET=dev-secret-change-in-production
EOF
  echo "Created api/.env.local"

  # Setup fresh database (schema + seed)
  if [ "$NEEDS_SEED" = true ]; then
    echo "Setting up fresh database..."
    cd "$ROOT_DIR"

    # Ensure dependencies are installed
    if [ ! -d "node_modules" ]; then
      echo "Installing dependencies..."
      pnpm install
    fi

    pnpm build:shared

    # Run migrations (applies schema.sql + all migrations), then seed
    cd "$ROOT_DIR/api"
    DATABASE_URL="postgresql://localhost/$DB_NAME" npx tsx src/db/migrate.ts
    DATABASE_URL="postgresql://localhost/$DB_NAME" npx tsx src/db/seed.ts
    DATABASE_URL="postgresql://localhost/$DB_NAME" npx tsx src/scripts/fleetgraph-demo.ts
    cd "$ROOT_DIR"
    echo "Database setup complete!"
  fi
fi

read_database_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    echo "$DATABASE_URL"
    return 0
  fi

  if [ -f "$ROOT_DIR/api/.env.local" ]; then
    grep -E '^DATABASE_URL=' "$ROOT_DIR/api/.env.local" | tail -n 1 | cut -d= -f2-
  fi
}

database_is_ready() {
  local database_url="$1"

  if [ -z "$database_url" ]; then
    return 1
  fi

  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -d "$database_url" >/dev/null 2>&1
    return $?
  fi

  psql "$database_url" -c 'select 1' >/dev/null 2>&1
}

database_url_with_port() {
  local database_url="$1"
  local port="$2"

  node -e '
    const url = new URL(process.argv[1]);
    url.hostname = "localhost";
    url.port = process.argv[2];
    console.log(url.toString());
  ' "$database_url" "$port"
}

detect_docker_postgres_port() {
  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi

  local port
  port="$(docker port ship-shape-postgres-1 5432/tcp 2>/dev/null | sed -E 's/.*:([0-9]+)$/\1/' | head -n 1)"
  if [ -n "$port" ]; then
    echo "$port"
    return 0
  fi

  port="$(docker compose -f "$ROOT_DIR/docker-compose.yml" port postgres 5432 2>/dev/null | sed -E 's/.*:([0-9]+)$/\1/' | head -n 1)"
  if [ -n "$port" ]; then
    echo "$port"
    return 0
  fi

  return 1
}

configure_database_url() {
  local configured_url
  configured_url="$(read_database_url)"

  if database_is_ready "$configured_url"; then
    export DATABASE_URL="$configured_url"
    echo "Database ready: $DATABASE_URL"
    return 0
  fi

  local docker_port
  docker_port="$(detect_docker_postgres_port || true)"
  if [ -n "$docker_port" ]; then
    local docker_url
    docker_url="$(database_url_with_port "$configured_url" "$docker_port")"

    if database_is_ready "$docker_url"; then
      export DATABASE_URL="$docker_url"
      echo "Database ready via Docker port $docker_port: $DATABASE_URL"
      return 0
    fi
  fi

  echo "Database unavailable. PostgreSQL is not reachable from DATABASE_URL."
  echo "Checked: ${configured_url:-<unset>}"
  if [ -n "${docker_port:-}" ]; then
    echo "Also checked Docker Postgres port: $docker_port"
  fi
  echo "Start local Postgres or run pnpm docker:up."
  return 1
}

configure_database_url

# Base ports
API_BASE=3000
WEB_BASE=5173

# Find an available port starting from base
find_available_port() {
  local base=$1
  local port=$base
  local max_attempts=20

  for ((i=0; i<max_attempts; i++)); do
    if ! lsof -i:$port >/dev/null 2>&1; then
      echo $port
      return 0
    fi
    ((port++))
  done

  echo "ERROR: Could not find available port after $max_attempts attempts (starting from $base)" >&2
  return 1
}

# Find available ports
echo "Finding available ports..."
API_PORT=$(find_available_port $API_BASE)
WEB_PORT=$(find_available_port $WEB_BASE)

echo "Using API port: $API_PORT"
echo "Using Web port: $WEB_PORT"

# Write .ports file for reference
cat > "$ROOT_DIR/.ports" << EOF
# Auto-generated by scripts/dev.sh
# This file shows which ports this worktree's dev server is using
# DO NOT EDIT - will be overwritten on next dev start
API=$API_PORT
WEB=$WEB_PORT
STARTED=$(date -Iseconds)
WORKTREE=$(basename "$ROOT_DIR")
EOF

echo "Wrote .ports file"

# Clean up .ports file on exit
cleanup() {
  if [ -f "$ROOT_DIR/.ports" ]; then
    rm -f "$ROOT_DIR/.ports"
    echo "Cleaned up .ports file"
  fi
}
trap cleanup EXIT INT TERM

# Export environment variables and start dev servers
export PORT=$API_PORT
export CORS_ORIGIN="http://localhost:$WEB_PORT"
export VITE_PORT=$WEB_PORT
export VITE_API_URL="http://localhost:$API_PORT"
export FLEETGRAPH_CONSOLE_TRACE="${FLEETGRAPH_CONSOLE_TRACE:-1}"

echo "Starting dev servers..."
echo "  API: http://localhost:$API_PORT"
echo "  Web: http://localhost:$WEB_PORT"
echo ""

cd "$ROOT_DIR"
# Exclude @ship/shipshape-security-console-ui — it also runs Vite on 5173 and races @ship/web.
pnpm --parallel --filter @ship/api --filter @ship/web --filter @ship/shared run dev
