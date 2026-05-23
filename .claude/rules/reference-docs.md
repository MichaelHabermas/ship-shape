# Reference Documentation

Comprehensive codebase documentation is available in `docs/claude-reference/`:

| Document | Description |
|----------|-------------|
| [INDEX.md](../../docs/claude-reference/INDEX.md) | Start here - full index |
| [architecture.md](../../docs/claude-reference/architecture.md) | System overview, data flow |
| [patterns.md](../../docs/claude-reference/patterns.md) | Coding patterns to follow |
| [commands.md](../../docs/claude-reference/commands.md) | All pnpm commands |

**Read docs on-demand** using the Read tool when you need specific information.
Do NOT read all docs upfront - this wastes context.

## Quick Reference (Essential)

- **Dev commands**: `pnpm dev`, `pnpm test`, `/e2e-test-runner` (fallback: `pnpm test:e2e:run`)
- **Document model**: Everything is a document with `document_type` field
- **Editor layout**: 4-panel (Icon Rail | Sidebar | Content | Properties)
- **Session timeout**: 15min inactivity, 12hr absolute
