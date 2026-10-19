import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';

describe('GET /healthz', () => {
  it('returns ok when the database is reachable', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://events:events@localhost:5433/events_test',
      SESSION_SECRET: 'x'.repeat(32),
      APP_PASSWORD_HASH: 'scrypt$16384$AA$BB',
    });
    const pool = createPool(config.DATABASE_URL);
    const app = await buildApp(config, pool, { logger: false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
    await pool.end();
  });
});
