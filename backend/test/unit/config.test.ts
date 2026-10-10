import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('rejects missing database configuration', () => {
    expect(() => loadConfig({ INTERNAL_API_KEY: 'key', REDIS_URL: 'redis://localhost:6379' })).toThrow('DATABASE_URL is required');
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://example', REDIS_URL: 'redis://localhost:6379', INTERNAL_API_KEY: 'key', PORT: '0' })).toThrow('PORT must be a positive integer');
  });
});
