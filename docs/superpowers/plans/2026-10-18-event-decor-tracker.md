# Event Decor Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Fastify/TypeScript/Postgres PWA that tracks decor events (customer, payments, expenses, status) and reports on them by month or custom range, deployed alongside the existing Pocket Ledger app on the same Postgres server.

**Architecture:** A structural twin of the sibling "Pocket Ledger" app — Fastify 5 serves a JSON API under `/api` and a vanilla-JS PWA from `/public`, with a scrypt-password + HMAC-cookie auth scheme ported verbatim (own secret, own cookie name, own CSRF header value). All tables are prefixed `events_` so they coexist safely with Pocket Ledger's tables on the shared Postgres server, tracked via an independent `events_schema_migrations` table.

**Tech Stack:** Node 22, TypeScript (strict), Fastify 5, `pg`, zod, vitest, vanilla ES module JS frontend, Docker, Railway.

**Spec:** `docs/superpowers/specs/2026-10-18-event-decor-tracker-design.md`

## Global Constraints

- Node >=22, `"type": "module"`, TypeScript strict mode, `NodeNext` module resolution — matches the spec's decision table (section 2).
- No ORM — plain SQL via `pg`, migrations are hand-written `.sql` files run in a transaction (spec section 5).
- All money as integer cents; all dates as plain `YYYY-MM-DD` strings via a `pg` type-parser override for OID 1082 — never routed through JS `Date` (spec sections 2, 5).
- All new tables are prefixed `events_`; the migration-tracking table is `events_schema_migrations`, never Pocket Ledger's `schema_migrations` (spec sections 2, 4, 5, 9).
- Session cookie name, CSRF header value, `SESSION_SECRET`, and `APP_PASSWORD_HASH` must all be distinct from Pocket Ledger's (spec section 9) — this app uses cookie name `edt_session` and CSRF header value `event-decor-tracker`.
- No framework/build step on the frontend; ES modules served as-is from `/public` (spec section 2).
- No customer table, no >2 payment slots, no multi-user accounts, no notifications, no attachments, single currency (spec section 10, YAGNI list) — do not add any of these.
- `status` is recomputed from `auto_status` on every read when `status_is_manual = false`; it is never silently left stale (spec section 5).

## Review Focus

- **Deposit/rest amount without its paid-on date.** The DB has a `CHECK` constraint for this, but the API must reject it with a clean 400 before the query ever reaches Postgres (spec section 5) — Task 8's tests cover both the create and the partial-update path (e.g. raising `deposit_cents` from 0 without supplying `deposit_paid_on` in the same PATCH).
- **Status auto-resolution exactly at the date boundary.** An event dated today, or an event dated yesterday with `due_cents` still positive, must both resolve to `outstanding`; only "date strictly before today AND due <= 0" resolves to `done` (spec section 5) — Task 9's tests use an injectable `today()` function to pin this, not the real clock.
- **Manual status override surviving a later read.** Once `status_is_manual = true`, the stored `status` must win even if `auto_status` would now disagree (e.g. owner marks Outstanding on a fully-paid past event); only an explicit "reset to automatic" clears the flag (spec section 5) — Task 9 tests both directions.
- **Deleting an event deletes its expenses.** `ON DELETE CASCADE` is declared in the migration, but Task 10's integration test must assert the expense rows are actually gone after a `DELETE /api/events/:id`, not just that the event row is gone.
- **Month vs custom-range reports disagreeing at a month boundary.** An event on the last day of a month must appear in that month's report and *not* in the next month's, and a custom range spanning two months must total correctly against the sum of the two single-month reports (spec section 1, 6) — Task 11's tests use fixture events on the 1st, the 15th, and the last day of a month.

---

## File Structure

```
event-decor-tracker/
├─ package.json, tsconfig.json, .env.example, docker-compose.yml, Dockerfile, railway.json
├─ src/
│  ├─ config.ts          # zod env schema
│  ├─ db.ts               # pg Pool + OID 1082 date parser + events_schema_migrations runner
│  ├─ migrate.ts          # one-shot CLI: run migrations and exit
│  ├─ auth.ts             # scrypt hash/verify, HMAC session sign/verify, cookie helpers, LoginThrottle, installAuth hook
│  ├─ errors.ts           # HttpError, installErrorHandling
│  ├─ schemas.ts          # zod request/query schemas for events, expenses, reports
│  ├─ compute.ts          # pure functions: derived event fields, auto-status resolution
│  ├─ periods.ts          # pure functions: month-string <-> date range, range validation
│  ├─ app.ts              # buildApp(): registers helmet, rate-limit, error handling, auth, routes, static
│  ├─ index.ts            # boot: load config, create pool, migrate, buildApp, listen
│  └─ routes/
│     ├─ health.ts
│     ├─ auth.ts
│     ├─ events.ts        # CRUD for events (includes derived fields on every response)
│     ├─ expenses.ts      # sub-resource CRUD for events_expenses
│     └─ reports.ts       # GET /api/reports
├─ migrations/
│  └─ 0001_init.sql
├─ scripts/
│  └─ hash-password.ts
├─ test/
│  ├─ helpers/testApp.ts  # builds a Fastify instance against the events_test DB, with an injectable today()
│  ├─ compute.test.ts
│  ├─ periods.test.ts
│  ├─ auth.test.ts
│  ├─ events.test.ts
│  ├─ expenses.test.ts
│  └─ reports.test.ts
└─ public/
   ├─ index.html, manifest.webmanifest, sw.js
   ├─ css/app.css
   ├─ icons/  (placeholder PNGs — real artwork is out of scope for this plan)
   └─ js/
      ├─ api.js, state.js, money.js, dates.js, ui.js
      ├─ views/eventList.js, views/eventForm.js, views/reportView.js
      └─ main.js
```

---

### Task 1: Project scaffold and health check

**Files:**
- Create: `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`, `docker-compose.yml`, `src/config.ts`, `src/db.ts`, `src/errors.ts`, `src/app.ts`, `src/index.ts`, `src/routes/health.ts`
- Test: `test/health.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `loadConfig(env?): Config` (fields: `NODE_ENV`, `PORT`, `APP_TIMEZONE`, `DATABASE_URL`, `SESSION_SECRET`, `APP_PASSWORD_HASH`); `createPool(databaseUrl: string): pg.Pool`; `runMigrations(pool, dir?): Promise<string[]>`; `HttpError`, `installErrorHandling(app)`; `buildApp(config, pool, opts?): Promise<FastifyInstance>`; `healthRoutes(app, pool)`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "event-decor-tracker",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=.env src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "migrate": "tsx --env-file-if-exists=.env src/migrate.ts",
    "hash-password": "tsx scripts/hash-password.ts"
  },
  "dependencies": {
    "@fastify/helmet": "^13.1.1",
    "@fastify/rate-limit": "^11.2.0",
    "@fastify/static": "^10.1.5",
    "fastify": "^5.12.5",
    "pg": "^8.23.1",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "@types/pg": "^8.23.1",
    "tsx": "^4.23.15",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": false
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `.env.example`**

```
NODE_ENV=development
PORT=3100
DATABASE_URL=postgres://events:events@localhost:5433/events
SESSION_SECRET=change-me-32-bytes-hex      # openssl rand -hex 32
APP_PASSWORD_HASH=                         # output of npm run hash-password

# Time zone for "today" when resolving event status (IANA name). Defaults to UTC.
APP_TIMEZONE=America/Toronto
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
.env
*.log
```

- [ ] **Step 5: Write `docker-compose.yml`** (local Postgres only, on a different host port than Pocket Ledger's so both can run locally at once)

```yaml
# Local Postgres only. The app itself runs with `npm run dev`.
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: events
      POSTGRES_PASSWORD: events
      POSTGRES_DB: events
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U events"]
      interval: 5s
      timeout: 3s
      retries: 10
volumes:
  pgdata:
```

- [ ] **Step 6: Write `src/config.ts`**

```typescript
import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    APP_TIMEZONE: z.string().default('UTC'),
    DATABASE_URL: z.string({ error: 'DATABASE_URL is required' }).min(1, 'DATABASE_URL is required'),
    SESSION_SECRET: z
      .string({ error: 'SESSION_SECRET is required (generate one with: openssl rand -hex 32)' })
      .min(1, 'SESSION_SECRET is required (generate one with: openssl rand -hex 32)'),
    APP_PASSWORD_HASH: z
      .string({ error: 'APP_PASSWORD_HASH is required (run: npm run hash-password)' })
      .regex(/^scrypt\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/, 'APP_PASSWORD_HASH is missing or malformed (run: npm run hash-password)'),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production' && v.SESSION_SECRET.length < 32) {
      ctx.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'must be at least 32 characters in production' });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
```

- [ ] **Step 7: Write `src/db.ts`** — note the migration table name is `events_schema_migrations`, not Pocket Ledger's `schema_migrations`

```typescript
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Keep DATE columns as plain 'YYYY-MM-DD' strings. Never route them through Date.
pg.types.setTypeParser(1082, (v: string) => v);

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '..', 'migrations');

export async function runMigrations(pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS events_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set(
      (await client.query('SELECT name FROM events_schema_migrations')).rows.map((r) => r.name as string),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO events_schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
    }
  } finally {
    client.release();
  }
  return applied;
}
```

- [ ] **Step 8: Write `src/errors.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: { code: 'validation_error', message: err.issues[0]?.message ?? 'Invalid request.' } });
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      const code = err.statusCode === 415 ? 'unsupported_media_type' : 'bad_request';
      return reply.code(err.statusCode).send({ error: { code, message: 'Bad request.' } });
    }
    req.log.error({ err: { message: err.message, code: err.code } }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Something went wrong.' } });
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
    }
    return reply.code(404).send('Not found');
  });
}
```

- [ ] **Step 9: Write `src/routes/health.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export function healthRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/healthz', { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
}
```

- [ ] **Step 10: Write `src/app.ts`** (auth/routes beyond health are added in later tasks — for now `buildApp` wires only helmet, rate-limit, errors, health, and static)

```typescript
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type pg from 'pg';
import type { Config } from './config.js';
import { installErrorHandling } from './errors.js';
import { healthRoutes } from './routes/health.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface BuildOptions {
  logger?: boolean;
  /** Overrides "today" (YYYY-MM-DD). Tests use this; production derives it from APP_TIMEZONE. */
  today?: () => string;
}

export async function buildApp(config: Config, pool: pg.Pool, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const logger = opts.logger ?? config.NODE_ENV !== 'test';
  const app = Fastify({
    trustProxy: true,
    logger: logger
      ? { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] }
      : false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'style-src-attr': ["'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
      },
    },
    hsts: { maxAge: 15552000, includeSubDomains: true },
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => Object.assign(new Error('rate limited'), { statusCode: 429, retryAfter: ctx.after }),
  });

  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') return;
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || 'transfer-encoding' in req.headers;
    const type = String(req.headers['content-type'] ?? '').toLowerCase();
    if (hasBody && !type.startsWith('application/json')) {
      return reply
        .code(415)
        .send({ error: { code: 'unsupported_media_type', message: 'Content-Type must be application/json.' } });
    }
  });

  installErrorHandling(app);
  healthRoutes(app, pool);

  await app.register(fastifyStatic, { root: path.resolve(here, '..', 'public') });

  return app;
}
```

- [ ] **Step 11: Write `src/index.ts`**

```typescript
import { loadConfig } from './config.js';
import { createPool, runMigrations } from './db.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  const applied = await runMigrations(pool);
  const app = await buildApp(config, pool);
  if (applied.length) app.log.info({ applied }, 'migrations applied');
  await app.listen({ host: '0.0.0.0', port: config.PORT });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 12: Write `test/health.test.ts`**

