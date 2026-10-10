import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

// `pnpm -C backend …` runs with backend/ as its working directory, while a
// direct root command runs from the repository root. Support both without
// requiring shell-specific `source`/export syntax.
for (const envPath of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')]) {
  if (existsSync(envPath)) loadDotenv({ path: envPath, quiet: true });
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  redisUrl: string;
  internalApiKey: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  redisRateLimitFailOpen: boolean;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }

  return {
    nodeEnv,
    port: positiveInteger(env.PORT, 'PORT', 3000),
    databaseUrl: required(env.DATABASE_URL, 'DATABASE_URL'),
    redisUrl: required(env.REDIS_URL, 'REDIS_URL'),
    internalApiKey: required(env.INTERNAL_API_KEY, 'INTERNAL_API_KEY'),
    rateLimitMax: positiveInteger(env.RATE_LIMIT_MAX, 'RATE_LIMIT_MAX', 30),
    rateLimitWindowMs: positiveInteger(env.RATE_LIMIT_WINDOW_MS, 'RATE_LIMIT_WINDOW_MS', 60_000),
    redisRateLimitFailOpen: env.REDIS_RATE_LIMIT_FAIL_OPEN !== 'false',
  };
}
