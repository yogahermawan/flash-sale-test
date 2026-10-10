import type { Pool } from 'pg';
import { getExactlyOneActiveSale } from './sale-service.js';

export interface SaleMetrics {
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
  const sale = await getExactlyOneActiveSale(pool);
  const counts = await pool.query<{ confirmed_count: string; duplicate_user_count: string }>(
    `SELECT count(*)::text AS confirmed_count,
            (count(*) - count(DISTINCT user_id))::text AS duplicate_user_count
       FROM orders WHERE sale_id = $1 AND status = 'confirmed'`,
    [sale.id],
  );
  const confirmedOrderCount = Number(counts.rows[0].confirmed_count);
  const duplicateUserCount = Number(counts.rows[0].duplicate_user_count);
  return {
    initialStock: sale.initial_stock,
    stockRemaining: sale.stock_remaining,
    confirmedOrderCount,
    duplicateUserCount,
    invariants: {
      stockNonNegative: sale.stock_remaining >= 0,
      noOversell: confirmedOrderCount <= sale.initial_stock,
      uniqueConfirmedUsers: duplicateUserCount === 0,
      stockConserved: confirmedOrderCount + sale.stock_remaining === sale.initial_stock,
    },
  };
}
