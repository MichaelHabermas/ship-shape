/**
 * Shadow Database Migration Script
 *
 * Runs migrations on the shadow database without SSM loading.
 * Designed to work with port-forwarded connections.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx api/scripts/migrate-shadow.ts
 */

import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('Connecting to shadow database...');
  console.log('Host from URL:', databaseUrl.split('@')[1]?.split(':')[0]);

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Running database migrations...');

    // Step 1: Run schema.sql for initial setup
    const schemaPath = join(__dirname, '../src/db/schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    try {
      await pool.query(schema);
      console.log('✅ Schema applied');
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('already exists')) {
        console.log('ℹ️  Schema already exists, continuing...');
      } else {
        throw err;
      }
    }

    // Step 2: Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // Step 3: Get list of already-applied migrations
    const appliedResult = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
    const appliedMigrations = new Set(appliedResult.rows.map(r => r.version));

    console.log(`Already applied: ${appliedMigrations.size} migrations`);

    // Step 4: Find and run pending migrations
    const migrationsDir = join(__dirname, '../src/db/migrations');
    let migrationFiles: string[] = [];

    try {
      migrationFiles = readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();
    } catch {
      console.log('ℹ️  No migrations directory found');
    }

    console.log(`Found ${migrationFiles.length} migration files`);

    let migrationsRun = 0;
    for (const file of migrationFiles) {
      const version = file.replace('.sql', '');

      if (appliedMigrations.has(version)) {
        continue;
      }

      console.log(`  Running migration: ${file}`);
      const migrationPath = join(migrationsDir, file);
      const migrationSql = readFileSync(migrationPath, 'utf-8');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migrationSql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        console.log(`  ✅ ${file} applied`);
        migrationsRun++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ❌ ${file} failed:`, err);
        throw err;
      } finally {
        client.release();
      }
    }

    if (migrationsRun === 0) {
      console.log('✅ All migrations already applied');
    } else {
      console.log(`✅ ${migrationsRun} migration(s) applied successfully`);
    }

    // Verify test user
    const userResult = await pool.query(
      `SELECT id, email, name,
              CASE WHEN password_hash IS NOT NULL THEN 'SET' ELSE 'NULL' END as password_status
       FROM users WHERE LOWER(email) = LOWER('shawn.jones@treasury.gov')`
    );

    if (userResult.rows.length > 0) {
      console.log('\n✅ Test user verified:', userResult.rows[0]);
    } else {
      console.log('\n⚠️  Test user not found');
    }

  } catch (error) {
    console.error('Database migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
