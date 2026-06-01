import pg from 'pg';
const { Pool } = pg;

const shadowConfig = {
  host: process.env.SHADOW_HOST,
  user: 'postgres',
  password: process.env.SHADOW_PASS,
  database: 'ship_main',
  port: 5432,
  ssl: { rejectUnauthorized: false }
};

const devConfig = {
  host: process.env.DEV_HOST,
  user: 'postgres',
  password: process.env.DEV_PASS,
  database: 'ship_main',
  port: 5432,
  ssl: { rejectUnauthorized: false }
};

async function checkUser(config: pg.PoolConfig, name: string) {
  const pool = new Pool(config);
  try {
    console.log(`\n=== ${name} DB ===`);
    console.log('Host:', config.host);

    // Check users table (used by login)
    const result = await pool.query(
      'SELECT id, email, password_hash, name FROM users WHERE LOWER(email) = LOWER($1)',
      ['shawn.jones@treasury.gov']
    );

    if (result.rows.length === 0) {
      console.log('USER NOT FOUND in users table!');
    } else {
      const user = result.rows[0];
      console.log('User found in users table:');
      console.log('  ID:', user.id);
      console.log('  Email:', user.email);
      console.log('  Name:', user.name);
      console.log('  Hash:', user.password_hash);
    }

    const countResult = await pool.query('SELECT COUNT(*) FROM users');
    console.log('Total users:', countResult.rows[0].count);

    // List all users
    const allUsers = await pool.query('SELECT id, email FROM users LIMIT 5');
    console.log('Sample users:', allUsers.rows.map(u => u.email).join(', '));

  } catch (err: unknown) {
    console.error('Error:', err instanceof Error ? err.message : err);
  } finally {
    await pool.end();
  }
}

async function main() {
  await checkUser(shadowConfig, 'Shadow');
  await checkUser(devConfig, 'Dev');
}

main();
