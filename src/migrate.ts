import { loadConfig } from './config.js';
import { createPool, runMigrations } from './db.js';

const pool = createPool(loadConfig().DATABASE_URL);
runMigrations(pool)
  .then((applied) => console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Up to date'))
  .then(() => pool.end())
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