```typescript
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
```

- [ ] **Step 13: Install dependencies and run the test**

Run: `npm install`
Then start local Postgres and create the test DB:
Run: `docker compose up -d && sleep 2 && docker compose exec -T db psql -U events -c "CREATE DATABASE events_test;"`
Then: `npm test -- health.test.ts`
Expected: PASS (1 test)

- [ ] **Step 14: Commit**

```bash
git add package.json tsconfig.json .env.example .gitignore docker-compose.yml src/config.ts src/db.ts src/errors.ts src/app.ts src/index.ts src/routes/health.ts test/health.test.ts package-lock.json
git commit -m "feat: scaffold event decor tracker with health check"
```

---

### Task 2: Auth (scrypt password + HMAC session cookie)

**Files:**
- Create: `src/auth.ts`, `src/routes/auth.ts`, `scripts/hash-password.ts`
- Modify: `src/app.ts` (register `installAuth` and `authRoutes`)
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `Config` from Task 1 (`SESSION_SECRET`, `APP_PASSWORD_HASH`, `NODE_ENV`); `HttpError` from `src/errors.ts`; `buildApp` from Task 1.
- Produces: `hashPassword(password, n?): Promise<string>`; `verifyPassword(password, stored): Promise<boolean>`; `COOKIE_NAME = 'edt_session'`; `CSRF_HEADER_VALUE = 'event-decor-tracker'`; `signSession`, `verifySession`, `readCookie`, `sessionCookie`, `clearCookie`, `issueSession`; `LoginThrottle`; `installAuth(app, config)`; `authRoutes(app, config, throttle?)`.

- [ ] **Step 1: Write `src/auth.ts`** (ported from Pocket Ledger with a distinct cookie name and CSRF header value so the two apps' sessions can never be confused)

```typescript
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';

export const COOKIE_NAME = 'edt_session';
export const CSRF_HEADER_VALUE = 'event-decor-tracker';
export const SESSION_SECONDS = 30 * 24 * 3600;
const REFRESH_BELOW_SECONDS = 15 * 24 * 3600;
const KEYLEN = 64;
const DEFAULT_N = 16384;

const scrypt = (password: string, salt: Buffer, n: number): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r: 8, p: 1, maxmem: 128 * n * 8 * 2 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );

/** Format: scrypt$<N>$<saltBase64>$<hashBase64> */
export async function hashPassword(password: string, n = DEFAULT_N): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, n);
  return `scrypt$${n}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, nStr, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !nStr || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), Number(nStr));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (secret: string, body: string) => crypto.createHmac('sha256', secret).update(body).digest();

export function signSession(secret: string, iat: number, exp: number): string {
  const body = b64u(JSON.stringify({ iat, exp }));
  return `${body}.${b64u(mac(secret, body))}`;
}

export function verifySession(secret: string, token: string, nowSec = Math.floor(Date.now() / 1000)): { iat: number; exp: number } | null {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const given = Buffer.from(sig, 'base64url');
  const want = mac(secret, body);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!Number.isFinite(p.iat) || !Number.isFinite(p.exp) || p.exp <= nowSec) return null;
    return { iat: p.iat, exp: p.exp };
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(config: Config, token: string, maxAge = SESSION_SECONDS): string {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` + (config.NODE_ENV === 'production' ? '; Secure' : '');
}

export const clearCookie = (config: Config) => sessionCookie(config, '', 0);

export function issueSession(config: Config, reply: FastifyReply, nowSec = Math.floor(Date.now() / 1000)): void {
  reply.header('set-cookie', sessionCookie(config, signSession(config.SESSION_SECRET, nowSec, nowSec + SESSION_SECONDS)));
}

export class LoginThrottle {
  private map = new Map<string, { fails: number; lockedUntil: number }>();
  constructor(
    private maxFails = 10,
    private lockMs = 15 * 60_000,
    private now: () => number = Date.now,
  ) {}
  isLocked(key: string): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    if (e.lockedUntil && e.lockedUntil <= this.now()) {
      this.map.delete(key);
      return false;
    }
    return e.lockedUntil > this.now();
  }
  fail(key: string): void {
    const e = this.map.get(key) ?? { fails: 0, lockedUntil: 0 };
    e.fails += 1;
    if (e.fails >= this.maxFails) e.lockedUntil = this.now() + this.lockMs;
    this.map.set(key, e);
  }
  ok(key: string): void {
    this.map.delete(key);
  }
}

const OPEN_API_ROUTES = new Set(['/api/auth/login', '/api/auth/logout']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function installAuth(app: FastifyInstance, config: Config): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    reply.header('cache-control', 'no-store');

    if (!SAFE_METHODS.has(req.method) && req.headers['x-requested-with'] !== CSRF_HEADER_VALUE) {
      return reply.code(403).send({ error: { code: 'csrf', message: 'Missing required header.' } });
    }
    if (OPEN_API_ROUTES.has(path)) return;

    const token = readCookie(req.headers.cookie, COOKIE_NAME);
    const session = token ? verifySession(config.SESSION_SECRET, token) : null;
    if (!session) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Sign in to continue.' } });
    }
    const left = session.exp - Math.floor(Date.now() / 1000);
    if (left < REFRESH_BELOW_SECONDS) issueSession(config, reply);
  });
}
```

- [ ] **Step 2: Write `src/routes/auth.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LoginThrottle, clearCookie, issueSession, verifyPassword } from '../auth.js';
import type { Config } from '../config.js';
import { HttpError } from '../errors.js';

const loginBody = z.object({ password: z.string().min(1, 'Enter your password.').max(500) });

export function authRoutes(app: FastifyInstance, config: Config, throttle = new LoginThrottle()): void {
  app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { password } = loginBody.parse(req.body);
    if (throttle.isLocked(req.ip)) {
      throw new HttpError(429, 'locked', 'Too many wrong passwords. Try again in a few minutes.');
    }
    if (!(await verifyPassword(password, config.APP_PASSWORD_HASH))) {
      throttle.fail(req.ip);
      throw new HttpError(401, 'invalid_credentials', 'That password is not right.');
    }
    throttle.ok(req.ip);
    issueSession(config, reply);
    return reply.code(204).send();
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', clearCookie(config));
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async () => ({ authenticated: true }));
}
```

- [ ] **Step 3: Write `scripts/hash-password.ts`**

```typescript
import readline from 'node:readline';
import { hashPassword } from '../src/auth.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Password: ', async (password) => {
  rl.close();
  console.log(await hashPassword(password));
});
```

- [ ] **Step 4: Modify `src/app.ts`** to install auth and the auth routes, right after `installErrorHandling(app)`

```typescript
import { installAuth } from './auth.js';
import { authRoutes } from './routes/auth.js';
// ...
  installErrorHandling(app);
  installAuth(app, config);
  authRoutes(app, config);
  healthRoutes(app, pool);
```

- [ ] **Step 5: Write `test/auth.test.ts`**

```typescript
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
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- auth.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add src/auth.ts src/routes/auth.ts scripts/hash-password.ts src/app.ts test/auth.test.ts
git commit -m "feat: add scrypt+HMAC session auth"
```

---

### Task 3: Migration 0001 — events and events_expenses tables

**Files:**
- Create: `migrations/0001_init.sql`
- Test: `test/migrate.test.ts`

**Interfaces:**
- Consumes: `runMigrations`, `createPool` from Task 1.
- Produces: Postgres tables `events`, `events_expenses` on the `events_test` database (and, in production, on the shared Pocket Ledger Postgres server) — exact columns as in spec section 5. Every later task's SQL depends on these column names.

- [ ] **Step 1: Write `migrations/0001_init.sql`**

```sql
CREATE TABLE events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name      text NOT NULL CHECK (char_length(btrim(customer_name)) BETWEEN 1 AND 100),
  customer_phone     text CHECK (customer_phone IS NULL OR char_length(btrim(customer_phone)) <= 30),
  event_date         date NOT NULL,
  event_type         text NOT NULL CHECK (char_length(btrim(event_type)) BETWEEN 1 AND 60),
  decor_style        text NOT NULL CHECK (decor_style IN ('indian_traditional', 'balloon', 'both')),
  job_type           text NOT NULL CHECK (job_type IN ('rental', 'service')),
  price_cents        integer NOT NULL CHECK (price_cents BETWEEN 0 AND 1000000000),
  deposit_cents      integer NOT NULL DEFAULT 0 CHECK (deposit_cents BETWEEN 0 AND 1000000000),
  deposit_paid_on    date,
  rest_cents         integer NOT NULL DEFAULT 0 CHECK (rest_cents BETWEEN 0 AND 1000000000),
  rest_paid_on       date,
  status             text NOT NULL DEFAULT 'outstanding' CHECK (status IN ('outstanding', 'done')),
  status_is_manual   boolean NOT NULL DEFAULT false,
  notes              text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (deposit_cents = 0 OR deposit_paid_on IS NOT NULL),
  CHECK (rest_cents = 0 OR rest_paid_on IS NOT NULL)
);
CREATE INDEX events_event_date_idx ON events (event_date DESC);
CREATE INDEX events_status_idx ON events (status);

CREATE TABLE events_expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  amount_cents  integer NOT NULL CHECK (amount_cents BETWEEN 1 AND 1000000000),
  note          text NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
  spent_on      date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_expenses_event_idx ON events_expenses (event_id);
CREATE INDEX events_expenses_spent_on_idx ON events_expenses (spent_on DESC);
```

- [ ] **Step 2: Write `test/migrate.test.ts`**

```typescript
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
```

- [ ] **Step 3: Run migrations against the test DB and run the test**

Run: `docker compose exec -T db psql -U events -c "DROP DATABASE IF EXISTS events_test;" && docker compose exec -T db psql -U events -c "CREATE DATABASE events_test;"`
Then: `npm test -- migrate.test.ts`
Expected: PASS (1 test)

- [ ] **Step 4: Commit**

```bash
git add migrations/0001_init.sql test/migrate.test.ts
git commit -m "feat: add events and events_expenses migration"
```

---

### Task 4: Pure compute functions (derived fields, auto-status)

**Files:**
- Create: `src/compute.ts`
- Test: `test/compute.test.ts`

**Interfaces:**
- Consumes: nothing beyond plain values.
- Produces: `type EventMoney = { priceCents: number; depositCents: number; restCents: number }`; `amountPaidCents(m: EventMoney): number`; `dueCents(m: EventMoney): number`; `totalExpensesCents(expenses: { amountCents: number }[]): number`; `finalAmountCents(m: EventMoney, expenses: { amountCents: number }[]): number`; `resolveAutoStatus(eventDate: string, dueCents: number, today: string): 'outstanding' | 'done'`; `resolveStatus(input: { eventDate: string; dueCents: number; today: string; storedStatus: 'outstanding' | 'done'; statusIsManual: boolean }): 'outstanding' | 'done'`. Task 8 (events routes) calls `resolveStatus` on every read and `amountPaidCents`/`dueCents` to populate response fields; Task 9 tests the boundary behavior through this same function.

- [ ] **Step 1: Write the failing test `test/compute.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { amountPaidCents, dueCents, finalAmountCents, resolveAutoStatus, resolveStatus, totalExpensesCents } from '../src/compute.js';

describe('amountPaidCents', () => {
  it('sums deposit and rest', () => {
    expect(amountPaidCents({ priceCents: 10000, depositCents: 2000, restCents: 3000 })).toBe(5000);
  });
});

describe('dueCents', () => {
  it('is price minus amount paid', () => {
    expect(dueCents({ priceCents: 10000, depositCents: 2000, restCents: 3000 })).toBe(5000);
  });
  it('can go negative if overpaid, left to the caller to interpret', () => {
    expect(dueCents({ priceCents: 1000, depositCents: 2000, restCents: 0 })).toBe(-1000);
  });
});

describe('totalExpensesCents / finalAmountCents', () => {
  it('sums expenses and subtracts from amount paid', () => {
    const money = { priceCents: 10000, depositCents: 4000, restCents: 6000 };
    const expenses = [{ amountCents: 1500 }, { amountCents: 500 }];
    expect(totalExpensesCents(expenses)).toBe(2000);
    expect(finalAmountCents(money, expenses)).toBe(8000);
  });
  it('returns 0 total for no expenses', () => {
    expect(totalExpensesCents([])).toBe(0);
  });
});

describe('resolveAutoStatus', () => {
  it('is outstanding when due > 0, even if the event date has passed', () => {
    expect(resolveAutoStatus('2026-01-01', 500, '2026-06-01')).toBe('outstanding');
  });
  it('is outstanding when the event date is today, even if fully paid', () => {
    expect(resolveAutoStatus('2026-06-01', 0, '2026-06-01')).toBe('outstanding');
  });
  it('is outstanding when the event date is in the future and fully paid', () => {
    expect(resolveAutoStatus('2026-07-01', 0, '2026-06-01')).toBe('outstanding');
  });
  it('is done when the event date is strictly before today and due <= 0', () => {
    expect(resolveAutoStatus('2026-05-31', 0, '2026-06-01')).toBe('done');
  });
  it('is done when overpaid (due negative) and the date has passed', () => {
    expect(resolveAutoStatus('2026-05-31', -100, '2026-06-01')).toBe('done');
  });
});

describe('resolveStatus', () => {
  it('uses the auto-resolved status when not manually overridden', () => {
    const result = resolveStatus({
      eventDate: '2026-05-31',
      dueCents: 0,
      today: '2026-06-01',
      storedStatus: 'outstanding',
      statusIsManual: false,
    });
    expect(result).toBe('done');
  });
  it('keeps the manually-set status even if auto-resolution would disagree', () => {
    const result = resolveStatus({
      eventDate: '2026-05-31',
      dueCents: 0,
      today: '2026-06-01',
      storedStatus: 'outstanding',
      statusIsManual: true,
    });
    expect(result).toBe('outstanding');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- compute.test.ts`
Expected: FAIL (`Cannot find module '../src/compute.js'`)

- [ ] **Step 3: Write `src/compute.ts`**

```typescript
export interface EventMoney {
  priceCents: number;
  depositCents: number;
  restCents: number;
}

export function amountPaidCents(m: EventMoney): number {
  return m.depositCents + m.restCents;
}

export function dueCents(m: EventMoney): number {
  return m.priceCents - amountPaidCents(m);
}

export function totalExpensesCents(expenses: { amountCents: number }[]): number {
  return expenses.reduce((sum, e) => sum + e.amountCents, 0);
}

export function finalAmountCents(m: EventMoney, expenses: { amountCents: number }[]): number {
  return amountPaidCents(m) - totalExpensesCents(expenses);
}

export type EventStatus = 'outstanding' | 'done';

export function resolveAutoStatus(eventDate: string, due: number, today: string): EventStatus {
  return eventDate < today && due <= 0 ? 'done' : 'outstanding';
}

export function resolveStatus(input: {
  eventDate: string;
  dueCents: number;
  today: string;
  storedStatus: EventStatus;
  statusIsManual: boolean;
}): EventStatus {
  if (input.statusIsManual) return input.storedStatus;
  return resolveAutoStatus(input.eventDate, input.dueCents, input.today);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- compute.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/compute.ts test/compute.test.ts
git commit -m "feat: add pure compute functions for derived event fields and status"
```

---

### Task 5: Pure period functions (month/range resolution)

**Files:**
- Create: `src/periods.ts`
- Test: `test/periods.test.ts`

**Interfaces:**
- Consumes: nothing beyond plain values.
- Produces: `monthToRange(month: string): { from: string; to: string }` (accepts `'YYYY-MM'`, returns the first and last calendar day of that month as `'YYYY-MM-DD'`); `isValidRange(from: string, to: string): boolean`. Task 11 (reports route) uses both to turn a `month` or `from`/`to` query into a validated date range.

- [ ] **Step 1: Write the failing test `test/periods.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { isValidRange, monthToRange } from '../src/periods.js';

describe('monthToRange', () => {
  it('returns the first and last day of a 31-day month', () => {
    expect(monthToRange('2026-01')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });
  it('returns the first and last day of a 30-day month', () => {
    expect(monthToRange('2026-04')).toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });
  it('handles February in a non-leap year', () => {
    expect(monthToRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
  it('handles February in a leap year', () => {
    expect(monthToRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('isValidRange', () => {
  it('accepts a range where from is before to', () => {
    expect(isValidRange('2026-01-01', '2026-01-31')).toBe(true);
  });
  it('accepts a single-day range', () => {
    expect(isValidRange('2026-01-01', '2026-01-01')).toBe(true);
  });
  it('rejects a range where from is after to', () => {
    expect(isValidRange('2026-02-01', '2026-01-01')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- periods.test.ts`
Expected: FAIL (`Cannot find module '../src/periods.js'`)

- [ ] **Step 3: Write `src/periods.ts`**

```typescript
export function monthToRange(month: string): { from: string; to: string } {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const mo = Number(monthStr);
  const lastDay = new Date(Date.UTC(year, mo, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${yearStr}-${monthStr}-01`, to: `${yearStr}-${monthStr}-${pad(lastDay)}` };
}

