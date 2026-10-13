import { createPool } from './db.js';
import { loadConfig } from './config.js';
import { startWorker } from './services/queue-worker.js';
const db = createPool(loadConfig().databaseUrl);
const stop = startWorker(db, { error: (error) => console.error(error) });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => void stop().then(() => db.end()));
