# Security Findings Ledger

> **Generated** from `security-findings.json`. Do not edit by hand. Regenerate: `pnpm security:findings:render`

## Discovery

- **Date:** 2026-05-22
- **Method:** deep_review
- **Session:** Single deep authorization review; migrated from hand-edited ledger

## Summary

| ID | Title | Severity | Status | Discovered | Last verification | Active | Primary location |
|----|-------|----------|--------|------------|-------------------|--------|------------------|
| SS-FIND-001 | fixed | medium | fixed | 2026-05-22 | — | no | 2026-05-22 |
| SS-FIND-002 | fixed | medium | fixed | 2026-05-22 | — | no | 2026-05-22 |
| SS-FIND-003 | fixed | medium | fixed | 2026-05-22 | — | no | 2026-05-22 |
| SS-FIND-004 | fixed | medium | fixed | 2026-05-22 | — | no | 2026-05-22 |
| SS-FIND-005 | fixed | medium | fixed | 2026-05-22 | — | no | 2026-05-22 |
| SS-FIND-006 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-007 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-008 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-009 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-010 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-011 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-012 | fixed | medium | fixed | 2026-05-22 | — | no | 2026-05-22 |
| SS-FIND-013 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-014 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-015 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-016 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-017 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-018 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-019 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-020 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-021 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-022 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-023 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-024 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-025 | fixed | medium | fixed | 2026-05-22 | — | no | 2026-05-22 |
| SS-FIND-026 | fixed | medium | fixed | 2026-05-22 | — | no | 2026-05-22 |
| SS-FIND-027 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-028 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-029 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-030 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-031 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-032 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-033 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |
| SS-FIND-034 | open | medium | open | 2026-05-22 | — | yes | 2026-05-22 |

## Findings

### SS-FIND-001: fixed

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Member cannot set governance approval fields via PATCH /api/documents/:id |

_No narrative extracted for SS-FIND-001._

### SS-FIND-002: fixed

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Member cannot self-assign accountable_id to gain approval authority |

_No narrative extracted for SS-FIND-002._

### SS-FIND-003: fixed

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Member cannot PATCH sprint/week status to completed without authorization |

_No narrative extracted for SS-FIND-003._

### SS-FIND-004: fixed

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Member cannot read peer weekly plan via generic documents API |

_No narrative extracted for SS-FIND-004._

### SS-FIND-005: fixed

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Member cannot open peer weekly plan collaboration WebSocket room |

_No narrative extracted for SS-FIND-005._

### SS-FIND-006: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-006._

### SS-FIND-007: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-007._

### SS-FIND-008: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | File serve must respect parent document visibility (probe currently checks uploader-only; document scope still open) |

_No narrative extracted for SS-FIND-008._

### SS-FIND-009: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-009._

### SS-FIND-010: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-010._

### SS-FIND-011: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-011._

### SS-FIND-012: fixed

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Public feedback endpoint enforces dedicated rate limiting |

_No narrative extracted for SS-FIND-012._

### SS-FIND-013: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-013._

### SS-FIND-014: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-014._

### SS-FIND-015: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-015._

### SS-FIND-016: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-016._

### SS-FIND-017: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-017._

### SS-FIND-018: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-018._

### SS-FIND-019: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-019._

### SS-FIND-020: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-020._

### SS-FIND-021: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-021._

### SS-FIND-022: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-022._

### SS-FIND-023: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-023._

### SS-FIND-024: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-024._

### SS-FIND-025: fixed

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Member cannot complete another user pending upload |

_No narrative extracted for SS-FIND-025._

### SS-FIND-026: fixed

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | fixed |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | Cross-origin WebSocket upgrade is rejected |

_No narrative extracted for SS-FIND-026._

### SS-FIND-027: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-027._

### SS-FIND-028: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-028._

### SS-FIND-029: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-029._

### SS-FIND-030: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-030._

### SS-FIND-031: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-031._

### SS-FIND-032: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-032._

### SS-FIND-033: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-033._

### SS-FIND-034: open

| Field | Value |
|-------|-------|
| Severity | medium |
| Status | open |
| OWASP | — |
| Category | — |
| Discovered | 2026-05-22 |
| Definition | open |

_No narrative extracted for SS-FIND-034._

---

*Generated at 2026-05-24T00:26:57.834Z from security-findings.json*
