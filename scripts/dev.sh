#!/bin/bash
# Dev server wrapper for stable local development ports.
#
# Strategy:
# 1. Prefer stable ports from env/.env.local, then API 3000 and Web 5173
# 2. Restart only the previous dev server recorded for this worktree
# 3. Fail loudly if another process owns the requested ports
# 4. Allow old scan-up behavior only when SHIP_DEV_ANY_PORT=1

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WORKTREE_NAME="$(basename "$ROOT_DIR")"
DEV_DIR="$ROOT_DIR/.dev"
SESSION_FILE="$DEV_DIR/session.json"

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

read_env_setting() {
  local file="$1"
  local key="$2"

  if [ -f "$file" ]; then
    grep -E "^$key=" "$file" | tail -n 1 | cut -d= -f2-
  fi
}

is_live_pid() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1
}

port_listeners() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | tr '\n' ' '
}

session_value() {
  local key="$1"

  if [ ! -f "$SESSION_FILE" ]; then
    return 0
  fi

  node -e '
    const fs = require("node:fs");
    const key = process.argv[1];
    try {
      const session = JSON.parse(fs.readFileSync(process.env.SESSION_FILE, "utf8"));
      if (session[key] !== undefined) console.log(session[key]);
    } catch {}
  ' "$key"
}

kill_pid_if_live() {
  local pid="$1"

  if is_live_pid "$pid"; then
    kill "$pid" >/dev/null 2>&1 || true
  fi
}

kill_port_listeners() {
  local port="$1"
  local pids
  pids="$(port_listeners "$port")"

  for pid in $pids; do
    kill_pid_if_live "$pid"
  done
}

wait_for_port_free() {
  local port="$1"

  for _ in {1..30}; do
    if [ -z "$(port_listeners "$port")" ]; then
      return 0
    fi
    sleep 0.1
  done

  return 1
}

restart_previous_worktree_session() {
  local previous_api=""
  local previous_web=""
  local previous_pid=""
  local previous_worktree=""

  if [ -f "$SESSION_FILE" ]; then
    previous_api="$(SESSION_FILE="$SESSION_FILE" session_value apiPort)"
    previous_web="$(SESSION_FILE="$SESSION_FILE" session_value webPort)"
    previous_pid="$(SESSION_FILE="$SESSION_FILE" session_value pid)"
    previous_worktree="$(SESSION_FILE="$SESSION_FILE" session_value rootDir)"
  elif [ -f "$ROOT_DIR/.ports" ]; then
    previous_api="$(grep -E '^API=' "$ROOT_DIR/.ports" | tail -n 1 | cut -d= -f2-)"
    previous_web="$(grep -E '^WEB=' "$ROOT_DIR/.ports" | tail -n 1 | cut -d= -f2-)"
    previous_worktree="$ROOT_DIR"
  fi

  if [ "$previous_worktree" != "$ROOT_DIR" ]; then
    return 0
  fi

  if [ -z "$previous_api" ] && [ -z "$previous_web" ] && [ -z "$previous_pid" ]; then
    return 0
  fi

  echo "Restarting previous dev session for $WORKTREE_NAME..."
  kill_pid_if_live "$previous_pid"
  [ -n "$previous_api" ] && kill_port_listeners "$previous_api"
  [ -n "$previous_web" ] && kill_port_listeners "$previous_web"
  [ -n "$previous_api" ] && wait_for_port_free "$previous_api" || true
  [ -n "$previous_web" ] && wait_for_port_free "$previous_web" || true
  rm -f "$SESSION_FILE" "$ROOT_DIR/.ports"
}

port_owner_details() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
}

claim_strict_port() {
  local label="$1"
  local port="$2"
  local listeners
  listeners="$(port_listeners "$port")"

  if [ -z "$listeners" ]; then
    echo "$port"
    return 0
  fi

  echo "ERROR: $label port $port is already in use." >&2
  echo "" >&2
  port_owner_details "$port" >&2
  echo "" >&2
  echo "Run 'pnpm dev:where' to see active Ship Shape services." >&2
  echo "Use 'pnpm dev:any-port' only when you intentionally want a parallel server." >&2
  return 1
}

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

api_env_port="$(read_env_setting "$ROOT_DIR/api/.env.local" PORT)"
web_env_port="$(read_env_setting "$ROOT_DIR/web/.env.local" VITE_PORT)"
API_BASE="${SHIP_DEV_API_PORT:-${PORT:-${api_env_port:-3000}}}"
WEB_BASE="${SHIP_DEV_WEB_PORT:-${VITE_PORT:-${web_env_port:-5173}}}"

restart_previous_worktree_session

if [ "${SHIP_DEV_ANY_PORT:-0}" = "1" ]; then
  echo "Finding available ports..."
  API_PORT=$(find_available_port "$API_BASE")
  WEB_PORT=$(find_available_port "$WEB_BASE")
else
  echo "Claiming stable ports..."
  API_PORT=$(claim_strict_port "API" "$API_BASE")
  WEB_PORT=$(claim_strict_port "Web" "$WEB_BASE")
fi

echo "Using API port: $API_PORT"
echo "Using Web port: $WEB_PORT"

mkdir -p "$DEV_DIR"

# Write .ports file for backwards compatibility with existing scripts.
cat > "$ROOT_DIR/.ports" << EOF
# Auto-generated by scripts/dev.sh
# This file shows which ports this worktree's dev server is using
# DO NOT EDIT - will be overwritten on next dev start
API=$API_PORT
WEB=$WEB_PORT
STARTED=$(date -Iseconds)
WORKTREE=$WORKTREE_NAME
ROOT=$ROOT_DIR
EOF

SESSION_FILE="$SESSION_FILE" ROOT_DIR="$ROOT_DIR" WORKTREE_NAME="$WORKTREE_NAME" API_PORT="$API_PORT" WEB_PORT="$WEB_PORT" DATABASE_URL="$DATABASE_URL" node -e '
  const fs = require("node:fs");
  const session = {
    pid: process.ppid,
    rootDir: process.env.ROOT_DIR,
    worktree: process.env.WORKTREE_NAME,
    apiPort: Number(process.env.API_PORT),
    webPort: Number(process.env.WEB_PORT),
    apiUrl: `http://localhost:${process.env.API_PORT}`,
    webUrl: `http://localhost:${process.env.WEB_PORT}`,
    databaseUrl: process.env.DATABASE_URL,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(process.env.SESSION_FILE, `${JSON.stringify(session, null, 2)}\n`);
'

echo "Wrote .ports and .dev/session.json"

cleanup() {
  rm -f "$ROOT_DIR/.ports" "$SESSION_FILE"
  echo "Cleaned up dev session files"
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
