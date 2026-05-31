#!/usr/bin/env bash
# Resolve a working local PostgreSQL DATABASE_URL (port + credentials).
# Postgres is almost always running locally; failures are usually wrong port/URL, not a stopped server.

database_url_lib_root() {
  if [ -n "${SHIP_ROOT_DIR:-}" ]; then
    echo "$SHIP_ROOT_DIR"
    return 0
  fi
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  echo "$here"
}

database_url_read_configured() {
  local root_dir
  root_dir="$(database_url_lib_root)"

  if [ -n "${DATABASE_URL:-}" ]; then
    echo "$DATABASE_URL"
    return 0
  fi

  if [ -f "$root_dir/api/.env.local" ]; then
    grep -E '^DATABASE_URL=' "$root_dir/api/.env.local" | tail -n 1 | cut -d= -f2-
  fi
}

database_url_is_ready() {
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
    url.hostname = url.hostname || "localhost";
    url.port = process.argv[2];
    console.log(url.toString());
  ' "$database_url" "$port"
}

database_url_with_database() {
  local database_url="$1"
  local database_name="$2"

  node -e '
    const url = new URL(process.argv[1]);
    url.pathname = `/${process.argv[2]}`;
    console.log(url.toString());
  ' "$database_url" "$database_name"
}

database_url_with_credentials() {
  local database_url="$1"
  local user="$2"
  local password="$3"

  node -e '
    const url = new URL(process.argv[1]);
    url.username = process.argv[2];
    url.password = process.argv[3];
    console.log(url.toString());
  ' "$database_url" "$user" "$password"
}

database_url_detect_docker_port() {
  local root_dir
  root_dir="$(database_url_lib_root)"

  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi

  local port
  port="$(docker port ship-shape-postgres-1 5432/tcp 2>/dev/null | sed -E 's/.*:([0-9]+)$/\1/' | head -n 1)"
  if [ -n "$port" ]; then
    echo "$port"
    return 0
  fi

  port="$(docker compose -f "$root_dir/docker-compose.yml" port postgres 5432 2>/dev/null | sed -E 's/.*:([0-9]+)$/\1/' | head -n 1)"
  if [ -n "$port" ]; then
    echo "$port"
    return 0
  fi

  port="$(docker compose -f "$root_dir/docker-compose.local.yml" port postgres 5432 2>/dev/null | sed -E 's/.*:([0-9]+)$/\1/' | head -n 1)"
  if [ -n "$port" ]; then
    echo "$port"
    return 0
  fi

  return 1
}

database_url_candidate_ports() {
  local docker_port configured_url port
  docker_port="$(database_url_detect_docker_port || true)"
  configured_url="$(database_url_read_configured || true)"

  if [ -n "$configured_url" ]; then
    port="$(node -e 'try { const u = new URL(process.argv[1]); console.log(u.port || "5432"); } catch { console.log("5432"); }' "$configured_url" 2>/dev/null || echo 5432)"
    echo "$port"
  fi

  if [ -n "${docker_port:-}" ]; then
    echo "$docker_port"
  fi

  printf '%s\n' 5432 5433 5434 5435 5436 15432 15433
}

database_url_resolve() {
  local database_name="${1:-ship_dev}"
  local user="${2:-ship}"
  local password="${3:-ship_dev_password}"
  local configured_url candidate tried=()

  configured_url="$(database_url_read_configured || true)"

  if [ -n "$configured_url" ]; then
    candidate="$(database_url_with_database "$configured_url" "$database_name")"
    tried+=("$candidate")
    if database_url_is_ready "$candidate"; then
      echo "$candidate"
      return 0
    fi

    if ! node -e 'const u = new URL(process.argv[1]); process.exit(u.username ? 0 : 1);' "$candidate" 2>/dev/null; then
      candidate="$(database_url_with_credentials "$candidate" "$user" "$password")"
      tried+=("$candidate")
      if database_url_is_ready "$candidate"; then
        echo "$candidate"
        return 0
      fi
    fi
  fi

  local port base_url candidate
  while IFS= read -r port; do
    [ -n "$port" ] || continue
    base_url="postgresql://${user}:${password}@localhost:${port}/${database_name}"
    tried+=("$base_url")
    if database_url_is_ready "$base_url"; then
      echo "$base_url"
      return 0
    fi
  done < <(database_url_candidate_ports | awk '!seen[$0]++')

  if [ -n "$configured_url" ]; then
    local docker_port
    docker_port="$(database_url_detect_docker_port || true)"
    if [ -n "${docker_port:-}" ]; then
      candidate="$(database_url_with_port "$configured_url" "$docker_port")"
      candidate="$(database_url_with_database "$candidate" "$database_name")"
      if ! node -e 'const u = new URL(process.argv[1]); process.exit(u.username ? 0 : 1);' "$candidate" 2>/dev/null; then
        candidate="$(database_url_with_credentials "$candidate" "$user" "$password")"
      fi
      tried+=("$candidate")
      if database_url_is_ready "$candidate"; then
        echo "$candidate"
        return 0
      fi
    fi
  fi

  {
    echo "Could not connect to PostgreSQL database '$database_name'." >&2
    echo "Postgres is usually running — check port/credentials, not whether the server is up." >&2
    echo "Tried:" >&2
    printf '  %s\n' "${tried[@]}" >&2
    echo "Hints:" >&2
    echo "  - Read api/.env.local DATABASE_URL and adjust port if Docker remapped it." >&2
    echo "  - ./scripts/resolve-database-url.sh $database_name" >&2
    echo "  - pnpm docker:up (docker-compose.yml :5432 or docker-compose.local.yml :5433)" >&2
  } >&2
  return 1
}
