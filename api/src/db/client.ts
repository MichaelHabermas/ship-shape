import pg from 'pg';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { databaseSslOptions, isProduction } from '../config/runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables before creating pool
config({ path: join(__dirname, '../../.env.local') });
config({ path: join(__dirname, '../../.env') });

const { Pool } = pg;

const configuredPoolMax = Number(process.env.PG_POOL_MAX);
const poolMax = Number.isFinite(configuredPoolMax) && configuredPoolMax > 0
  ? configuredPoolMax
  : isProduction() ? 20 : 10;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSslOptions(),
  // Production-ready pool configuration
  max: poolMax, // Max connections (default is 10 locally, 20 in production)
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  connectionTimeoutMillis: 2000, // Fail fast if can't connect in 2 seconds
  maxUses: 7500, // Recycle connections after 7500 queries to prevent memory leaks
  // DDoS protection: Terminate queries running longer than 30 seconds
  statement_timeout: 30000, // 30 seconds max query duration
});

export async function closeDatabasePool(): Promise<void> {
  await pool.end();
}

export { pool };
