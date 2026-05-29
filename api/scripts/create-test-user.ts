/**
 * Create Test User Script
 *
 * Creates a test user in the shadow database for manual testing.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx api/scripts/create-test-user.ts
 *
 * Or using SSM:
 *   DATABASE_URL=$(aws ssm get-parameter --name "/ship/shadow/DATABASE_URL" --with-decryption --query "Parameter.Value" --output text)
 *   npx tsx api/scripts/create-test-user.ts
 */

import bcrypt from 'bcryptjs';
import { PASSWORD_BCRYPT_ROUNDS } from '@ship/shared';
import pg from 'pg';
const { Pool } = pg;

const TEST_USER = {
  email: 'shawn.jones@treasury.gov',
  password: '!Musicfun1$$',
  name: 'Shawn Jones',
  isSuperAdmin: true,
};

async function createTestUser() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  // Create pool with SSL for Aurora
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('Connecting to database...');

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id, email, name FROM users WHERE LOWER(email) = LOWER($1)',
      [TEST_USER.email]
    );

    if (existingUser.rows.length > 0) {
      console.log(`User ${TEST_USER.email} already exists:`);
      console.log(existingUser.rows[0]);

      // Update password for existing user
      const passwordHash = await bcrypt.hash(TEST_USER.password, PASSWORD_BCRYPT_ROUNDS);
      await pool.query(
        'UPDATE users SET password_hash = $1, name = $2 WHERE LOWER(email) = LOWER($3)',
        [passwordHash, TEST_USER.name, TEST_USER.email]
      );
      console.log('Password updated for existing user');
    } else {
      // Create new user
      const passwordHash = await bcrypt.hash(TEST_USER.password, PASSWORD_BCRYPT_ROUNDS);

      const result = await pool.query(
        `INSERT INTO users (email, password_hash, name, is_super_admin)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, is_super_admin`,
        [TEST_USER.email, passwordHash, TEST_USER.name, TEST_USER.isSuperAdmin]
      );

      console.log('User created:');
      console.log(result.rows[0]);
    }

    // Verify user can be found
    const verifyResult = await pool.query(
      `SELECT id, email, name, is_super_admin,
              CASE WHEN password_hash IS NOT NULL THEN 'SET' ELSE 'NULL' END as password_status
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [TEST_USER.email]
    );

    console.log('\nVerification:');
    console.log(verifyResult.rows[0]);

    // Also ensure the user has a person document for proper app functioning
    const personResult = await pool.query(
      `SELECT id FROM documents WHERE document_type = 'person' AND user_id = $1`,
      [verifyResult.rows[0].id]
    );

    if (personResult.rows.length === 0) {
      console.log('\nCreating person document for user...');

      // Get a workspace ID to use
      const workspaceResult = await pool.query(
        'SELECT id FROM workspaces LIMIT 1'
      );

      if (workspaceResult.rows.length > 0) {
        const workspaceId = workspaceResult.rows[0].id;

        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, user_id)
           VALUES ($1, 'person', $2, $3)
           RETURNING id`,
          [workspaceId, TEST_USER.name, verifyResult.rows[0].id]
        );
        console.log('Person document created');
      } else {
        console.log('Warning: No workspace found, skipping person document creation');
      }
    } else {
      console.log('\nPerson document already exists');
    }

    console.log('\n✅ Test user ready!');
    console.log(`   Email: ${TEST_USER.email}`);
    console.log(`   Password: ${TEST_USER.password}`);

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createTestUser();
