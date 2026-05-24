**Description**

`isValidReturnTo` allows paths starting with `/` and rejects `//` only. May not block backslash or encoding tricks (`/\evil.com`, `/%5C...`).

**Affected code**

- `api/src/routes/caia-auth.ts` (~L46–48)

**Exploitability**

Requires victim to complete OAuth on attacker-crafted callback URL; state/code are one-time.

**Recommended fix**

Allowlist paths; reject `\`, encoded slashes; or store redirect in session.
