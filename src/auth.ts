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
