# Integration Hosting Runbook (Week 6)

Always-on reference integrations on Render. Secrets live in the Render dashboard only — never commit tokens.

## Services

| Render service | URL | Health |
| --- | --- | --- |
| `ship-shape-slack-integration` | https://ship-shape-slack-integration.onrender.com | `/health` |
| `ship-shape-gitlab-integration` | https://ship-shape-gitlab-integration.onrender.com | `/health` |

Defined in [`render.yaml`](../../../render.yaml).

## Slack service secrets

| Variable | Purpose |
| --- | --- |
| `SLACK_CLIENT_ID` | Slack app client id |
| `SLACK_CLIENT_SECRET` | OAuth token exchange |
| `SLACK_REDIRECT_URI` | `https://ship-shape-slack-integration.onrender.com/slack/oauth/callback` (register in Slack app) |
| `SLACK_CHANNEL_ID` | Target channel for posts |
| `SLACK_BOT_TOKEN` | Bot token after OAuth install (cold-start stability) |
| `SHIP_WEBHOOK_SECRETS` | Comma-separated signing secrets from **persistent** Ship webhook subscriptions |

## GitLab service secrets

| Variable | Purpose |
| --- | --- |
| `SHIP_API_URL` | `https://ship-shape-api.onrender.com` |
| `SHIP_ACCESS_TOKEN` | Long-lived token with `issues:read`, `issues:write` |
| `GITLAB_WEBHOOK_SECRET` | Shared secret for GitLab project hook `token` |

## One-time wiring

### Slack

Use Slack app **PlugForge Live Proof** (`A0B8T4QDH9S`) only — not Hermes.

1. Add Render OAuth redirect URL to the PlugForge Live Proof app.
2. Visit `https://ship-shape-slack-integration.onrender.com/slack/install` and complete OAuth.
3. Copy bot token → `SLACK_BOT_TOKEN` on Render; invite bot to `SLACK_CHANNEL_ID`.
4. In Ship Developer portal, create **persistent** webhook subscriptions:
   - `document.created` → `https://ship-shape-slack-integration.onrender.com/ship/webhooks`
   - `issue.assigned` → same URL
5. Copy both signing secrets into `SHIP_WEBHOOK_SECRETS` on the Slack Render service.
6. Save subscription UUIDs for local drills: `SHIP_SLACK_DOCUMENT_SUBSCRIPTION_ID`, `SHIP_SLACK_ISSUE_SUBSCRIPTION_ID`.

See [`PROOF_REFRESH_SECRETS.md`](./PROOF_REFRESH_SECRETS.md) for the full pre-flight checklist.

### GitLab (Gauntlet instance)

1. Use `GITLAB_API_URL=https://labs.gauntletai.com/api/v4` for drills — not gitlab.com.
2. On project `michaelhabermas/plugforge-live-proof`, register a project hook:
   - URL: `https://ship-shape-gitlab-integration.onrender.com/gitlab/webhook`
   - Token: `GITLAB_WEBHOOK_SECRET`
   - Merge request events: enabled
3. Proof MR (existing): https://labs.gauntletai.com/michaelhabermas/plugforge-live-proof/-/merge_requests/1

## Re-run live drills against Render

### One command (recommended)

```bash
pnpm plugforge:refresh-proof --screenshot=/path/to/slack-proof.png
```

Health-checks both integrations, runs GitLab + Slack hosted drills, refreshes matrix, renders reviewer packet, fails if evidence still references tunnel URLs.

### Individual drills

```bash
# GitLab (hosted — no local receiver)
GITLAB_API_URL=https://labs.gauntletai.com/api/v4 \
GITLAB_WEBHOOK_PUBLIC_URL=https://ship-shape-gitlab-integration.onrender.com/gitlab/webhook \
GITLAB_KEEP_HOOK=1 \
pnpm plugforge:live:gitlab

# Slack (hosted — persistent webhooks + Slack API readback)
SLACK_INTEGRATION_PUBLIC_URL=https://ship-shape-slack-integration.onrender.com \
SHIP_SLACK_DOCUMENT_SUBSCRIPTION_ID=<uuid> \
SHIP_SLACK_ISSUE_SUBSCRIPTION_ID=<uuid> \
pnpm plugforge:live:slack
```

After evidence updates:

```bash
pnpm plugforge:render-reviewer
pnpm plugforge:submission
```

## Reviewer surfaces

- Generated packet: https://ship-shape-web.onrender.com/plugforge-reviewer-packet.html#integrations
- Static evidence JSON: https://ship-shape-web.onrender.com/plugforge-evidence/matrix.json
- Developer tab → Integration proof panel (read-only)
- CI artifact: `plugforge-reviewer-proof` from `plugforge-submission` workflow
