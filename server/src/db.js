import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool, types } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep everything as plain JS strings/numbers so date maths stays string-comparable
// and money never arrives as a string.
types.setTypeParser(1082, (v) => v);                        // DATE  -> 'YYYY-MM-DD'
types.setTypeParser(1114, (v) => new Date(v + 'Z').toISOString());  // TIMESTAMP
types.setTypeParser(1184, (v) => new Date(v).toISOString());        // TIMESTAMPTZ
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // NUMERIC
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // BIGINT (count())

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || 'postgres://pp360:pp360@localhost:5433/peoplepay360',
  max: 10,
});

/** Run a query. Returns rows. */
export const query = async (text, params = []) => (await pool.query(text, params)).rows;
/** Run a query expecting at most one row. */
export const one = async (text, params = []) => (await pool.query(text, params)).rows[0] ?? null;

/** Run fn inside a transaction, passing it a dedicated client. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Apply schema.sql. Idempotent — called on every server boot and by the seeder. */
export async function migrate() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}

export async function waitForDb(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      if (i === 0) console.log('waiting for postgres...');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Could not connect to Postgres. Is `docker compose up -d db` running?');
}
