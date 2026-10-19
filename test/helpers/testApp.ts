import type pg from 'pg';
import { buildApp, type BuildOptions } from '../../src/app.js';
import { hashPassword } from '../../src/auth.js';
import { loadConfig } from '../../src/config.js';
import { createPool, runMigrations } from '../../src/db.js';

const PASSWORD = 'correct-horse-battery-staple';

export async function buildTestApp(opts: BuildOptions = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://events:events@localhost:5433/events_test',
    SESSION_SECRET: 'x'.repeat(32),
    APP_PASSWORD_HASH: await hashPassword(PASSWORD),
  });
  const pool: pg.Pool = createPool(config.DATABASE_URL);
  await runMigrations(pool);
  await pool.query('TRUNCATE TABLE events_expenses, events');

  const app = await buildApp(config, pool, { logger: false, ...opts });

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'x-requested-with': 'event-decor-tracker' },
    payload: { password: PASSWORD },
  });
  const cookie = login.headers['set-cookie'];
  const authCookie = (Array.isArray(cookie) ? cookie[0] : cookie) as string;

  return { app, pool, authCookie };
}

export const AUTH_HEADERS = { 'x-requested-with': 'event-decor-tracker' };
