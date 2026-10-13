import type { Pool } from 'pg';
import { inTransaction } from '../db.js';
import { AppError } from '../errors.js';
import type { PurchaseResult } from '../types.js';
import { getExactlyOneActiveSale, statusForSale } from './sale-service.js';

interface OrderRow { id: string; user_id: string }

export async function purchase(pool: Pool, userId: string, idempotencyKey: string): Promise<PurchaseResult> {
  return inTransaction(pool, async (client) => {
    const sale = await getExactlyOneActiveSale(client, true);

    // A completed logical attempt always wins over later window/stock state.
    const byKey = await client.query<OrderRow>(
      'SELECT id, user_id FROM orders WHERE sale_id = $1 AND idempotency_key = $2',
      [sale.id, idempotencyKey],
    );
    if (byKey.rowCount === 1) {
      if (byKey.rows[0].user_id !== userId) {
        throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key has already been used by another user.');
      }
      return { outcome: 'confirmed', orderId: byKey.rows[0].id };
    }

    // Sample time after acquiring the row lock: waiting may cross the sale deadline.
    const clock = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    const saleStatus = statusForSale(sale, clock.rows[0].now);
    if (saleStatus === 'upcoming') return { outcome: 'upcoming' };
    if (saleStatus === 'ended') return { outcome: 'ended' };

    const byUser = await client.query<OrderRow>(
      'SELECT id, user_id FROM orders WHERE sale_id = $1 AND user_id = $2',
      [sale.id, userId],
    );
    if (byUser.rowCount === 1) return { outcome: 'already_purchased', orderId: byUser.rows[0].id };
    if (sale.stock_remaining === 0) return { outcome: 'sold_out' };

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO orders (sale_id, user_id, idempotency_key, status)
       VALUES ($1, $2, $3, 'confirmed') RETURNING id`,
      [sale.id, userId, idempotencyKey],
    );
    const decremented = await client.query(
      'UPDATE flash_sales SET stock_remaining = stock_remaining - 1, updated_at = now() WHERE id = $1 AND stock_remaining > 0',
      [sale.id],
    );
    if (decremented.rowCount !== 1) throw new Error('Locked sale stock could not be decremented.');
    return { outcome: 'confirmed', orderId: inserted.rows[0].id };
  });
}

export async function lookupPurchase(pool: Pool, userId: string): Promise<{ purchased: boolean; orderId?: string }> {
  const sale = await getExactlyOneActiveSale(pool);
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM orders WHERE sale_id = $1 AND user_id = $2', [sale.id, userId],
  );
  return result.rowCount === 1 ? { purchased: true, orderId: result.rows[0].id } : { purchased: false };
}
