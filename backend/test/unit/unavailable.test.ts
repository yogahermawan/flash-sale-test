import { expect, it } from 'vitest';
import type { Pool } from 'pg';
import { buildApp } from '../../src/app.js';
import { testConfig } from '../helpers/app.js';
it('returns a retryable 503 when acquisition or database lock times out', async () => {
  for (const error of [Object.assign(new Error('lock timeout'), { code: '55P03' }), new Error('timeout exceeded when trying to connect')]) {
    const db = { connect: async () => { throw error; } } as unknown as Pool;
    const app = await buildApp({ config: testConfig, db });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/purchases', headers: { 'idempotency-key': 'f47ac10b-58cc-4372-a567-0e02b2c3d479' }, payload: { userId: 'retry@example.com' } });
      expect(response.statusCode).toBe(503);
      expect(response.headers['retry-after']).toBe('1');
      expect(response.json().code).toBe('PURCHASE_UNAVAILABLE');
    } finally { await app.close(); }
  }
});
