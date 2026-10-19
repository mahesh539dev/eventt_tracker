import { describe, expect, it } from 'vitest';
import { createPool, runMigrations } from '../src/db.js';

describe('migrations', () => {
  it('applies 0001_init.sql and is idempotent on a second run', async () => {
    const pool = createPool(process.env.DATABASE_URL ?? 'postgres://events:events@localhost:5433/events_test');
    const first = await runMigrations(pool);
    expect(first).toContain('0001_init.sql');

    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'events' ORDER BY column_name`,
    );
    expect(cols.rows.map((r) => r.column_name)).toContain('decor_style');

    const second = await runMigrations(pool);
    expect(second).toEqual([]);

    await pool.end();
  });
});
