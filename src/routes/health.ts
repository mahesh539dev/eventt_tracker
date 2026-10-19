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
