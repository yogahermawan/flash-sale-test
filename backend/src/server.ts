import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createRedisClient } from './redis.js';

const config = loadConfig();
const db = createPool(config.databaseUrl);
const redis = createRedisClient(config.redisUrl);
const app = await buildApp({ config, db, redis });

async function shutdown(): Promise<void> {
  await app.close();
  await redis.quit();
  await db.end();
}

process.once('SIGINT', () => void shutdown().then(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().then(() => process.exit(0)));
await app.listen({ port: config.port, host: '0.0.0.0' });
