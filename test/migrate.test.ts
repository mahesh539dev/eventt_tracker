import { describe, expect, it } from 'vitest';
import { createPool, runMigrations } from '../src/db.js';

const DEFAULT_TEST_DATABASE_URL = 'postgres://events:events@localhost:5433/events_test';

function resolveTestDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  if (!/\/[^/?]*test[^/?]*(\?|$)/i.test(databaseUrl)) {
    throw new Error(
      `Refusing to run tests against a database that doesn't look like a test database: ${databaseUrl}. The database name must contain "test".`,
    );
  }
  return databaseUrl;
}

describe('migrations', () => {
  it('applies 0001_init.sql and is idempotent on a second run', async () => {
    const pool = createPool(resolveTestDatabaseUrl());
    await runMigrations(pool); // may be a no-op if another test file already migrated — that's fine

    const recorded = await pool.query('SELECT name FROM events_schema_migrations WHERE name = $1', ['0001_init.sql']);
    expect(recorded.rows).toHaveLength(1);

    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'events' ORDER BY column_name`,
    );
    expect(cols.rows.map((r) => r.column_name)).toContain('decor_style');

    const second = await runMigrations(pool);
    expect(second).toEqual([]);

    await pool.end();
  });
});
