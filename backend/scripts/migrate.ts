import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { createPool, inTransaction } from '../src/db.js';

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');
const db = createPool(loadConfig().databaseUrl);

try {
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  await inTransaction(db, async (client) => {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of files) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (exists.rowCount) continue;
      await client.query(await readFile(resolve(migrationsDir, name), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      console.log(`Applied ${name}`);
    }
  });
} finally {
  await db.end();
}
