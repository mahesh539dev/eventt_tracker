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
