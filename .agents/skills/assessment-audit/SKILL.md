---
name: assessment-audit
description: Run a read-only adversarial codebase audit for assessment-shaped findings: fake gates, safety theater, artifact leakage, contract drift, capability mirages, hidden crash/security risks, and other high-signal issues that ordinary lint/security/dependency reports miss.
---

# Assessment Audit

Use this skill when auditing ShipShape for weird, high-signal findings that change what a maintainer should believe about the repo. This is not a normal lint, dependency, or generic security report.

## Operating Rules

- Default to read-only investigation. Do not edit files unless the user explicitly asks to update notes or create this skill.
- Read `my-docs/DISCOVERY.md` first. Use it as context to avoid duplicate discoveries, not as a boundary.
- Separate confirmed findings from provisional leads.
- Do not invent issues. Every finding needs concrete file paths, lines, commands, outputs, or runtime behavior.
- Disposable verification artifacts are not findings. They are instruments. The finding is the preexisting repo behavior they expose.
- Prefer fewer, stronger findings over long weak lists.

## First Files To Read

- `AGENTS.md`
- `my-docs/DISCOVERY.md`
- `my-docs/MEMORY.md`
- `my-docs/project-weeks-sot/week-4/AUDIT_REPORT.md`
- `my-docs/project-weeks-sot/week-4/IMPROVEMENT_REPORT.md`
- root, `api`, `web`, and `shared` `package.json`
- `scripts/`
- `.husky/`, `.github/` if present
- `.gitignore`
- `docs/`
- `api/src/db/migrate.ts`
- `api/src/app.ts`
- `api/src/openapi/`

## Hunt Categories

### Fake Gates

Look for commands that pass while doing little or nothing:

- scripts that exit 0 when no files changed, config is absent, or tools are missing
- hooks that warn but do not block
- CI docs without tracked CI workflows
- tests that skip silently or pass because they have no assertions
- coverage or audit scripts that count the wrong denominator

### Safety Theater

Look for protective-looking checks that are weak:

- destructive test cleanup without proving the DB is disposable
- setup/bootstrap routes that rely on check-then-act
- migration code that catches broad errors
- auth checks that confuse super-admin, workspace-admin, person-doc identity, and current workspace
- production guards that only check weak env vars

### Artifact Leakage

List tracked non-source artifacts:

- deploy zips, build outputs, source maps, generated reports, traces, plans, temp docs
- ignored-but-tracked files
- nested Terraform plans/state-like artifacts
- filenames with shell hazards, especially leading `-`

Inspect archives without extracting into the repo.

### Contract Drift

Compare contracts against runtime:

- OpenAPI registered paths vs Express mounted routes
- shared types vs backend response mappers vs frontend assumptions
- docs that describe old columns, old routes, old product language, or old setup flows
- generated clients or MCP tooling that advertise endpoints not actually mounted

### Capability Mirages

Find features that look real but are stubbed or partial:

- fields marked stubbed but surfaced in API/UI
- UI labels/routes with missing backend behavior
- docs claiming full-text/search/offline/admin/security capabilities that are narrower in code
- devtools or debug-only dependencies imported into production entrypoints

### Security And Crash Surface

Look for small paths with large blast radius:

- unauthenticated bootstrap/setup/admin routes
- token creation and display paths
- file upload/download and signed URL logic
- session timeout and CSRF bypass paths
- broad `catch` blocks around auth, deploy, migration, setup, and cleanup
- process-level crash handlers or missing handlers
- data-shape assumptions around JSONB, Yjs, TipTap, and generated OpenAPI schemas

## Useful Read-Only Commands

Use `rg` first:

```bash
rg -n "TODO|FIXME|stub|fake|mock|demo|temporary|no-op|noop|skip|only|devtools|admin|password|secret|already exists|process.exit|catch" .
git ls-files
git ls-files | rg '(^|/)(dist|dev-dist|build|coverage|test-results|playwright-report|\\.terraform|tfplan|deploy-.*\\.zip|.*\\.zip$|.*\\.jsonl$|temporary|progress|failures|trace|report)'
rg -n "registerPath|app.use\\('/api|router\\.(get|post|put|patch|delete)" api/src
```

For disposable verification, use uniquely named throwaway DBs and clean them up. Never treat the throwaway DB or rows as the discovered issue.

## Output Shape

For confirmed findings:

- Title
- Severity
- Status: Confirmed
- Evidence
- Why it matters
- Why it is easy to miss
- Possible mediation

For provisional leads:

- Title
- Severity guess
- Status: Needs verification
- Evidence so far
- What would prove it real
- What would make it harmless