export function isValidRange(from: string, to: string): boolean {
  return from <= to;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- periods.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/periods.ts test/periods.test.ts
git commit -m "feat: add pure period/range functions for reports"
```

---

### Task 6: Request schemas for events and expenses

**Files:**
- Create: `src/schemas.ts`
- Test: `test/schemas.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces: `dateStr` (zod schema validating `YYYY-MM-DD` as a real calendar date); `uuid`; `eventCreateBody`, `eventUpdateBody` (zod schemas matching spec section 5/6 fields — `customerName`, `customerPhone`, `eventDate`, `eventType`, `decorStyle`, `jobType`, `priceCents`, `depositCents`, `depositPaidOn`, `restCents`, `restPaidOn`, `status`, `notes` — with the cross-field rule that a nonzero `depositCents`/`restCents` requires its paid-on date); `eventListQuery` (`from`, `to`, `status`, `jobType`, `decorStyle`, `q`, all optional); `expenseBody` (`amountCents`, `note`, `spentOn`); `reportQuery` (either `month` or `from`+`to`). Task 8 imports `eventCreateBody`, `eventUpdateBody`, `eventListQuery`; Task 10 imports `expenseBody`; Task 11 imports `reportQuery`.

- [ ] **Step 1: Write the failing test `test/schemas.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { eventCreateBody, eventUpdateBody, expenseBody, reportQuery } from '../src/schemas.js';

describe('eventCreateBody', () => {
  const valid = {
    customerName: 'Priya Rao',
    customerPhone: '555-1234',
    eventDate: '2026-11-01',
    eventType: 'Wedding',
    decorStyle: 'indian_traditional',
    jobType: 'service',
    priceCents: 50000,
    depositCents: 10000,
    depositPaidOn: '2026-10-01',
    restCents: 0,
    restPaidOn: null,
    notes: '',
  };

  it('accepts a fully valid payload', () => {
    expect(() => eventCreateBody.parse(valid)).not.toThrow();
  });

  it('requires customerName', () => {
    expect(() => eventCreateBody.parse({ ...valid, customerName: '' })).toThrow();
  });

  it('allows customerPhone to be omitted', () => {
    const { customerPhone, ...rest } = valid;
    expect(() => eventCreateBody.parse(rest)).not.toThrow();
  });

  it('rejects a deposit amount with no deposit paid-on date', () => {
    expect(() => eventCreateBody.parse({ ...valid, depositCents: 10000, depositPaidOn: null })).toThrow();
  });

  it('rejects a rest amount with no rest paid-on date', () => {
    expect(() => eventCreateBody.parse({ ...valid, restCents: 5000, restPaidOn: null })).toThrow();
  });

  it('rejects an invalid decorStyle', () => {
    expect(() => eventCreateBody.parse({ ...valid, decorStyle: 'floral' })).toThrow();
  });

  it('rejects an invalid jobType', () => {
    expect(() => eventCreateBody.parse({ ...valid, jobType: 'lease' })).toThrow();
  });
});

describe('eventUpdateBody', () => {
  it('rejects raising depositCents without supplying depositPaidOn in the same update', () => {
    expect(() => eventUpdateBody.parse({ depositCents: 15000 })).toThrow();
  });

  it('accepts raising depositCents together with depositPaidOn', () => {
    expect(() => eventUpdateBody.parse({ depositCents: 15000, depositPaidOn: '2026-10-05' })).not.toThrow();
  });

  it('accepts a status-only update', () => {
    expect(() => eventUpdateBody.parse({ status: 'done' })).not.toThrow();
  });
});

describe('expenseBody', () => {
  it('accepts a valid expense', () => {
    expect(() => expenseBody.parse({ amountCents: 1200, note: 'balloons', spentOn: '2026-10-01' })).not.toThrow();
  });
  it('rejects zero amount', () => {
    expect(() => expenseBody.parse({ amountCents: 0, note: '', spentOn: '2026-10-01' })).toThrow();
  });
});

describe('reportQuery', () => {
  it('accepts a month', () => {
    expect(() => reportQuery.parse({ month: '2026-10' })).not.toThrow();
  });
  it('accepts a from/to range', () => {
    expect(() => reportQuery.parse({ from: '2026-10-01', to: '2026-10-31' })).not.toThrow();
  });
  it('rejects neither month nor from/to', () => {
    expect(() => reportQuery.parse({})).toThrow();
  });
  it('rejects from after to', () => {
    expect(() => reportQuery.parse({ from: '2026-10-31', to: '2026-10-01' })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- schemas.test.ts`
Expected: FAIL (`Cannot find module '../src/schemas.js'`)

- [ ] **Step 3: Write `src/schemas.ts`**

```typescript
import { z } from 'zod';

export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const dateStr = z
  .string({ error: 'Choose a date.' })
  .refine(isRealDate, { error: 'Date must be a real calendar date (YYYY-MM-DD).' });

export const uuid = z.uuid({ error: 'Invalid id.' });

const MAX_CENTS = 1_000_000_000;

const money = (label: string) =>
  z
    .number({ error: `${label} must be a whole number of cents.` })
    .int(`${label} must be a whole number of cents.`)
    .min(0, `${label} cannot be negative.`)
    .max(MAX_CENTS, `${label} is too large.`);

const eventFields = {
  customerName: z
    .string({ error: 'Customer name is required.' })
    .trim()
    .min(1, 'Customer name is required.')
    .max(100, 'Customer name must be 100 characters or fewer.'),
  customerPhone: z.string().trim().max(30, 'Phone must be 30 characters or fewer.').nullable().optional(),
  eventDate: dateStr,
  eventType: z
    .string({ error: 'Event type is required.' })
    .trim()
    .min(1, 'Event type is required.')
    .max(60, 'Event type must be 60 characters or fewer.'),
  decorStyle: z.enum(['indian_traditional', 'balloon', 'both'], { error: 'Pick a decor style.' }),
  jobType: z.enum(['rental', 'service'], { error: 'Pick a job type.' }),
  priceCents: money('Price'),
  depositCents: money('Deposit').default(0),
  depositPaidOn: dateStr.nullable().optional(),
  restCents: money('Rest payment').default(0),
  restPaidOn: dateStr.nullable().optional(),
  status: z.enum(['outstanding', 'done']).optional(),
  notes: z.string().trim().max(2000, 'Notes must be 2000 characters or fewer.').default(''),
};

function requirePaidOnWhenPositive(v: { depositCents?: number; depositPaidOn?: string | null; restCents?: number; restPaidOn?: string | null }, ctx: z.RefinementCtx) {
  if ((v.depositCents ?? 0) > 0 && !v.depositPaidOn) {
    ctx.addIssue({ code: 'custom', path: ['depositPaidOn'], message: 'Deposit paid date is required when a deposit amount is set.' });
  }
  if ((v.restCents ?? 0) > 0 && !v.restPaidOn) {
    ctx.addIssue({ code: 'custom', path: ['restPaidOn'], message: 'Rest paid date is required when a rest amount is set.' });
  }
}

export const eventCreateBody = z.object(eventFields).superRefine(requirePaidOnWhenPositive);

export const eventUpdateBody = z
  .object({
    customerName: eventFields.customerName.optional(),
    customerPhone: eventFields.customerPhone,
    eventDate: eventFields.eventDate.optional(),
    eventType: eventFields.eventType.optional(),
    decorStyle: eventFields.decorStyle.optional(),
    jobType: eventFields.jobType.optional(),
    priceCents: eventFields.priceCents.optional(),
    depositCents: eventFields.depositCents.optional(),
    depositPaidOn: eventFields.depositPaidOn,
    restCents: eventFields.restCents.optional(),
    restPaidOn: eventFields.restPaidOn,
    status: eventFields.status,
    resetStatusToAutomatic: z.boolean().optional(),
    notes: eventFields.notes.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.depositCents !== undefined && v.depositCents > 0 && !v.depositPaidOn) {
      ctx.addIssue({ code: 'custom', path: ['depositPaidOn'], message: 'Deposit paid date is required when a deposit amount is set.' });
    }
    if (v.restCents !== undefined && v.restCents > 0 && !v.restPaidOn) {
      ctx.addIssue({ code: 'custom', path: ['restPaidOn'], message: 'Rest paid date is required when a rest amount is set.' });
    }
  });

export const eventListQuery = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  status: z.enum(['outstanding', 'done']).optional(),
  jobType: z.enum(['rental', 'service']).optional(),
  decorStyle: z.enum(['indian_traditional', 'balloon', 'both']).optional(),
  q: z.string().trim().max(100).optional(),
});

export const expenseBody = z.object({
  amountCents: z
    .number({ error: 'Amount must be greater than zero.' })
    .int('Amount must be a whole number of cents.')
    .min(1, 'Amount must be greater than zero.')
    .max(MAX_CENTS, 'Amount is too large.'),
  note: z.string().trim().max(200, 'Note must be 200 characters or fewer.').default(''),
  spentOn: dateStr,
});

export const reportQuery = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM')
      .optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.month) return;
    if (!v.from || !v.to) {
      ctx.addIssue({ code: 'custom', message: 'Provide either "month" or both "from" and "to".' });
      return;
    }
    if (v.from > v.to) ctx.addIssue({ code: 'custom', message: '"from" must not be after "to".' });
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- schemas.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: Commit**

```bash
git add src/schemas.ts test/schemas.test.ts
git commit -m "feat: add zod request schemas for events, expenses, reports"
```

---

### Task 7: Test helper for building an authenticated app instance

**Files:**
- Create: `test/helpers/testApp.ts`

**Interfaces:**
- Consumes: `buildApp`, `loadConfig`, `createPool`, `runMigrations` from Tasks 1–3; `hashPassword` from Task 2.
- Produces: `async function buildTestApp(opts?: { today?: () => string }): Promise<{ app: FastifyInstance; pool: pg.Pool; authCookie: string }>` — truncates `events_expenses` and `events` before returning, logs in once, and hands back a ready-to-use cookie string. Tasks 8, 10, 11 all use this helper instead of repeating login boilerplate.

- [ ] **Step 1: Write `test/helpers/testApp.ts`**

```typescript
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
```

- [ ] **Step 2: There is no standalone test for a test helper — it is exercised by Task 8's tests.** Verify it type-checks.

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add test/helpers/testApp.ts
git commit -m "test: add shared authenticated test app helper"
```

---

### Task 8: Events CRUD routes

**Files:**
- Create: `src/routes/events.ts`
- Modify: `src/app.ts` (register `eventRoutes`)
- Test: `test/events.test.ts`

**Interfaces:**
- Consumes: `eventCreateBody`, `eventUpdateBody`, `eventListQuery` from Task 6; `amountPaidCents`, `dueCents`, `resolveStatus` from Task 4; `HttpError` from Task 1; `buildTestApp`, `AUTH_HEADERS` from Task 7.
- Produces: routes `GET /api/events`, `POST /api/events`, `GET /api/events/:id`, `PATCH /api/events/:id`, `DELETE /api/events/:id`, each returning an event object shaped `{ id, customerName, customerPhone, eventDate, eventType, decorStyle, jobType, priceCents, depositCents, depositPaidOn, restCents, restPaidOn, amountPaidCents, dueCents, status, statusIsManual, notes, createdAt, updatedAt }` (expenses and `finalAmountCents`/`totalExpensesCents` are added by Task 10, which extends the single-event response). `eventRoutes(app, pool, today)` — the `today: () => string` parameter is the same injectable clock `app.ts` already threads through from `BuildOptions.today`.

- [ ] **Step 1: Write the failing test `test/events.test.ts`**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { AUTH_HEADERS, buildTestApp } from './helpers/testApp.js';

describe('events routes', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let authCookie: string;

  beforeEach(async () => {
    ({ app, pool, authCookie } = await buildTestApp({ today: () => '2026-06-15' }));
  });

  afterEach(async () => {
    await app.close();
    await pool.end();
  });

  const validEvent = {
    customerName: 'Priya Rao',
    eventDate: '2026-07-01',
    eventType: 'Wedding',
    decorStyle: 'indian_traditional',
    jobType: 'service',
    priceCents: 50000,
  };

  it('creates an event and returns derived fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: validEvent,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.amountPaidCents).toBe(0);
    expect(body.dueCents).toBe(50000);
    expect(body.status).toBe('outstanding');
    expect(body.statusIsManual).toBe(false);
  });

  it('rejects creating an event with a deposit but no deposit paid-on date', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, depositCents: 10000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists created events sorted by event date', async () => {
    await app.inject({ method: 'POST', url: '/api/events', headers: { ...AUTH_HEADERS, cookie: authCookie }, payload: validEvent });
    await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, customerName: 'Second Customer', eventDate: '2026-08-01' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/events', headers: { cookie: authCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('gets a single event by id', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/events', headers: { ...AUTH_HEADERS, cookie: authCookie }, payload: validEvent });
    const id = created.json().id;
    const res = await app.inject({ method: 'GET', url: `/api/events/${id}`, headers: { cookie: authCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().customerName).toBe('Priya Rao');
  });

  it('returns 404 for a nonexistent event id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/events/00000000-0000-0000-0000-000000000000', headers: { cookie: authCookie } });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a PATCH that raises depositCents without supplying depositPaidOn', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/events', headers: { ...AUTH_HEADERS, cookie: authCookie }, payload: validEvent });
    const id = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${id}`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { depositCents: 10000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a PATCH that pays the deposit with its date and recomputes due', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/events', headers: { ...AUTH_HEADERS, cookie: authCookie }, payload: validEvent });
    const id = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${id}`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { depositCents: 10000, depositPaidOn: '2026-06-10' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().amountPaidCents).toBe(10000);
    expect(res.json().dueCents).toBe(40000);
  });

  it('auto-resolves status to done once the event date has passed and it is fully paid', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, eventDate: '2026-05-01', priceCents: 10000, depositCents: 10000, depositPaidOn: '2026-04-01' },
    });
    expect(created.json().status).toBe('done');
  });

  it('keeps a manually-set status even when auto-resolution would disagree', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, eventDate: '2026-05-01', priceCents: 10000, depositCents: 10000, depositPaidOn: '2026-04-01' },
    });
    const id = created.json().id;
    const manual = await app.inject({
      method: 'PATCH',
      url: `/api/events/${id}`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { status: 'outstanding' },
    });
    expect(manual.json().status).toBe('outstanding');
    expect(manual.json().statusIsManual).toBe(true);

    const reread = await app.inject({ method: 'GET', url: `/api/events/${id}`, headers: { cookie: authCookie } });
    expect(reread.json().status).toBe('outstanding');
  });

  it('resets to automatic status on request', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, eventDate: '2026-05-01', priceCents: 10000, depositCents: 10000, depositPaidOn: '2026-04-01' },
    });
    const id = created.json().id;
    await app.inject({ method: 'PATCH', url: `/api/events/${id}`, headers: { ...AUTH_HEADERS, cookie: authCookie }, payload: { status: 'outstanding' } });
    const reset = await app.inject({
      method: 'PATCH',
      url: `/api/events/${id}`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { resetStatusToAutomatic: true },
    });
    expect(reset.json().statusIsManual).toBe(false);
    expect(reset.json().status).toBe('done');
  });

  it('deletes an event', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/events', headers: { ...AUTH_HEADERS, cookie: authCookie }, payload: validEvent });
    const id = created.json().id;
    const del = await app.inject({ method: 'DELETE', url: `/api/events/${id}`, headers: { ...AUTH_HEADERS, cookie: authCookie } });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `/api/events/${id}`, headers: { cookie: authCookie } });
    expect(get.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- events.test.ts`
Expected: FAIL (404 on all routes — `eventRoutes` does not exist yet)

- [ ] **Step 3: Write `src/routes/events.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { amountPaidCents, dueCents, resolveStatus } from '../compute.js';
import { eventCreateBody, eventListQuery, eventUpdateBody, uuid } from '../schemas.js';
import { HttpError } from '../errors.js';

interface EventRow {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  event_date: string;
  event_type: string;
  decor_style: 'indian_traditional' | 'balloon' | 'both';
  job_type: 'rental' | 'service';
  price_cents: number;
  deposit_cents: number;
  deposit_paid_on: string | null;
  rest_cents: number;
  rest_paid_on: string | null;
  status: 'outstanding' | 'done';
  status_is_manual: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

function toResponse(row: EventRow, today: string) {
  const money = { priceCents: row.price_cents, depositCents: row.deposit_cents, restCents: row.rest_cents };
  const due = dueCents(money);
  const status = resolveStatus({
    eventDate: row.event_date,
    dueCents: due,
    today,
    storedStatus: row.status,
    statusIsManual: row.status_is_manual,
  });
  return {
    id: row.id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    eventDate: row.event_date,
    eventType: row.event_type,
    decorStyle: row.decor_style,
    jobType: row.job_type,
    priceCents: row.price_cents,
    depositCents: row.deposit_cents,
    depositPaidOn: row.deposit_paid_on,
    restCents: row.rest_cents,
    restPaidOn: row.rest_paid_on,
    amountPaidCents: amountPaidCents(money),
    dueCents: due,
    status,
    statusIsManual: row.status_is_manual,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchEvent(pool: pg.Pool, id: string): Promise<EventRow> {
  const res = await pool.query<EventRow>('SELECT * FROM events WHERE id = $1', [id]);
  if (res.rows.length === 0) throw new HttpError(404, 'not_found', 'Event not found.');
  return res.rows[0];
}

export function eventRoutes(app: FastifyInstance, pool: pg.Pool, today: () => string): void {
  app.get('/api/events', async (req) => {
    const q = eventListQuery.parse(req.query);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (q.from) {
      params.push(q.from);
      conditions.push(`event_date >= $${params.length}`);
    }
    if (q.to) {
      params.push(q.to);
      conditions.push(`event_date <= $${params.length}`);
    }
    if (q.jobType) {
      params.push(q.jobType);
      conditions.push(`job_type = $${params.length}`);
    }
    if (q.decorStyle) {
      params.push(q.decorStyle);
      conditions.push(`decor_style = $${params.length}`);
    }
    if (q.q) {
      params.push(`%${q.q}%`);
      conditions.push(`customer_name ILIKE $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const res = await pool.query<EventRow>(`SELECT * FROM events ${where} ORDER BY event_date ASC`, params);
    const t = today();
    const rows = res.rows.map((r) => toResponse(r, t));
    return q.status ? rows.filter((r) => r.status === q.status) : rows;
  });

  app.post('/api/events', async (req, reply) => {
    const body = eventCreateBody.parse(req.body);
    const res = await pool.query<EventRow>(
      `INSERT INTO events
        (customer_name, customer_phone, event_date, event_type, decor_style, job_type,
         price_cents, deposit_cents, deposit_paid_on, rest_cents, rest_paid_on, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        body.customerName,
        body.customerPhone ?? null,
        body.eventDate,
        body.eventType,
        body.decorStyle,
        body.jobType,
        body.priceCents,
        body.depositCents,
        body.depositPaidOn ?? null,
        body.restCents,
        body.restPaidOn ?? null,
        body.notes,
      ],
    );
    return reply.code(201).send(toResponse(res.rows[0], today()));
  });

  app.get('/api/events/:id', async (req) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const row = await fetchEvent(pool, id);
    return toResponse(row, today());
  });

  app.patch('/api/events/:id', async (req) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const body = eventUpdateBody.parse(req.body);
    const existing = await fetchEvent(pool, id);

    const next: Record<string, unknown> = {
      customer_name: body.customerName ?? existing.customer_name,
      customer_phone: body.customerPhone !== undefined ? body.customerPhone : existing.customer_phone,
      event_date: body.eventDate ?? existing.event_date,
      event_type: body.eventType ?? existing.event_type,
      decor_style: body.decorStyle ?? existing.decor_style,
      job_type: body.jobType ?? existing.job_type,
      price_cents: body.priceCents ?? existing.price_cents,
      deposit_cents: body.depositCents ?? existing.deposit_cents,
      deposit_paid_on: body.depositPaidOn !== undefined ? body.depositPaidOn : existing.deposit_paid_on,
      rest_cents: body.restCents ?? existing.rest_cents,
      rest_paid_on: body.restPaidOn !== undefined ? body.restPaidOn : existing.rest_paid_on,
      notes: body.notes ?? existing.notes,
      status: existing.status,
      status_is_manual: existing.status_is_manual,
    };

    if (body.resetStatusToAutomatic) {
      next.status_is_manual = false;
    } else if (body.status) {
      next.status = body.status;
      next.status_is_manual = true;
    }

    const res = await pool.query<EventRow>(
      `UPDATE events SET
        customer_name=$1, customer_phone=$2, event_date=$3, event_type=$4, decor_style=$5, job_type=$6,
        price_cents=$7, deposit_cents=$8, deposit_paid_on=$9, rest_cents=$10, rest_paid_on=$11,
        notes=$12, status=$13, status_is_manual=$14, updated_at=now()
       WHERE id=$15
       RETURNING *`,
      [
        next.customer_name,
        next.customer_phone,
        next.event_date,
        next.event_type,
        next.decor_style,
        next.job_type,
        next.price_cents,
        next.deposit_cents,
        next.deposit_paid_on,
        next.rest_cents,
        next.rest_paid_on,
        next.notes,
        next.status,
        next.status_is_manual,
        id,
      ],
    );
    return toResponse(res.rows[0], today());
  });

  app.delete('/api/events/:id', async (req, reply) => {
    const id = uuid.parse((req.params as { id: string }).id);
    await fetchEvent(pool, id);
    await pool.query('DELETE FROM events WHERE id = $1', [id]);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 4: Modify `src/app.ts`** — add the `today` resolver and register `eventRoutes` after `healthRoutes`

```typescript
import { eventRoutes } from './routes/events.js';
// ...
  healthRoutes(app, pool);
  const today = opts.today ?? (() => new Date().toISOString().slice(0, 10));
  eventRoutes(app, pool, today);
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- events.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 6: Commit**

```bash
git add src/routes/events.ts src/app.ts test/events.test.ts
git commit -m "feat: add events CRUD routes with derived fields and status resolution"
```

---

### Task 9: Status boundary tests against the injected clock

**Files:**
- Modify: `test/events.test.ts` (add boundary cases)

**Interfaces:**
- Consumes: `buildTestApp` from Task 7 with its `today` override; `eventRoutes` from Task 8.
- Produces: nothing new — this task only adds tests pinning the date-boundary behavior called out in Review Focus, so a future change to `resolveStatus`'s wiring in the route layer (not just the pure function tested in Task 4) cannot regress silently.

- [ ] **Step 1: Add boundary tests to `test/events.test.ts`** (append inside the existing `describe('events routes', ...)` block)

```typescript
  it('is outstanding when the event is dated exactly today, even if fully paid', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, eventDate: '2026-06-15', priceCents: 10000, depositCents: 10000, depositPaidOn: '2026-06-01' },
    });
    expect(created.json().status).toBe('outstanding');
  });

  it('is outstanding when due is still positive, even though the event date has passed', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, eventDate: '2026-05-01', priceCents: 10000, depositCents: 5000, depositPaidOn: '2026-04-01' },
    });
    expect(created.json().status).toBe('outstanding');
  });

  it('is done when the event date is yesterday and due is exactly zero', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { ...validEvent, eventDate: '2026-06-14', priceCents: 10000, depositCents: 10000, depositPaidOn: '2026-06-01' },
    });
    expect(created.json().status).toBe('done');
  });
