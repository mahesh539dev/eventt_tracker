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
