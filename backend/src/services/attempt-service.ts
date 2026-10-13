import type { Pool } from 'pg';
import { inTransaction } from '../db.js';
import { AppError } from '../errors.js';
import { getExactlyOneActiveSale, statusForSale } from './sale-service.js';

export interface Attempt {
  id: string;
  sale_id: string;
  user_id: string;
  idempotency_key: string;
  status: 'pending' | 'confirmed' | 'already_purchased' | 'sold_out' | 'failed';
  order_id: string | null;
  sequence: string;
}
export function publicAttempt(attempt: Attempt) {
  return {
    attemptId: attempt.id,
    outcome: attempt.status === 'pending' ? 'processing' : attempt.status,
    ...(attempt.order_id ? { orderId: attempt.order_id } : {}),
  };
}
export async function findAttempt(db: Pool, id: string, userId: string) {
  const result = await db.query<Attempt>(
    'SELECT * FROM purchase_attempts WHERE id=$1 AND user_id=$2',
    [id, userId],
  );
  if (!result.rows[0])
    throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'Purchase attempt not found.');
  return result.rows[0];
}
export async function enqueuePurchase(db: Pool, userId: string, key: string) {
  return inTransaction(db, async (client) => {
    // This admission lock defines durable FIFO acceptance order for one sale.
    const sale = await getExactlyOneActiveSale(client, true);
    const old = await client.query<Attempt>(
      'SELECT * FROM purchase_attempts WHERE sale_id=$1 AND idempotency_key=$2',
      [sale.id, key],
    );
    if (old.rows[0]) {
      if (old.rows[0].user_id !== userId)
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'Key belongs to another user.',
        );
      return { outcome: 'processing' as const, attemptId: old.rows[0].id };
    }
    const clock = await client.query<{ now: Date }>(
      'SELECT clock_timestamp() AS now',
    );
    const status = statusForSale(sale, clock.rows[0].now);
    if (status !== 'active') return { outcome: status };
    const capacity = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM purchase_attempts WHERE sale_id=$1 AND status='pending'",
      [sale.id],
    );
    if (capacity.rows[0].n >= 10000)
      throw new AppError(
        503,
        'QUEUE_FULL',
        'Purchase queue is full. Retry with the same key.',
      );
    const queued = await client.query<Attempt>(
      'INSERT INTO purchase_attempts(sale_id,user_id,idempotency_key,accepted_at) VALUES($1,$2,$3,$4) RETURNING *',
      [sale.id, userId, key, clock.rows[0].now],
    );
    return { outcome: 'processing' as const, attemptId: queued.rows[0].id };
  });
}
