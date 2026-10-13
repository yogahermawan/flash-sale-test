import { startWorker } from './services/queue-worker.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createRedisClient } from './redis.js';

const config = loadConfig();
const db = createPool(config.databaseUrl);
const redis = createRedisClient(config.redisUrl);
const app = await buildApp({ config, db, redis });

await app.orderEvents.start();
const stopWorker =
  process.env.RUN_WORKER === 'false'
    ? async () => {}
    : startWorker(db, app.log);

async function shutdown(): Promise<void> {
  await stopWorker();
  await app.close();
  await redis.quit();
  await db.end();
}

process.once('SIGINT', () => void shutdown().then(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)));
await app.listen({ port: config.port, host: '0.0.0.0' });
