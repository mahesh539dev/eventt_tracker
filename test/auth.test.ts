import { describe, expect, it, beforeAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

describe('auth', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const PASSWORD = 'correct-horse-battery-staple';

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://events:events@localhost:5433/events_test',
      SESSION_SECRET: 'x'.repeat(32),
      APP_PASSWORD_HASH: await hashPassword(PASSWORD),
    });
    const pool = createPool(config.DATABASE_URL);
    app = await buildApp(config, pool, { logger: false });
  });

  it('rejects a request to a protected API route with no session cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a non-GET API request missing the CSRF header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects the wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-requested-with': 'event-decor-tracker' },
      payload: { password: 'nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('logs in with the right password and can then reach a protected route', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-requested-with': 'event-decor-tracker' },
      payload: { password: PASSWORD },
    });
    expect(login.statusCode).toBe(204);
    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeTruthy();
    const cookieHeader = Array.isArray(cookie) ? cookie[0] : cookie;

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieHeader as string } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ authenticated: true });
  });
});
