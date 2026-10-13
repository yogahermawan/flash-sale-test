import type { Pool } from 'pg';
import { getExactlyOneActiveSale } from './sale-service.js';

export async function lookupPurchase(
  pool: Pool,
  userId: string,
): Promise<{ purchased: boolean; orderId?: string; attemptId?: string }> {
  const sale = await getExactlyOneActiveSale(pool);
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM orders WHERE sale_id = $1 AND user_id = $2',
    [sale.id, userId],
  );
  if (!result.rowCount) {
    const pending = await pool.query<{ id: string }>(
      "SELECT id FROM purchase_attempts WHERE sale_id=$1 AND user_id=$2 AND status='pending' ORDER BY sequence LIMIT 1",
      [sale.id, userId],
    );
    if (pending.rows[0])
      return { purchased: false, attemptId: pending.rows[0].id };
  }
  return result.rowCount === 1
    ? { purchased: true, orderId: result.rows[0].id }
    : { purchased: false };
}