```

- [ ] **Step 2: Run the tests**

Run: `npm test -- events.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 3: Commit**

```bash
git add test/events.test.ts
git commit -m "test: pin event status resolution exactly at the date boundary"
```

---

### Task 10: Expenses sub-resource routes and final-amount field on event reads

**Files:**
- Create: `src/routes/expenses.ts`
- Modify: `src/routes/events.ts` (single-event read includes `expenses`, `totalExpensesCents`, `finalAmountCents`), `src/app.ts` (register `expenseRoutes`)
- Test: `test/expenses.test.ts`

**Interfaces:**
- Consumes: `expenseBody`, `uuid` from Task 6; `totalExpensesCents`, `finalAmountCents` from Task 4; `fetchEvent`-equivalent lookup and `toResponse` extension in `events.ts`.
- Produces: routes `POST /api/events/:id/expenses`, `PATCH /api/events/:id/expenses/:expenseId`, `DELETE /api/events/:id/expenses/:expenseId`; extends `GET /api/events/:id` response with `expenses: { id, amountCents, note, spentOn, createdAt }[]`, `totalExpensesCents`, `finalAmountCents`.

- [ ] **Step 1: Write the failing test `test/expenses.test.ts`**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { AUTH_HEADERS, buildTestApp } from './helpers/testApp.js';

