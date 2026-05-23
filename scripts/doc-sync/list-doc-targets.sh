#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
node "$ROOT/scripts/doc-sync/lib/expand-targets.mjs" 2>/dev/null || true
node -e "
import { loadDocTargets } from './scripts/doc-sync/lib/expand-targets.mjs';
for (const t of loadDocTargets()) console.log(t);
"
