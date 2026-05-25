# Browser storage (UI prefs)

`localStorage` for UI preferences (tabs, sort, console filters) is **best-effort**: on failure, use defaults and continue. Do not `console.error` for quota or private-mode failures.

Inline scripts in `scripts/submission/` use `renderQuietStorageHelpers()` from `browser-storage-client.mjs` — do not copy raw `try/catch` at call sites.