describe('expenses routes', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let authCookie: string;
  let eventId: string;

  beforeEach(async () => {
    ({ app, pool, authCookie } = await buildTestApp({ today: () => '2026-06-15' }));
    const created = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: {
        customerName: 'Priya Rao',
        eventDate: '2026-07-01',
        eventType: 'Wedding',
        decorStyle: 'balloon',
        jobType: 'rental',
        priceCents: 50000,
        depositCents: 20000,
        depositPaidOn: '2026-06-01',
      },
    });
    eventId = created.json().id;
  });

  afterEach(async () => {
    await app.close();
    await pool.end();
  });

  it('adds an expense and reflects it in the event totals', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/expenses`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { amountCents: 1500, note: 'balloons at Party City', spentOn: '2026-06-20' },
    });
    expect(res.statusCode).toBe(201);

    const event = await app.inject({ method: 'GET', url: `/api/events/${eventId}`, headers: { cookie: authCookie } });
    const body = event.json();
    expect(body.expenses).toHaveLength(1);
    expect(body.totalExpensesCents).toBe(1500);
    expect(body.finalAmountCents).toBe(20000 - 1500);
  });

  it('updates an expense', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/expenses`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { amountCents: 1500, note: 'balloons', spentOn: '2026-06-20' },
    });
    const expenseId = created.json().id;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/events/${eventId}/expenses/${expenseId}`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { amountCents: 2000, note: 'balloons and ribbon', spentOn: '2026-06-21' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().amountCents).toBe(2000);
  });

  it('deletes an expense', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/expenses`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { amountCents: 1500, note: 'balloons', spentOn: '2026-06-20' },
    });
    const expenseId = created.json().id;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/events/${eventId}/expenses/${expenseId}`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
    });
    expect(del.statusCode).toBe(204);
    const event = await app.inject({ method: 'GET', url: `/api/events/${eventId}`, headers: { cookie: authCookie } });
    expect(event.json().expenses).toHaveLength(0);
  });

  it('cascade-deletes expenses when the event is deleted', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/expenses`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { amountCents: 1500, note: 'balloons', spentOn: '2026-06-20' },
    });
    await app.inject({ method: 'DELETE', url: `/api/events/${eventId}`, headers: { ...AUTH_HEADERS, cookie: authCookie } });
    const remaining = await pool.query('SELECT * FROM events_expenses WHERE event_id = $1', [eventId]);
    expect(remaining.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- expenses.test.ts`
Expected: FAIL (404 on expense routes; event response has no `expenses` field)

- [ ] **Step 3: Write `src/routes/expenses.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { expenseBody, uuid } from '../schemas.js';
import { HttpError } from '../errors.js';

interface ExpenseRow {
  id: string;
  event_id: string;
  amount_cents: number;
  note: string;
  spent_on: string;
  created_at: string;
}

export function toExpenseResponse(row: ExpenseRow) {
  return { id: row.id, amountCents: row.amount_cents, note: row.note, spentOn: row.spent_on, createdAt: row.created_at };
}

async function ensureEventExists(pool: pg.Pool, eventId: string): Promise<void> {
  const res = await pool.query('SELECT 1 FROM events WHERE id = $1', [eventId]);
  if (res.rows.length === 0) throw new HttpError(404, 'not_found', 'Event not found.');
}

export function expenseRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.post('/api/events/:id/expenses', async (req, reply) => {
    const eventId = uuid.parse((req.params as { id: string }).id);
    await ensureEventExists(pool, eventId);
    const body = expenseBody.parse(req.body);
    const res = await pool.query<ExpenseRow>(
      `INSERT INTO events_expenses (event_id, amount_cents, note, spent_on) VALUES ($1,$2,$3,$4) RETURNING *`,
      [eventId, body.amountCents, body.note, body.spentOn],
    );
    return reply.code(201).send(toExpenseResponse(res.rows[0]));
  });

  app.patch('/api/events/:id/expenses/:expenseId', async (req) => {
    const eventId = uuid.parse((req.params as { id: string }).id);
    const expenseId = uuid.parse((req.params as { expenseId: string }).expenseId);
    await ensureEventExists(pool, eventId);
    const body = expenseBody.parse(req.body);
    const res = await pool.query<ExpenseRow>(
      `UPDATE events_expenses SET amount_cents=$1, note=$2, spent_on=$3 WHERE id=$4 AND event_id=$5 RETURNING *`,
      [body.amountCents, body.note, body.spentOn, expenseId, eventId],
    );
    if (res.rows.length === 0) throw new HttpError(404, 'not_found', 'Expense not found.');
    return toExpenseResponse(res.rows[0]);
  });

  app.delete('/api/events/:id/expenses/:expenseId', async (req, reply) => {
    const eventId = uuid.parse((req.params as { id: string }).id);
    const expenseId = uuid.parse((req.params as { expenseId: string }).expenseId);
    await ensureEventExists(pool, eventId);
    await pool.query('DELETE FROM events_expenses WHERE id = $1 AND event_id = $2', [expenseId, eventId]);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 4: Modify `src/routes/events.ts`** — extend the single-event GET to include expenses and the expense-derived totals. Add the import and change the `GET /api/events/:id` handler:

```typescript
import { amountPaidCents, dueCents, finalAmountCents, resolveStatus, totalExpensesCents } from '../compute.js';
import { toExpenseResponse } from './expenses.js';
```

Replace the existing `app.get('/api/events/:id', ...)` handler body with:

```typescript
  app.get('/api/events/:id', async (req) => {
    const id = uuid.parse((req.params as { id: string }).id);
    const row = await fetchEvent(pool, id);
    const expensesRes = await pool.query(
      'SELECT * FROM events_expenses WHERE event_id = $1 ORDER BY spent_on DESC, created_at DESC',
      [id],
    );
    const expenses = expensesRes.rows.map(toExpenseResponse);
    const base = toResponse(row, today());
    return {
      ...base,
      expenses,
      totalExpensesCents: totalExpensesCents(expenses.map((e) => ({ amountCents: e.amountCents }))),
      finalAmountCents: finalAmountCents(
        { priceCents: row.price_cents, depositCents: row.deposit_cents, restCents: row.rest_cents },
        expenses.map((e) => ({ amountCents: e.amountCents })),
      ),
    };
  });
```

- [ ] **Step 5: Modify `src/app.ts`** — register `expenseRoutes` after `eventRoutes`

```typescript
import { expenseRoutes } from './routes/expenses.js';
// ...
  eventRoutes(app, pool, today);
  expenseRoutes(app, pool);
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- expenses.test.ts events.test.ts`
Expected: PASS (all tests in both files)

- [ ] **Step 7: Commit**

```bash
git add src/routes/expenses.ts src/routes/events.ts src/app.ts test/expenses.test.ts
git commit -m "feat: add expenses sub-resource and extend event detail with totals"
```

---

### Task 11: Reports route

**Files:**
- Create: `src/routes/reports.ts`
- Modify: `src/app.ts` (register `reportRoutes`)
- Test: `test/reports.test.ts`

**Interfaces:**
- Consumes: `reportQuery` from Task 6; `monthToRange` from Task 5; `amountPaidCents`, `dueCents`, `totalExpensesCents` from Task 4; the `events`/`events_expenses` schema from Task 3.
- Produces: `GET /api/reports?month=YYYY-MM` or `GET /api/reports?from=&to=` returning `{ period: { from, to }, totals: { revenueCents, collectedCents, expensesCents, profitCents, outstandingCents }, events: [...], byJobType: { rental: {...}, service: {...} }, byEventType: { [eventType]: {...} } }`, where each breakdown bucket has the same `{ revenueCents, collectedCents, expensesCents, profitCents }` shape as `totals`.

- [ ] **Step 1: Write the failing test `test/reports.test.ts`**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { AUTH_HEADERS, buildTestApp } from './helpers/testApp.js';

describe('reports route', () => {
  let app: FastifyInstance;
  let pool: pg.Pool;
  let authCookie: string;

  async function createEvent(payload: Record<string, unknown>) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload,
    });
    return res.json();
  }

  beforeEach(async () => {
    ({ app, pool, authCookie } = await buildTestApp({ today: () => '2026-10-15' }));
  });

  afterEach(async () => {
    await app.close();
    await pool.end();
  });

  it('totals revenue, collected, expenses, profit, and outstanding for a month', async () => {
    const e1 = await createEvent({
      customerName: 'A',
      eventDate: '2026-10-01',
      eventType: 'Wedding',
      decorStyle: 'indian_traditional',
      jobType: 'service',
      priceCents: 50000,
      depositCents: 20000,
      depositPaidOn: '2026-09-01',
    });
    await app.inject({
      method: 'POST',
      url: `/api/events/${e1.id}/expenses`,
      headers: { ...AUTH_HEADERS, cookie: authCookie },
      payload: { amountCents: 3000, note: 'flowers', spentOn: '2026-09-15' },
    });
    await createEvent({
      customerName: 'B',
      eventDate: '2026-10-31',
      eventType: 'Birthday',
      decorStyle: 'balloon',
      jobType: 'rental',
      priceCents: 20000,
      depositCents: 20000,
      depositPaidOn: '2026-10-01',
    });
    // out of range: should not appear in the October report
    await createEvent({
      customerName: 'C',
      eventDate: '2026-11-01',
      eventType: 'Birthday',
      decorStyle: 'balloon',
      jobType: 'rental',
      priceCents: 10000,
    });

    const res = await app.inject({ method: 'GET', url: '/api/reports?month=2026-10', headers: { cookie: authCookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.events).toHaveLength(2);
    expect(body.totals.revenueCents).toBe(70000);
    expect(body.totals.collectedCents).toBe(40000);
    expect(body.totals.expensesCents).toBe(3000);
    expect(body.totals.profitCents).toBe(40000 - 3000);
    expect(body.totals.outstandingCents).toBe(30000);

    expect(body.byJobType.service.revenueCents).toBe(50000);
    expect(body.byJobType.rental.revenueCents).toBe(20000);

    expect(body.byEventType.Wedding.revenueCents).toBe(50000);
    expect(body.byEventType.Birthday.revenueCents).toBe(20000);
  });

  it('a custom range spanning two months totals the same as summing the two months', async () => {
    await createEvent({
      customerName: 'A',
      eventDate: '2026-10-31',
      eventType: 'Wedding',
      decorStyle: 'indian_traditional',
      jobType: 'service',
      priceCents: 10000,
    });
    await createEvent({
      customerName: 'B',
      eventDate: '2026-11-01',
      eventType: 'Birthday',
      decorStyle: 'balloon',
      jobType: 'rental',
      priceCents: 5000,
    });

    const oct = await app.inject({ method: 'GET', url: '/api/reports?month=2026-10', headers: { cookie: authCookie } });
    const nov = await app.inject({ method: 'GET', url: '/api/reports?month=2026-11', headers: { cookie: authCookie } });
    const range = await app.inject({ method: 'GET', url: '/api/reports?from=2026-10-01&to=2026-11-30', headers: { cookie: authCookie } });

    expect(range.json().totals.revenueCents).toBe(oct.json().totals.revenueCents + nov.json().totals.revenueCents);
  });

  it('rejects a request with neither month nor from/to', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports', headers: { cookie: authCookie } });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- reports.test.ts`
Expected: FAIL (404 — `/api/reports` does not exist yet)

- [ ] **Step 3: Write `src/routes/reports.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { amountPaidCents, dueCents, totalExpensesCents } from '../compute.js';
import { monthToRange } from '../periods.js';
import { reportQuery } from '../schemas.js';
import { toExpenseResponse } from './expenses.js';

interface Bucket {
  revenueCents: number;
  collectedCents: number;
  expensesCents: number;
  profitCents: number;
}

function emptyBucket(): Bucket {
  return { revenueCents: 0, collectedCents: 0, expensesCents: 0, profitCents: 0 };
}

function addToBucket(bucket: Bucket, revenue: number, collected: number, expenses: number): void {
  bucket.revenueCents += revenue;
  bucket.collectedCents += collected;
  bucket.expensesCents += expenses;
  bucket.profitCents += collected - expenses;
}

export function reportRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/api/reports', async (req) => {
    const q = reportQuery.parse(req.query);
    const { from, to } = q.month ? monthToRange(q.month) : { from: q.from!, to: q.to! };

    const eventsRes = await pool.query(
      `SELECT * FROM events WHERE event_date >= $1 AND event_date <= $2 ORDER BY event_date ASC`,
      [from, to],
    );
    const eventIds = eventsRes.rows.map((r) => r.id);
    const expensesByEvent = new Map<string, { amountCents: number }[]>();
    if (eventIds.length > 0) {
      const expensesRes = await pool.query(
        `SELECT * FROM events_expenses WHERE event_id = ANY($1::uuid[])`,
        [eventIds],
      );
      for (const row of expensesRes.rows) {
        const list = expensesByEvent.get(row.event_id) ?? [];
        list.push(toExpenseResponse(row));
        expensesByEvent.set(row.event_id, list);
      }
    }

    const totals = emptyBucket();
    let outstandingCents = 0;
    const byJobType: Record<string, Bucket> = {};
    const byEventType: Record<string, Bucket> = {};
    const eventSummaries = [];

    for (const row of eventsRes.rows) {
      const money = { priceCents: row.price_cents, depositCents: row.deposit_cents, restCents: row.rest_cents };
      const collected = amountPaidCents(money);
      const expenses = totalExpensesCents(expensesByEvent.get(row.id) ?? []);
      const due = dueCents(money);

      addToBucket(totals, row.price_cents, collected, expenses);
      if (due > 0) outstandingCents += due;

      byJobType[row.job_type] ??= emptyBucket();
      addToBucket(byJobType[row.job_type], row.price_cents, collected, expenses);

      byEventType[row.event_type] ??= emptyBucket();
      addToBucket(byEventType[row.event_type], row.price_cents, collected, expenses);

      eventSummaries.push({
        id: row.id,
        customerName: row.customer_name,
        eventDate: row.event_date,
        eventType: row.event_type,
        decorStyle: row.decor_style,
        jobType: row.job_type,
        priceCents: row.price_cents,
        amountPaidCents: collected,
        dueCents: due,
        status: row.status,
      });
    }

    return {
      period: { from, to },
      totals: { ...totals, outstandingCents },
      events: eventSummaries,
      byJobType,
      byEventType,
    };
  });
}
```

- [ ] **Step 4: Modify `src/app.ts`** — register `reportRoutes` after `expenseRoutes`

```typescript
import { reportRoutes } from './routes/reports.js';
// ...
  expenseRoutes(app, pool);
  reportRoutes(app, pool);
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- reports.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS (all tests across all files)

- [ ] **Step 7: Commit**

```bash
git add src/routes/reports.ts src/app.ts test/reports.test.ts
git commit -m "feat: add reports route with totals and job-type/event-type breakdowns"
```

---

### Task 12: PWA shell, API client, and state (frontend foundation)

**Files:**
- Create: `public/index.html`, `public/manifest.webmanifest`, `public/sw.js`, `public/css/app.css`, `public/js/api.js`, `public/js/state.js`, `public/js/money.js`, `public/js/dates.js`, `public/js/ui.js`, `public/js/main.js`, `public/icons/icon-192.png`, `public/icons/icon-512.png`

**Interfaces:**
- Consumes: the `/api` routes from Tasks 2, 8, 10, 11.
- Produces: `api.js` exports `login(password)`, `logout()`, `listEvents(filters)`, `getEvent(id)`, `createEvent(data)`, `updateEvent(id, data)`, `deleteEvent(id)`, `addExpense(eventId, data)`, `updateExpense(eventId, expenseId, data)`, `deleteExpense(eventId, expenseId)`, `getReport(query)` — every one a thin `fetch()` wrapper sending `X-Requested-With: event-decor-tracker` on non-GET requests and throwing `ApiError` (with `.status` and `.message`) on a non-2xx response. `money.js` exports `formatCents(cents)` and `parseToCents(input)`. Later tasks (13, 14) import from `api.js`, `money.js`, `state.js`.

- [ ] **Step 1: Write `public/js/api.js`**

```javascript
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (method !== 'GET') headers['X-Requested-With'] = 'event-decor-tracker';
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? 'Request failed.');
  return data;
}

export const login = (password) => request('POST', '/api/auth/login', { password });
export const logout = () => request('POST', '/api/auth/logout');

export const listEvents = (filters = {}) => {
  const params = new URLSearchParams(filters);
  return request('GET', `/api/events?${params.toString()}`);
};
export const getEvent = (id) => request('GET', `/api/events/${id}`);
export const createEvent = (data) => request('POST', '/api/events', data);
export const updateEvent = (id, data) => request('PATCH', `/api/events/${id}`, data);
export const deleteEvent = (id) => request('DELETE', `/api/events/${id}`);

export const addExpense = (eventId, data) => request('POST', `/api/events/${eventId}/expenses`, data);
export const updateExpense = (eventId, expenseId, data) =>
  request('PATCH', `/api/events/${eventId}/expenses/${expenseId}`, data);
export const deleteExpense = (eventId, expenseId) => request('DELETE', `/api/events/${eventId}/expenses/${expenseId}`);

export const getReport = (query) => {
  const params = new URLSearchParams(query);
  return request('GET', `/api/reports?${params.toString()}`);
};
```

- [ ] **Step 2: Write `public/js/money.js`**

```javascript
export function formatCents(cents) {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseToCents(input) {
  const n = Number(String(input).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
```

- [ ] **Step 3: Write `public/js/dates.js`**

```javascript
export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function currentMonthStr() {
  return todayStr().slice(0, 7);
}
```

- [ ] **Step 4: Write `public/js/state.js`**

```javascript
export const S = {
  authenticated: false,
  events: [],
  currentEvent: null,
  filters: { status: '', jobType: '', decorStyle: '', q: '' },
};
```

- [ ] **Step 5: Write `public/js/ui.js`**

```javascript
export function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}
```

- [ ] **Step 6: Write `public/css/app.css`** (minimal mobile-first baseline; visual design is intentionally out of scope for this plan beyond a usable, legible default)

```css
:root {
  color-scheme: light dark;
  --gap: 12px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, sans-serif;
  padding: var(--gap);
  max-width: 480px;
  margin-inline: auto;
}
.card {
  border: 1px solid #ccc;
  border-radius: 8px;
  padding: var(--gap);
  margin-bottom: var(--gap);
}
.pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.8em;
}
.pill.outstanding { background: #fde68a; }
.pill.done { background: #bbf7d0; }
input, select, textarea, button {
  font-size: 1rem;
  padding: 8px;
  width: 100%;
  margin-bottom: var(--gap);
}
.toast {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: #fff;
  padding: 8px 16px;
  border-radius: 8px;
}
```

- [ ] **Step 7: Write `public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Event Decor Tracker</title>
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="stylesheet" href="/css/app.css" />
</head>
<body>
  <div id="app">Loading…</div>
  <script type="module" src="/js/main.js"></script>
</body>
</html>
```

- [ ] **Step 8: Write `public/manifest.webmanifest`**

```json
{
  "name": "Event Decor Tracker",
  "short_name": "Decor Tracker",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#333333",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 9: Write `public/sw.js`**

```javascript
const VERSION = 'v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/main.js',
  '/js/api.js',
  '/js/state.js',
  '/js/money.js',
  '/js/dates.js',
  '/js/ui.js',
  '/js/views/eventList.js',
  '/js/views/eventForm.js',
  '/js/views/reportView.js',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/')) return;
  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
});
```

- [ ] **Step 10: Create placeholder icons** — generate two flat-color PNGs so the manifest resolves (real artwork is a later, separate design task)

Run (from the repo root, using any available image tool; Node + a tiny inline PNG writer avoids a new dependency):
```bash
node -e "
const zlib = require('zlib');
const fs = require('fs');
function makePng(size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const o = rowStart + 1 + x * 4;
      raw[o] = 0x33; raw[o+1] = 0x33; raw[o+2] = 0x33; raw[o+3] = 0xff;
    }
  }
  const idat = zlib.deflateSync(raw);
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type);
    const crc = Buffer.alloc(4);
    const crcTable = require('zlib').crc32 ? null : null;
    const c = require('crc-32') ? null : null;
    return Buffer.concat([len, typeBuf, data]);
  }
  // Minimal PNG writer without external crc32 dep: use zlib's crc32 via a small manual implementation.
  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  }
  function chunkWithCrc(type, data) {
    const typeBuf = Buffer.from(type);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }
  const sig = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  return Buffer.concat([sig, chunkWithCrc('IHDR', ihdr), chunkWithCrc('IDAT', idat), chunkWithCrc('IEND', Buffer.alloc(0))]);
}
fs.mkdirSync('public/icons', { recursive: true });
fs.writeFileSync('public/icons/icon-192.png', makePng(192));
fs.writeFileSync('public/icons/icon-512.png', makePng(512));
console.log('icons written');
"
```
Expected output: `icons written`, and `public/icons/icon-192.png` / `icon-512.png` exist.

- [ ] **Step 11: Write `public/js/main.js`** (boot stub — wires login gate; `eventList.js`/`eventForm.js`/`reportView.js` views are filled in by Tasks 13–14, so for now `main.js` only needs to reference them by import path, not call into behavior that doesn't exist yet)

```javascript
import { login, logout } from './api.js';
import { qs, toast } from './ui.js';

async function boot() {
  const app = qs('#app');
  app.innerHTML = `
    <form id="login-form">
      <h1>Event Decor Tracker</h1>
      <input type="password" id="password" placeholder="Password" required />
      <button type="submit">Log in</button>
    </form>
  `;
  qs('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await login(qs('#password').value);
      location.reload();
    } catch (err) {
      toast(err.message);
    }
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
```

- [ ] **Step 12: Create empty placeholder view modules so `sw.js`'s precache list resolves** (filled in by Tasks 13–14)

Create `public/js/views/eventList.js`:
```javascript
export function renderEventList() {}
```

Create `public/js/views/eventForm.js`:
```javascript
export function renderEventForm() {}
```

Create `public/js/views/reportView.js`:
```javascript
export function renderReportView() {}
```

- [ ] **Step 13: Manually verify the shell boots**

Run: `npm run build && npm start` (ensure `.env` is populated locally first, per `.env.example`)
Open `http://localhost:3100` in a browser — expect the login form to render with no console errors, and `/manifest.webmanifest` and `/sw.js` to load successfully (check the Network tab).

- [ ] **Step 14: Commit**

```bash
git add public
git commit -m "feat: add PWA shell, API client, and login gate"
```

---

### Task 13: Event list and event form views

**Files:**
- Modify: `public/js/views/eventList.js`, `public/js/views/eventForm.js`, `public/js/main.js`

**Interfaces:**
- Consumes: `listEvents`, `getEvent`, `createEvent`, `updateEvent`, `deleteEvent`, `addExpense`, `updateExpense`, `deleteExpense` from `api.js` (Task 12); `formatCents`, `parseToCents` from `money.js`; `S` from `state.js`; `qs`, `toast` from `ui.js`.
- Produces: `renderEventList(container)` — fetches and renders the filterable event list, wires a "New Event" button to `renderEventForm(container)`; `renderEventForm(container, eventId?)` — create/edit form per spec section 7 (customer, date picker, event type, decor style, job type, price, deposit+date, rest+date, computed due amount, status control with auto/manual indicator, notes, inline expenses sub-list, computed final amount). Task 15 (`main.js` wiring) calls both as the two primary screens.

- [ ] **Step 1: Write `public/js/views/eventList.js`**

```javascript
import { deleteEvent, listEvents } from '../api.js';
import { formatCents } from '../money.js';
import { qs, toast } from '../ui.js';
import { renderEventForm } from './eventForm.js';

export async function renderEventList(container) {
  container.innerHTML = `
    <div class="card">
      <button id="new-event">+ New Event</button>
      <input id="search" placeholder="Search customer…" />
      <select id="filter-status">
        <option value="">All statuses</option>
        <option value="outstanding">Outstanding</option>
        <option value="done">Done</option>
      </select>
    </div>
    <div id="list"></div>
  `;

  async function load() {
    const q = qs('#search', container).value;
    const status = qs('#filter-status', container).value;
    const events = await listEvents({ ...(q ? { q } : {}), ...(status ? { status } : {}) });
    const list = qs('#list', container);
    list.innerHTML = events
      .map(
        (e) => `
      <div class="card" data-id="${e.id}">
        <strong>${e.customerName}</strong> — ${e.eventDate}<br/>
        ${e.eventType} · ${e.jobType} · ${e.decorStyle}<br/>
        Price: ${formatCents(e.priceCents)} | Due: ${formatCents(e.dueCents)}
        <span class="pill ${e.status}">${e.status}</span>
        <button class="open">Open</button>
        <button class="delete">Delete</button>
      </div>`,
      )
      .join('');

    list.querySelectorAll('.card').forEach((card) => {
      const id = card.dataset.id;
      card.querySelector('.open').addEventListener('click', () => renderEventForm(container, id));
      card.querySelector('.delete').addEventListener('click', async () => {
        if (!confirm('Delete this event?')) return;
        await deleteEvent(id);
        toast('Event deleted');
        load();
      });
    });
  }

  qs('#new-event', container).addEventListener('click', () => renderEventForm(container));
  qs('#search', container).addEventListener('input', load);
  qs('#filter-status', container).addEventListener('change', load);

  await load();
}
```

- [ ] **Step 2: Write `public/js/views/eventForm.js`**

```javascript
import { addExpense, createEvent, deleteExpense, getEvent, updateEvent, updateExpense } from '../api.js';
import { formatCents, parseToCents } from '../money.js';
import { qs, toast } from '../ui.js';
import { renderEventList } from './eventList.js';

export async function renderEventForm(container, eventId) {
  const event = eventId ? await getEvent(eventId) : null;

  container.innerHTML = `
    <form id="event-form" class="card">
      <button type="button" id="back">&larr; Back</button>
      <label>Customer name<input name="customerName" required value="${event?.customerName ?? ''}" /></label>
      <label>Phone<input name="customerPhone" value="${event?.customerPhone ?? ''}" /></label>
      <label>Event date<input type="date" name="eventDate" required value="${event?.eventDate ?? ''}" /></label>
      <label>Event type<input name="eventType" required value="${event?.eventType ?? ''}" /></label>
      <label>Decor style
        <select name="decorStyle" required>
          ${['indian_traditional', 'balloon', 'both']
            .map((v) => `<option value="${v}" ${event?.decorStyle === v ? 'selected' : ''}>${v}</option>`)
            .join('')}
        </select>
      </label>
      <label>Job type
        <select name="jobType" required>
          ${['rental', 'service']
            .map((v) => `<option value="${v}" ${event?.jobType === v ? 'selected' : ''}>${v}</option>`)
            .join('')}
        </select>
      </label>
      <label>Price<input name="price" type="number" step="0.01" required value="${event ? event.priceCents / 100 : ''}" /></label>
      <label>Deposit amount<input name="deposit" type="number" step="0.01" value="${event ? event.depositCents / 100 : ''}" /></label>
      <label>Deposit paid on<input type="date" name="depositPaidOn" value="${event?.depositPaidOn ?? ''}" /></label>
      <label>Rest amount<input name="rest" type="number" step="0.01" value="${event ? event.restCents / 100 : ''}" /></label>
      <label>Rest paid on<input type="date" name="restPaidOn" value="${event?.restPaidOn ?? ''}" /></label>
      ${event ? `<p>Due: ${formatCents(event.dueCents)}</p>` : ''}
      ${
        event
          ? `<label>Status
          <select name="status">
            <option value="outstanding" ${event.status === 'outstanding' ? 'selected' : ''}>Outstanding</option>
            <option value="done" ${event.status === 'done' ? 'selected' : ''}>Done</option>
          </select>
          ${event.statusIsManual ? '<button type="button" id="reset-status">Reset to automatic</button>' : '<em>Automatic</em>'}
        </label>`
          : ''
      }
      <label>Notes<textarea name="notes">${event?.notes ?? ''}</textarea></label>
      <button type="submit">${event ? 'Save' : 'Create'}</button>
    </form>
    ${event ? '<div id="expenses" class="card"></div>' : ''}
  `;

  qs('#back', container).addEventListener('click', () => renderEventList(container));

  if (event) {
    renderExpenses(qs('#expenses', container), event);
    const resetBtn = qs('#reset-status', container);
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        await updateEvent(event.id, { resetStatusToAutomatic: true });
        toast('Status reset to automatic');
        renderEventForm(container, event.id);
      });
    }
  }

  qs('#event-form', container).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      customerName: form.get('customerName'),
      customerPhone: form.get('customerPhone') || null,
      eventDate: form.get('eventDate'),
      eventType: form.get('eventType'),
      decorStyle: form.get('decorStyle'),
      jobType: form.get('jobType'),
      priceCents: parseToCents(form.get('price')),
      depositCents: parseToCents(form.get('deposit') || '0'),
      depositPaidOn: form.get('depositPaidOn') || null,
      restCents: parseToCents(form.get('rest') || '0'),
      restPaidOn: form.get('restPaidOn') || null,
      notes: form.get('notes'),
    };
    if (event) payload.status = form.get('status');
    try {
      if (event) {
        await updateEvent(event.id, payload);
        toast('Event saved');
      } else {
        const created = await createEvent(payload);
        toast('Event created');
        return renderEventForm(container, created.id);
      }
      renderEventForm(container, event.id);
    } catch (err) {
      toast(err.message);
    }
  });
}

function renderExpenses(el, event) {
  el.innerHTML = `
    <h3>Expenses</h3>
    <ul id="expense-list">
      ${event.expenses
        .map(
          (x) => `<li data-id="${x.id}">${x.spentOn} — ${formatCents(x.amountCents)} — ${x.note}
          <button class="delete-expense">x</button></li>`,
        )
        .join('')}
    </ul>
    <p>Total expenses: ${formatCents(event.totalExpensesCents)} | Final amount: ${formatCents(event.finalAmountCents)}</p>
    <form id="expense-form">
      <input name="amount" type="number" step="0.01" placeholder="Amount" required />
      <input name="note" placeholder="Note (e.g. where bought)" />
      <input name="spentOn" type="date" required />
      <button type="submit">Add expense</button>
    </form>
  `;

  el.querySelectorAll('.delete-expense').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('li').dataset.id;
      await deleteExpense(event.id, id);
      const refreshed = await (await import('../api.js')).getEvent(event.id);
      renderExpenses(el, refreshed);
    });
  });

  qs('#expense-form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await addExpense(event.id, {
      amountCents: parseToCents(form.get('amount')),
      note: form.get('note') || '',
      spentOn: form.get('spentOn'),
    });
    const refreshed = await (await import('../api.js')).getEvent(event.id);
    renderExpenses(el, refreshed);
  });
}
```

- [ ] **Step 2: Manually verify in the browser**

Run: `npm run dev`, open `http://localhost:3100`, log in, create an event, add an expense, edit the event, verify due/final amounts update after each save and the expense list refreshes without a full page reload.

- [ ] **Step 3: Commit**

```bash
git add public/js/views/eventList.js public/js/views/eventForm.js
git commit -m "feat: implement event list and event form views"
```

---

### Task 14: Reports view and navigation wiring

**Files:**
- Modify: `public/js/views/reportView.js`, `public/js/main.js`

**Interfaces:**
- Consumes: `getReport` from `api.js`; `formatCents` from `money.js`; `currentMonthStr` from `dates.js`; `renderEventList`, `renderEventForm` from Task 13.
- Produces: `renderReportView(container)` — period picker (month or custom range), totals card, Rental-vs-Service table, event-type table, event list for the period; `main.js` gets a persistent bottom nav switching between Events and Reports once authenticated.

- [ ] **Step 1: Write `public/js/views/reportView.js`**

```javascript
import { getReport } from '../api.js';
import { currentMonthStr } from '../dates.js';
import { formatCents } from '../money.js';
import { qs } from '../ui.js';

export async function renderReportView(container) {
  container.innerHTML = `
    <div class="card">
      <label><input type="radio" name="mode" value="month" checked /> Month</label>
      <input type="month" id="month" value="${currentMonthStr()}" />
      <label><input type="radio" name="mode" value="range" /> Custom range</label>
      <input type="date" id="from" disabled />
      <input type="date" id="to" disabled />
    </div>
    <div id="report"></div>
  `;

  function setMode(mode) {
    qs('#month', container).disabled = mode !== 'month';
    qs('#from', container).disabled = mode !== 'range';
    qs('#to', container).disabled = mode !== 'range';
  }

  container.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', (e) => { setMode(e.target.value); load(); }));
  qs('#month', container).addEventListener('change', load);
  qs('#from', container).addEventListener('change', load);
  qs('#to', container).addEventListener('change', load);

  async function load() {
    const mode = container.querySelector('input[name="mode"]:checked').value;
    const query = mode === 'month' ? { month: qs('#month', container).value } : { from: qs('#from', container).value, to: qs('#to', container).value };
    if (mode === 'range' && (!query.from || !query.to)) return;
    const report = await getReport(query);
    renderReport(qs('#report', container), report);
  }

  function renderReport(el, report) {
    const row = (label, b) => `
      <tr><td>${label}</td><td>${formatCents(b.revenueCents)}</td><td>${formatCents(b.collectedCents)}</td><td>${formatCents(b.expensesCents)}</td><td>${formatCents(b.profitCents)}</td></tr>`;

    el.innerHTML = `
      <div class="card">
        <h3>Totals</h3>
        <p>Revenue: ${formatCents(report.totals.revenueCents)}</p>
        <p>Collected: ${formatCents(report.totals.collectedCents)}</p>
        <p>Expenses: ${formatCents(report.totals.expensesCents)}</p>
        <p>Profit: ${formatCents(report.totals.profitCents)}</p>
        <p>Outstanding: ${formatCents(report.totals.outstandingCents)}</p>
      </div>
      <div class="card">
        <h3>By job type</h3>
        <table>
          <tr><th></th><th>Revenue</th><th>Collected</th><th>Expenses</th><th>Profit</th></tr>
          ${Object.entries(report.byJobType).map(([k, b]) => row(k, b)).join('')}
        </table>
      </div>
      <div class="card">
        <h3>By event type</h3>
        <table>
          <tr><th></th><th>Revenue</th><th>Collected</th><th>Expenses</th><th>Profit</th></tr>
          ${Object.entries(report.byEventType).map(([k, b]) => row(k, b)).join('')}
        </table>
      </div>
      <div class="card">
        <h3>Events (${report.events.length})</h3>
        <ul>
          ${report.events.map((e) => `<li>${e.eventDate} — ${e.customerName} — ${formatCents(e.priceCents)} — <span class="pill ${e.status}">${e.status}</span></li>`).join('')}
        </ul>
      </div>
    `;
  }

  await load();
}
```

- [ ] **Step 2: Rewrite `public/js/main.js`** to add post-login navigation between Events and Reports

```javascript
import { login } from './api.js';
import { qs, toast } from './ui.js';
import { renderEventList } from './views/eventList.js';
import { renderReportView } from './views/reportView.js';

function renderShell() {
  const app = qs('#app');
  app.innerHTML = `
    <nav class="card">
      <button id="nav-events">Events</button>
      <button id="nav-reports">Reports</button>
    </nav>
    <div id="screen"></div>
  `;
  const screen = qs('#screen');
  qs('#nav-events').addEventListener('click', () => renderEventList(screen));
  qs('#nav-reports').addEventListener('click', () => renderReportView(screen));
  renderEventList(screen);
}

async function boot() {
  const app = qs('#app');
  app.innerHTML = `
    <form id="login-form" class="card">
      <h1>Event Decor Tracker</h1>
      <input type="password" id="password" placeholder="Password" required />
      <button type="submit">Log in</button>
    </form>
  `;
  qs('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await login(qs('#password').value);
      renderShell();
    } catch (err) {
      toast(err.message);
    }
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
```

- [ ] **Step 3: Bump the service worker cache version** in `public/sw.js` since `public/` files changed

Change `const VERSION = 'v1';` to `const VERSION = 'v2';` in `public/sw.js`.

- [ ] **Step 4: Manually verify in the browser**

Run: `npm run dev`, open `http://localhost:3100`, log in, switch between Events and Reports, pick a month with events in it, switch to a custom range, verify totals/breakdowns/list all render and match expectations from Task 11's integration tests.

- [ ] **Step 5: Commit**

```bash
git add public/js/views/reportView.js public/js/main.js public/sw.js
git commit -m "feat: add reports view and post-login navigation"
```

---

### Task 15: Dockerfile, railway.json, and deployment to the shared Railway project

**Files:**
- Create: `Dockerfile`, `railway.json`

**Interfaces:**
- Consumes: `package.json` scripts from Task 1; `migrations/` from Task 3; `public/` from Tasks 12–14.
- Produces: a container image buildable by Railway; this task's deliverable is the deployed, smoke-tested service, not more code.

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY public ./public
USER node
EXPOSE 3100
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Write `railway.json`**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": { "healthcheckPath": "/healthz", "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 5 }
}
```

- [ ] **Step 3: Build the Docker image locally to confirm it builds**

Run: `docker build -t event-decor-tracker .`
Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile railway.json
git commit -m "feat: add Dockerfile and Railway deploy config"
```

- [ ] **Step 5: Push the repo to GitHub and create the Railway service** (manual, outside the test cycle — confirm with the user before doing this, since it touches shared infrastructure)

1. Create a new GitHub repo and push.
2. In the **same Railway project** as Pocket Ledger, create a new service from this repo (builds via `Dockerfile`).
3. Set env vars on the new service: `DATABASE_URL` = the same `${{Postgres.DATABASE_URL}}` reference Pocket Ledger uses; `SESSION_SECRET` = a **new** `openssl rand -hex 32`; `APP_PASSWORD_HASH` = output of `npm run hash-password` with a **new** password; `NODE_ENV=production`; `APP_TIMEZONE` = same IANA zone as Pocket Ledger.
4. Generate a public domain for the service.
5. Deploy. Confirm migrations run (check logs for `migrations applied` or `Up to date`), confirm `events_schema_migrations` now exists on the shared Postgres server alongside Pocket Ledger's `schema_migrations`, and confirm Pocket Ledger's own tables and app are unaffected (open Pocket Ledger, verify its data is intact).
6. Log in on the new deployed URL, create a test event, confirm it persists after a redeploy.

---

## Self-Review Notes

- **Spec coverage:** Every data-model field (spec §5), every API route (spec §6), every frontend behavior (spec §7), testing approach (spec §8), and deployment step (spec §9) has a corresponding task. The YAGNI list (spec §10) is respected — no customer table, no >2 payment slots, no multi-user auth was introduced anywhere in this plan.
- **Placeholder scan:** No "TBD"/"TODO" remain; every code step has complete, runnable code; no step says "similar to Task N" without the actual code repeated.
- **Type consistency:** `EventMoney { priceCents, depositCents, restCents }` (Task 4) is used identically in Tasks 8, 10, 11. `resolveStatus`'s parameter names match between Task 4's definition and Task 8's call site. The expense response shape `{ id, amountCents, note, spentOn, createdAt }` (Task 10's `toExpenseResponse`) is reused as-is by Task 11's report route.
- **Review Focus coverage:** All five items (deposit/rest-without-date, status boundary, manual-override persistence, cascade-delete, month/range boundary) have dedicated tests in Tasks 6, 8, 9, 10, and 11 respectively.
