import { Router } from 'express';
import { pool } from '../db/client.js';
import { isDatabaseUnreachableError } from '../db/connection-error.js';

const router = Router();

/** Dev-only database reachability probe for local setup UX. */
router.get('/database-status', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      connected: true,
    });
  } catch (error) {
    const unreachable = isDatabaseUnreachableError(error);
    res.json({
      connected: false,
      unreachable,
      hint: unreachable
        ? 'PostgreSQL is not running. Start local Postgres (e.g. brew services start postgresql@16) or run pnpm docker:up.'
        : 'Database query failed. Check DATABASE_URL in api/.env.local.',
    });
  }
});

export default router;
