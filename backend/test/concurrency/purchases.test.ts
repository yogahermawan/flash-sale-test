import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildTestApp } from '../helpers/app.js';
import { ensureTestSchema, resetTestSale, testPool } from '../helpers/database.js';

describe('concurrent purchases', () => {
  let db: Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = testPool();
    await ensureTestSchema(db);
    app = await buildTestApp(db);
  });

  afterAll(async () => { await app?.close(); await db?.end(); });

  it('never oversells a limited sale under concurrent unique-user requests', async () => {
    await resetTestSale(db, { initialStock: 3 });
    const responses = await Promise.all(Array.from({ length: 30 }, (_, index) => app.inject({
      method: 'POST', url: '/api/purchases', headers: { 'idempotency-key': randomUUID() }, payload: { userId: `user-${index}@example.com` },
    })));
    const outcomes = responses.map((response) => response.json().outcome);
    expect(outcomes.filter((outcome) => outcome === 'confirmed')).toHaveLength(3);
    expect(outcomes.filter((outcome) => outcome === 'sold_out')).toHaveLength(27);
    const metrics = await app.inject({ method: 'GET', url: '/api/internal/metrics', headers: { 'x-internal-api-key': 'test-internal-key' } });
    expect(metrics.json()).toMatchObject({
      stockRemaining: 0,
      confirmedOrderCount: 3,
      duplicateUserCount: 0,
      invariants: { stockNonNegative: true, noOversell: true, uniqueConfirmedUsers: true, stockConserved: true },
    });
  });

  it('creates one order when same user/key submits concurrently', async () => {
    await resetTestSale(db, { initialStock: 5 });
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 20 }, () => app.inject({
      method: 'POST', url: '/api/purchases', headers: { 'idempotency-key': key }, payload: { userId: 'retry@example.com' },
    })));
    const orders = new Set(responses.map((response) => response.json().orderId));
    expect(orders.size).toBe(1);
    const metrics = await app.inject({ method: 'GET', url: '/api/internal/metrics', headers: { 'x-internal-api-key': 'test-internal-key' } });
    expect(metrics.json()).toMatchObject({ stockRemaining: 4, confirmedOrderCount: 1 });
  });
  it('creates one order for concurrent same-user attempts with different keys', async () => {
    await resetTestSale(db, { initialStock: 5 });
    const responses = await Promise.all(Array.from({ length: 20 }, () => app.inject({
      method: 'POST', url: '/api/purchases', headers: { 'idempotency-key': randomUUID() }, payload: { userId: 'same-user@example.com' },
    })));
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(responses.filter((response) => response.json().outcome === 'confirmed')).toHaveLength(1);
    expect(responses.filter((response) => response.json().outcome === 'already_purchased')).toHaveLength(19);
    expect(new Set(responses.map((response) => response.json().orderId)).size).toBe(1);
    const count = await db.query('SELECT count(*)::int AS count FROM orders');
    expect(count.rows[0].count).toBe(1);
  });

});
