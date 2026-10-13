import { inTransaction } from '../db.js';
import type { Pool } from 'pg';
import { getExactlyOneActiveSale } from './sale-service.js';

export interface SaleMetrics {
  pendingAttemptCount?: number;
  failedAttemptCount?: number;
  initialStock: number;
  stockRemaining: number;
  confirmedOrderCount: number;
  duplicateUserCount: number;
  invariants: {
    stockNonNegative: boolean;
    noOversell: boolean;
    uniqueConfirmedUsers: boolean;
    stockConserved: boolean;
  };
}

export async function getMetrics(pool: Pool): Promise<SaleMetrics> {
  return inTransaction(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const sale = await getExactlyOneActiveSale(client);
    const queued = await client.query<{ pending: number; failed: number }>(
      "SELECT count(*) FILTER (WHERE status='pending')::int AS pending,count(*) FILTER (WHERE status='failed')::int AS failed FROM purchase_attempts WHERE sale_id=$1",
      [sale.id],
    );
    const counts = await client.query<{
      confirmed_count: string;
      duplicate_user_count: string;
    }>(
      `SELECT count(*)::text AS confirmed_count,
            (count(*) - count(DISTINCT user_id))::text AS duplicate_user_count
       FROM orders WHERE sale_id = $1 AND status = 'confirmed'`,
      [sale.id],
    );
    const confirmedOrderCount = Number(counts.rows[0].confirmed_count);
    const duplicateUserCount = Number(counts.rows[0].duplicate_user_count);
    return {
      pendingAttemptCount: queued.rows[0].pending,
      failedAttemptCount: queued.rows[0].failed,
      initialStock: sale.initial_stock,
      stockRemaining: sale.stock_remaining,
      confirmedOrderCount,
      duplicateUserCount,
      invariants: {
        stockNonNegative: sale.stock_remaining >= 0,
        noOversell: confirmedOrderCount <= sale.initial_stock,
        uniqueConfirmedUsers: duplicateUserCount === 0,
        stockConserved:
          confirmedOrderCount + sale.stock_remaining === sale.initial_stock,
      },
    };
  });
}
