// Idempotent dev/test database seed: users, programs, sprints, issues, and accountability fixtures.
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import pg from 'pg';
import { loadProductionSecrets } from '../config/ssm.js';
import { databaseSslOptions } from '../config/runtime.js';
import { SeedContext } from './seed/seed-helpers.js';
import { seedWorkspaceUsers } from './seed/workspace-users.js';
import { seedProgramsProjects } from './seed/programs-projects.js';
import { seedSprintsIssues } from './seed/sprints-issues.js';
import { seedAccountability } from './seed/accountability.js';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment (local dev only - production uses SSM)
config({ path: join(__dirname, '../../.env.local') });
config({ path: join(__dirname, '../../.env') });

async function seed() {
  // Load secrets from SSM in production (must happen before Pool creation)
  await loadProductionSecrets();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: databaseSslOptions(),
  });
  console.log('🌱 Starting database seed...');
  // Only log hostname, never full connection string (contains credentials)
  const dbHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : 'unknown';
  console.log(`   Database host: ${dbHost}`);

  try {
    // Run schema
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    await pool.query(schema);
    console.log('✅ Schema created');

    const ctx: SeedContext = {
      pool,
      workspaceId: '',
      allUsers: [],
      programs: [],
      programTeams: {},
      projects: [],
      currentSprintNumber: 0,
      sprintsToCreate: [],
      sprints: [],
    };

    await seedWorkspaceUsers(ctx);
    await seedProgramsProjects(ctx);
    await seedSprintsIssues(ctx);
    await seedAccountability(ctx);

    console.log('');
    console.log('🎉 Seed complete!');
    console.log('');
    console.log('Login credentials:');
    console.log('  Email: dev@ship.local');
    console.log('  Password: admin123');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
