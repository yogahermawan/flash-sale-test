import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import WebSocket from 'ws';
import { buildTestApp } from '../helpers/app.js';
import {
  ensureTestSchema,
  resetTestSale,
  testPool,
} from '../helpers/database.js';
import { processNext } from '../../src/services/queue-worker.js';
let db: Pool;
let app: FastifyInstance;
let url: string;
beforeAll(async () => {
  db = testPool();
  await ensureTestSchema(db);
  app = await buildTestApp(db);
  await app.orderEvents.start();
  url = await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await app?.close();
  await db?.end();
});
function open(path: string) {
  const socket = new WebSocket(url.replace('http:', 'ws:') + path);
  const messages: any[] = [];
  let wake: (() => void) | undefined;
  socket.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()));
    wake?.();
  });
  socket.on('error', () => {});
  async function next() {
    if (messages.length) return messages.shift();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('No WebSocket status')),
        3000,
      );
      wake = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
    return messages.shift();
  }
  return { socket, next };
}
it('pushes processing then final status and replays final state after reconnect', async () => {
  await resetTestSale(db, { initialStock: 1 });
  const admitted = await app.inject({
    method: 'POST',
    url: '/api/purchases',
    headers: { 'idempotency-key': randomUUID() },
    payload: { userId: 'socket-user' },
  });
  const id = admitted.json().attemptId;
  const path = `/api/purchases/${id}/events?userId=socket-user`;
  const first = open(path);
  try {
    expect((await first.next()).outcome).toBe('processing');
    await processNext(db);
    const final = await first.next();
    expect(final.outcome).toBe('confirmed');
    first.socket.close();
    const replay = open(path);
    try {
      expect(await replay.next()).toEqual(final);
    } finally {
      replay.socket.close();
    }
  } finally {
    first.socket.close();
  }
});
it('rejects another demo user before WebSocket upgrade', async () => {
  await resetTestSale(db);
  const admitted = await app.inject({
    method: 'POST',
    url: '/api/purchases',
    headers: { 'idempotency-key': randomUUID() },
    payload: { userId: 'owner' },
  });
  const socket = new WebSocket(
    url.replace('http:', 'ws:') +
      `/api/purchases/${admitted.json().attemptId}/events?userId=other`,
  );
  const code = await new Promise<number>((resolve, reject) => {
    socket.on('unexpected-response', (_, response) => {
      response.resume();
      resolve(response.statusCode!);
      socket.terminate();
    });
    socket.on('error', () => {});
    setTimeout(() => reject(new Error('No rejection')), 3000).unref();
  });
  expect(code).toBe(404);
});
it('broadcasts committed stock to all sale subscribers and replays after reconnect/reset', async () => {
  const sale = await resetTestSale(db, { initialStock: 2 });
  const first = open('/api/sale/events');
  const second = open('/api/sale/events');
  async function stock(
    stream: ReturnType<typeof open>,
    expected: number,
    id = sale.id,
  ) {
    for (let i = 0; i < 10; i++) {
      const message = await stream.next();
      if (message.sale.id === id && message.sale.stockRemaining === expected)
        return message;
    }
    throw new Error('Expected sale snapshot not received');
  }
  try {
    await stock(first, 2);
    await stock(second, 2);
    await app.inject({
      method: 'POST',
      url: '/api/purchases',
      headers: { 'idempotency-key': randomUUID() },
      payload: { userId: 'live-stock' },
    });
    // Admission alone must not decrement inventory.
    expect(
      (
        await db.query('SELECT stock_remaining FROM flash_sales WHERE id=$1', [
          sale.id,
        ])
      ).rows[0].stock_remaining,
    ).toBe(2);
    await expect(
      processNext(db, async () => {
        throw new Error('Simulated rollback');
      }),
    ).rejects.toThrow('Simulated rollback');
    expect(
      (
        await db.query('SELECT stock_remaining FROM flash_sales WHERE id=$1', [
          sale.id,
        ])
      ).rows[0].stock_remaining,
    ).toBe(2);
    await db.query(
      'UPDATE purchase_attempts SET retry_after=clock_timestamp()',
    );
    await processNext(db);
    await stock(first, 1);
    await stock(second, 1);
    const replay = open('/api/sale/events');
    try {
      await stock(replay, 1);
    } finally {
      replay.socket.close();
    }
    const reset = await resetTestSale(db, { initialStock: 3 });
    await stock(first, 3, reset.id);
    await stock(second, 3, reset.id);
  } finally {
    first.socket.close();
    second.socket.close();
  }
});
