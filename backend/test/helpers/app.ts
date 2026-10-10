import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';

export const testConfig: AppConfig = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'unused-by-injected-app',
  redisUrl: 'unused-by-injected-app',
  internalApiKey: 'test-internal-key',
  rateLimitMax: 10_000,
  rateLimitWindowMs: 60_000,
  redisRateLimitFailOpen: true,
};

export function buildTestApp(db: Pool): Promise<FastifyInstance> {
  return buildApp({ config: testConfig, db });
}
