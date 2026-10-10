import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildTestApp, testConfig } from '../helpers/app.js';
import { ensureTestSchema, hasTestDatabase, resetTestSale, testPool } from '../helpers/database.js';
import { buildApp } from '../../src/app.js';

const describeDatabase = describe.skipIf(!hasTestDatabase);

describeDatabase('purchase API integration', () => {
  let db: Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = testPool();
    await ensureTestSchema(db);
    app = await buildTestApp(db);
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
  });

  const purchase = (userId: string, key = randomUUID()) => app.inject({
    method: 'POST', url: '/api/purchases',
    headers: { 'idempotency-key': key }, payload: { userId },
  });

  it('confirms once, returns the same order for an idempotent retry, and preserves stock', async () => {
    await resetTestSale(db, { initialStock: 2 });
    const key = randomUUID();
    const first = await purchase('first@example.com', key);
    const retry = await purchase('first@example.com', key);
    const sale = await app.inject({ method: 'GET', url: '/api/sale' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ outcome: 'confirmed' });
    expect(retry.json()).toEqual(first.json());
    expect(sale.json().stockRemaining).toBe(1);
  });

  it('enforces one item per user and rejects an idempotency key reused by another user', async () => {
    await resetTestSale(db, { initialStock: 2 });
    const key = randomUUID();
    const confirmed = await purchase('same@example.com', key);
    const duplicateUser = await purchase('same@example.com');
    const stolenKey = await purchase('other@example.com', key);
    expect(duplicateUser.json()).toEqual({ outcome: 'already_purchased', orderId: confirmed.json().orderId });
    expect(stolenKey.statusCode).toBe(409);
    expect(stolenKey.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('returns upcoming, ended, and sold_out without creating orders', async () => {
    const now = Date.now();
    await resetTestSale(db, { startsAt: new Date(now + 60_000), endsAt: new Date(now + 120_000) });
    expect((await purchase('upcoming@example.com')).json()).toEqual({ outcome: 'upcoming' });

    await resetTestSale(db, { startsAt: new Date(now - 120_000), endsAt: new Date(now - 60_000) });
    expect((await purchase('ended@example.com')).json()).toEqual({ outcome: 'ended' });

    await resetTestSale(db, { initialStock: 0 });
    expect((await purchase('sold-out@example.com')).json()).toEqual({ outcome: 'sold_out' });
  });

  it('validates requests and exposes purchase lookup', async () => {
    await resetTestSale(db);
    expect((await app.inject({ method: 'POST', url: '/api/purchases', payload: { userId: 'x@example.com' } })).statusCode).toBe(400);
    await purchase('lookup@example.com');
    expect((await app.inject({ method: 'GET', url: '/api/purchases/me?userId=lookup@example.com' })).json()).toMatchObject({ purchased: true });
    expect((await app.inject({ method: 'GET', url: '/api/purchases/me?userId=none@example.com' })).json()).toEqual({ purchased: false });
  });

  it('requires the internal key and omits internal routes in production', async () => {
    await resetTestSale(db);
    const missingKey = await app.inject({ method: 'GET', url: '/api/internal/metrics' });
    expect(missingKey.statusCode).toBe(404);
    const productionApp = await buildApp({ config: { ...testConfig, nodeEnv: 'production' }, db });
    expect((await productionApp.inject({ method: 'GET', url: '/api/internal/metrics' })).statusCode).toBe(404);
    await productionApp.close();
  });
});
