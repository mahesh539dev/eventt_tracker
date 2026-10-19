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
