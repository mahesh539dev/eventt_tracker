import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type pg from 'pg';
import { installAuth } from './auth.js';
import type { Config } from './config.js';
import { installErrorHandling } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { eventRoutes } from './routes/events.js';
import { expenseRoutes } from './routes/expenses.js';
import { healthRoutes } from './routes/health.js';
import { globalExpenseRoutes } from './routes/globalExpenses.js';
import { reportRoutes } from './routes/reports.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface BuildOptions {
  logger?: boolean;
  /** Overrides "today" (YYYY-MM-DD). Tests use this; production derives it from APP_TIMEZONE. */
  today?: () => string;
}

/** Builds the production "today" resolver: current date in `timezone`, formatted as YYYY-MM-DD. Exported for testing. */
export function makeTodayResolver(timezone: string): () => string {
  return () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
}

export async function buildApp(config: Config, pool: pg.Pool, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const logger = opts.logger ?? config.NODE_ENV !== 'test';
  const app = Fastify({
    // Trust exactly one hop (Railway's edge proxy) for X-Forwarded-* headers; further-forwarded
    // values are ignored, closing the IP-spoofing bypass that `trustProxy: true` would allow.
    // Fastify supports a numeric hop count at runtime (lib/request.js), but its published types
    // don't include `number` in the `trustProxy` union, hence the cast.
    trustProxy: 1 as unknown as boolean,
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
  installAuth(app, config);
  authRoutes(app, config);
  healthRoutes(app, pool);
  const today = opts.today ?? makeTodayResolver(config.APP_TIMEZONE);
  eventRoutes(app, pool, today);
  expenseRoutes(app, pool);
  globalExpenseRoutes(app, pool);
  reportRoutes(app, pool, today);

  await app.register(fastifyStatic, { root: path.resolve(here, '..', 'public') });

  return app;
}
