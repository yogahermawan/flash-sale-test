import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildTestApp } from '../helpers/app.js';
import {
  ensureTestSchema,
  resetTestSale,
  testPool,
} from '../helpers/database.js';
import { processNext } from '../../src/services/queue-worker.js';

describe('FIFO concurrency', () => {
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
  const buy = (userId: string, key = randomUUID()) =>
    app.inject({
      method: 'POST',
      url: '/api/purchases',
      headers: { 'idempotency-key': key },
      payload: { userId },
    });
  const drain = async () => {
    while (await processNext(db)) {}
  };
  it('confirms the first admitted users without overselling, with competing workers', async () => {
    await resetTestSale(db, { initialStock: 3 });
    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, i) => buy(`user-${i}`)),
    );
    expect(responses.every((r) => r.statusCode === 202)).toBe(true);
    await Promise.all([drain(), drain(), drain()]);
    const attempts = await db.query(
      'SELECT status FROM purchase_attempts ORDER BY sequence',
    );
    expect(attempts.rows.map((r) => r.status)).toEqual([
      ...Array(3).fill('confirmed'),
      ...Array(27).fill('sold_out'),
    ]);
    const metrics = await app.inject({
      method: 'GET',
      url: '/api/internal/metrics',
      headers: { 'x-internal-api-key': 'test-internal-key' },
    });
    expect(metrics.json()).toMatchObject({
      stockRemaining: 0,
      confirmedOrderCount: 3,
      duplicateUserCount: 0,
      invariants: {
        stockConserved: true,
        noOversell: true,
        stockNonNegative: true,
        uniqueConfirmedUsers: true,
      },
    });
  });
  it('accepts one durable attempt for concurrent same-key retries', async () => {
    await resetTestSale(db, { initialStock: 5 });
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => buy('retry', key)),
    );
    expect(new Set(responses.map((r) => r.json().attemptId)).size).toBe(1);
    await drain();
    expect(
      (await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,
    ).toBe(1);
  });
  it('confirms one order for the same user with different keys', async () => {
    await resetTestSale(db, { initialStock: 5 });
    await Promise.all(Array.from({ length: 20 }, () => buy('same')));
    await drain();
    const counts = await db.query(
      'SELECT status,count(*)::int AS n FROM purchase_attempts GROUP BY status',
    );
    expect(counts.rows).toEqual(
      expect.arrayContaining([
        { status: 'confirmed', n: 1 },
        { status: 'already_purchased', n: 19 },
      ]),
    );
    expect(
      (await db.query('SELECT stock_remaining FROM flash_sales')).rows[0]
        .stock_remaining,
    ).toBe(4);
  });
});
