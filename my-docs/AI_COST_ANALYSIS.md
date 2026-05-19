# AI Cost Analysis

---

## Dev Spend

Record the best available estimate of AI usage cost for the project. Prefer actual provider usage exports or billing dashboards if available; otherwise use a clearly labeled estimate based on model, approximate token usage, and session count. Include the method used so the number is reproducible enough to audit.

Codex local thread metadata can provide the main usage baseline for this project. Query `/Users/michaelhabermas/.codex/state_5.sqlite`, table `threads`, filtering `cwd = '/Users/michaelhabermas/repos/GAI/ship-shape'`. Use `tokens_used`, `model`, `created_at`, and `updated_at` to report project-level Codex usage. This gives aggregate token usage, not an exact provider bill, because it does not split input, output, cached, or reasoning tokens.

```bash
sqlite3 -header -column /Users/michaelhabermas/.codex/state_5.sqlite \
  "select count(*) threads,
          sum(tokens_used) total_tokens,
          min(datetime(created_at,'unixepoch')) first_created,
          max(datetime(updated_at,'unixepoch')) last_updated
   from threads
   where cwd='/Users/michaelhabermas/repos/GAI/ship-shape';"
```

Latest known baseline:

| Metric | Value |
|--------|-------|
| Codex project threads | 7 |
| Codex aggregate tokens | 94,998,747 |
| First thread created | 2026-05-18 19:51:52 UTC |
| Last thread updated | 2026-05-19 23:29:02 UTC |

Other possible cross-checks: provider billing dashboard, Codex account usage export if available, and manual inclusion of non-Codex AI tools if any were used for ShipShape.

Additional useful breakdowns:

```bash
sqlite3 -header -column /Users/michaelhabermas/.codex/state_5.sqlite \
  "select model,
          count(*) threads,
          sum(tokens_used) total_tokens
   from threads
   where cwd='/Users/michaelhabermas/repos/GAI/ship-shape'
   group by model
   order by total_tokens desc;"
```

```bash
sqlite3 -header -csv /Users/michaelhabermas/.codex/state_5.sqlite \
  "select id,
          datetime(created_at,'unixepoch') created_at,
          datetime(updated_at,'unixepoch') updated_at,
          tokens_used,
          model,
          replace(substr(title,1,80), char(10), ' ') title
   from threads
   where cwd='/Users/michaelhabermas/repos/GAI/ship-shape'
   order by created_at;"
```


## Reflection On AI Tool Effectiveness For Codebase Comprehension
