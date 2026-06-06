# Proof refresh — what you need before we run live proof together

## Names (use these — no synonyms)

| Plain name | Env var | Looks like | How you get it |
| --- | --- | --- | --- |
| **Ship API OAuth token** | `SHIP_ACCESS_TOKEN` | long opaque string | `pnpm ship login` → stored in `~/.ship/tokens.json` |
| **Slack bot OAuth token** | `SLACK_BOT_TOKEN` | `xoxb-…` | **Slack app dashboard** → OAuth & Permissions → **Bot User OAuth Token** (not shown on the approve page until integration is redeployed) |

`SLACK_BOT_TOKEN` **is** the Slack bot OAuth token. Not the Slack client secret. Not `SHIP_ACCESS_TOKEN`.

Use this checklist once Render integration services are deployed. The repo command is:

```bash
pnpm plugforge:refresh-proof --screenshot=/path/to/your/slack-proof.png
```

## 1. Render services (one-time)

Deploy or confirm both integration services from [`render.yaml`](../../../render.yaml):

| Service | Health URL |
| --- | --- |
| `ship-shape-slack-integration` | https://ship-shape-slack-integration.onrender.com/health |
| `ship-shape-gitlab-integration` | https://ship-shape-gitlab-integration.onrender.com/health |

## 2. Slack app (PlugForge Live Proof only)

Use Slack app **`PlugForge Live Proof`** (`A0B8T4QDH9S`) in workspace Chazzwazza — not Hermes or other apps.

## 3. Slack Render secrets

Set in Render dashboard for `ship-shape-slack-integration`:

| Secret | Value |
| --- | --- |
| `SLACK_CLIENT_ID` | From Slack app |
| `SLACK_CLIENT_SECRET` | From Slack app |
| `SLACK_REDIRECT_URI` | `https://ship-shape-slack-integration.onrender.com/slack/oauth/callback` |
| `SLACK_CHANNEL_ID` | Channel where proof posts appear |
| `SLACK_BOT_TOKEN` | **Slack bot OAuth token** (`xoxb-…`) from step 4 |
| `SHIP_WEBHOOK_SECRETS` | Comma-separated signing secrets from step 4 |

## 4. Slack OAuth on Render (one-time)

1. Add OAuth redirect: `https://ship-shape-slack-integration.onrender.com/slack/oauth/callback`
2. Visit `https://ship-shape-slack-integration.onrender.com/slack/install` and complete OAuth (browser shows `{"ok":true,"team_id":"…"}` only — **no token there today**).
3. Copy the **Slack bot OAuth token** from [api.slack.com/apps](https://api.slack.com/apps) → **PlugForge Live Proof** → **OAuth & Permissions** → **Bot User OAuth Token** (`xoxb-…`) → paste into Render `SLACK_BOT_TOKEN`. Redeploy.
4. Invite bot to `SLACK_CHANNEL_ID`.

## 5. Persistent Ship webhooks (one-time)

In Ship Developer portal (demo login on deployed site):

1. Create `document.created` → `https://ship-shape-slack-integration.onrender.com/ship/webhooks`
2. Create `issue.assigned` → same URL
3. Copy **both signing secrets** (comma-separated, no spaces) → `SHIP_WEBHOOK_SECRETS` on Render
4. Save subscription UUIDs — you need them locally:

```bash
export SHIP_SLACK_DOCUMENT_SUBSCRIPTION_ID='<uuid-from-step-1>'
export SHIP_SLACK_ISSUE_SUBSCRIPTION_ID='<uuid-from-step-2>'
```

## 6. GitLab project hook (one-time)

On `michaelhabermas/plugforge-live-proof` at Gauntlet GitLab:

- URL: `https://ship-shape-gitlab-integration.onrender.com/gitlab/webhook`
- Token: same as `GITLAB_WEBHOOK_SECRET` on GitLab Render service
- Merge request events: on

## 7. Get `SHIP_ACCESS_TOKEN` (one-time login)

This is **not** in Render or Slack. It is a Ship API login token for the **PlugForge Slack Live Proof** OAuth app.

```bash
pnpm ship login \
  --api-url https://ship-shape-api.onrender.com \
  --client-id ship_app_653999d0a9745ee4e4007f374ec5d15a \
  --scope 'documents:read documents:write issues:read issues:write webhooks:manage'
```

1. Terminal prints a link and code (e.g. `UPGL-XXXX`).
2. Open the link while logged into https://ship-shape-web.onrender.com as demo admin.
3. Approve the login. Terminal should say `Logged in as dev@ship.local`.

Copy the token into your shell:

```bash
export SHIP_ACCESS_TOKEN="$(node -pe "JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(),'.ship/tokens.json'),'utf8')).accessToken")"
```

## 8. Local env for refresh (export before drill)

```bash
export SHIP_API_URL='https://ship-shape-api.onrender.com'
# SHIP_ACCESS_TOKEN from step 7

# Slack hosted drill
export SLACK_INTEGRATION_PUBLIC_URL='https://ship-shape-slack-integration.onrender.com'
export SLACK_BOT_TOKEN='xoxb-…'   # Slack bot OAuth token from Render
export SLACK_CHANNEL_ID='C…'
export SHIP_SLACK_DOCUMENT_SUBSCRIPTION_ID='<uuid>'
export SHIP_SLACK_ISSUE_SUBSCRIPTION_ID='<uuid>'

# GitLab hosted drill
export GITLAB_API_URL='https://labs.gauntletai.com/api/v4'
export GITLAB_TOKEN='glpat-…'
export GITLAB_PROJECT_ID='michaelhabermas/plugforge-live-proof'
export GITLAB_WEBHOOK_PUBLIC_URL='https://ship-shape-gitlab-integration.onrender.com/gitlab/webhook'
export GITLAB_WEBHOOK_SECRET='<shared-secret>'
export GITLAB_KEEP_HOOK=1
```

Optional: put these in a local file (gitignored) and `source` it before refresh.

## 9. Screenshot (manual, after Slack drill)

1. Open the Slack channel and screenshot the two proof messages.
2. Run refresh with `--screenshot=…` or copy to `my-docs/evidence/plugforge-integrations/live/slack-proof.png`
3. Set `slack-proof.meta.json` → `"source": "live_capture"`

## 10. What I need from you in session

Paste or confirm (redact in chat if you prefer; use terminal export locally):

- [ ] Both Render integration `/health` endpoints return 200
- [ ] `SHIP_ACCESS_TOKEN` (scopes: documents + issues + webhooks)
- [ ] `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID`
- [ ] Both `SHIP_SLACK_*_SUBSCRIPTION_ID` values
- [ ] `GITLAB_TOKEN` + `GITLAB_WEBHOOK_SECRET`
- [ ] Screenshot file path after drill

Then we run:

```bash
pnpm plugforge:refresh-proof --screenshot=~/Downloads/slack-proof.png
pnpm plugforge:verify
```
