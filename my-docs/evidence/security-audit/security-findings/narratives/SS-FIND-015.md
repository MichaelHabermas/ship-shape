**Description**

Session validated once at HTTP upgrade. Expired session, revoked membership, or deleted session does not disconnect active WebSocket until client drops.

**Affected code**

- Upgrade: `api/src/collaboration/index.ts` (~L635–641, ~L603–608 for `/events`)
- Message handlers (~L711–738) — no re-validation

**Recommended fix**

Periodic session re-check on persist or ping; disconnect on failure.
