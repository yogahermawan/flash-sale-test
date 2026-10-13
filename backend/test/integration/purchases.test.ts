import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { buildTestApp, testConfig } from '../helpers/app.js';
import {
  ensureTestSchema,
  resetTestSale,
  testPool,
} from '../helpers/database.js';
import { buildApp } from '../../src/app.js';
import { processNext } from '../../src/services/queue-worker.js';

describe('async purchase API', () => {
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
  const status = (id: string, userId: string) =>
    app.inject({ method: 'GET', url: `/api/purchases/${id}?userId=${userId}` });
  it('durably accepts before confirming; same-key retries reuse the attempt', async () => {
    await resetTestSale(db, { initialStock: 2 });
    const key = randomUUID();
    const first = await buy('alice', key);
    expect(first.statusCode).toBe(202);
    expect(first.json().outcome).toBe('processing');
    expect((await buy('alice', key)).json()).toEqual(first.json());
    expect((await status(first.json().attemptId, 'alice')).json().outcome).toBe(
      'processing',
    );
    await processNext(db);
    const final = (await status(first.json().attemptId, 'alice')).json();
    expect(final.outcome).toBe('confirmed');
    expect((await buy('alice', key)).json().attemptId).toBe(
      first.json().attemptId,
    );
    expect(
      (await db.query('SELECT stock_remaining FROM flash_sales')).rows[0]
        .stock_remaining,
    ).toBe(1);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM order_status_events'))
        .rows[0].n,
    ).toBe(1);
  });
  it('rejects key reuse by another user and hides attempts from other demo identities', async () => {
    await resetTestSale(db);
    const key = randomUUID();
    const first = await buy('alice', key);
    expect((await buy('bob', key)).statusCode).toBe(409);
    expect((await status(first.json().attemptId, 'bob')).statusCode).toBe(404);
  });
  it('rejects outside-window admission and returns sold_out after worker processing', async () => {
    const now = Date.now();
    await resetTestSale(db, {
      startsAt: new Date(now + 60000),
      endsAt: new Date(now + 120000),
    });
    expect((await buy('future')).json().outcome).toBe('upcoming');
    await resetTestSale(db, {
      startsAt: new Date(now - 120000),
      endsAt: new Date(now - 60000),
    });
    expect((await buy('past')).json().outcome).toBe('ended');
    await resetTestSale(db, { initialStock: 0 });
    const queued = await buy('none');
    await processNext(db);
    expect((await status(queued.json().attemptId, 'none')).json().outcome).toBe(
      'sold_out',
    );
  });
  it('recovers pending work with a newly started worker after the window closes', async () => {
    await resetTestSale(db);
    const queued = await buy('recover');
    await db.query(
      "UPDATE flash_sales SET starts_at=clock_timestamp()-interval '2 minutes',ends_at=clock_timestamp()-interval '1 minute'",
    );
    await processNext(db);
    expect(
      (await status(queued.json().attemptId, 'recover')).json().outcome,
    ).toBe('confirmed');
  });
  it('rolls back stock, order, status and event if processing fails before commit', async () => {
    await resetTestSale(db, { initialStock: 1 });
    const queued = await buy('crash');
    await expect(
      processNext(db, async () => {
        throw new Error('simulated crash');
      }),
    ).rejects.toThrow('simulated crash');
    expect(
      (await status(queued.json().attemptId, 'crash')).json().outcome,
    ).toBe('processing');
    expect(
      (await db.query('SELECT stock_remaining FROM flash_sales')).rows[0]
        .stock_remaining,
    ).toBe(1);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,
    ).toBe(0);
    expect(
      (await db.query('SELECT count(*)::int AS n FROM order_status_events'))
        .rows[0].n,
    ).toBe(0);
    await db.query(
      'UPDATE purchase_attempts SET retry_after=clock_timestamp()',
    );
    await processNext(db);
    expect(await processNext(db)).toBe(false);
    expect(
      (await status(queued.json().attemptId, 'crash')).json().outcome,
    ).toBe('confirmed');
  });
  it('validates input and provides pending/confirmed lookup', async () => {
    await resetTestSale(db);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/purchases',
          payload: { userId: 'x' },
        })
      ).statusCode,
    ).toBe(400);
    const queued = await buy('lookup');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/purchases/me?userId=lookup',
        })
      ).json(),
    ).toEqual({ purchased: false, attemptId: queued.json().attemptId });
    await processNext(db);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/purchases/me?userId=lookup',
        })
      ).json().purchased,
    ).toBe(true);
  });
  it('protects internal routes and removes them in production', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/internal/metrics' }))
        .statusCode,
    ).toBe(404);
    const production = await buildApp({
      config: { ...testConfig, nodeEnv: 'production' },
      db,
    });
    expect(
      (await production.inject({ method: 'GET', url: '/api/internal/metrics' }))
        .statusCode,
    ).toBe(404);
    await production.close();
  });
  it('dead-letters repeated failures and allows the next FIFO attempt to proceed', async () => {
    await resetTestSale(db, { initialStock: 1 });
    const bad = await buy('bad');
    const next = await buy('next');
    for (let i = 0; i < 3; i++) {
      await db.query(
        'UPDATE purchase_attempts SET retry_after=clock_timestamp()',
      );
      await expect(
        processNext(db, async () => {
          throw new Error('poison');
        }),
      ).rejects.toThrow('poison');
    }
    expect((await status(bad.json().attemptId, 'bad')).json().outcome).toBe(
      'failed',
    );
    await processNext(db);
    expect((await status(next.json().attemptId, 'next')).json().outcome).toBe(
      'confirmed',
    );
  });
  it('rejects new admission when the durable pending backlog is full', async () => {
    await resetTestSale(db);
    await db.query(`INSERT INTO purchase_attempts(sale_id,user_id,idempotency_key)
      SELECT sale.id,'backlog-' || n,gen_random_uuid() FROM flash_sales sale CROSS JOIN generate_series(1,10000) n`);
    const full = await buy('overflow');
    expect(full.statusCode).toBe(503);
    expect(full.json().code).toBe('QUEUE_FULL');
  });
});
