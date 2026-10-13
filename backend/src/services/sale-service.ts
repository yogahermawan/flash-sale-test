import type { Pool, PoolClient } from 'pg';
import { saleConfigurationError } from '../errors.js';
import type { PublicSale, SaleRow, SaleStatus } from '../types.js';

const activeSaleQuery = `
  SELECT id, product_name, starts_at, ends_at, initial_stock, stock_remaining, active,
         clock_timestamp() AS server_now
  FROM flash_sales
  WHERE active = true`;

export function statusForSale(
  sale: Pick<SaleRow, 'starts_at' | 'ends_at'>,
  now: Date,
): SaleStatus {
  if (now < sale.starts_at) return 'upcoming';
  if (now >= sale.ends_at) return 'ended';
  return 'active';
}

export function toPublicSale(sale: SaleRow): PublicSale {
  return {
    id: sale.id,
    name: sale.product_name,
    status: statusForSale(sale, sale.server_now ?? new Date()),
    stockRemaining: sale.stock_remaining,
    serverNow: (sale.server_now ?? new Date()).toISOString(),
    startsAt: sale.starts_at.toISOString(),
    endsAt: sale.ends_at.toISOString(),
  };
}

export async function getExactlyOneActiveSale(
  executor: Pool | PoolClient,
  lock = false,
): Promise<SaleRow> {
  const result = await executor.query<SaleRow>(
    `${activeSaleQuery}${lock ? ' FOR UPDATE' : ''}`,
  );
  if (result.rowCount !== 1) throw saleConfigurationError();
  return result.rows[0];
}

export async function getPublicSale(pool: Pool): Promise<PublicSale> {
  return toPublicSale(await getExactlyOneActiveSale(pool));
}

export interface ResetSaleInput {
  initialStock: number;
  startsAt: Date;
  endsAt: Date;
  productName: string;
}

export async function resetSale(
  client: PoolClient,
  input: ResetSaleInput,
): Promise<PublicSale> {
  await client.query('SELECT pg_advisory_xact_lock(817263)');
  await client.query(
    'LOCK TABLE flash_sales, orders, purchase_attempts, order_status_events IN ACCESS EXCLUSIVE MODE',
  );
  await client.query('DELETE FROM order_status_events');
  await client.query('DELETE FROM purchase_attempts');
  await client.query('DELETE FROM orders');
  await client.query('DELETE FROM flash_sales');
  const result = await client.query<SaleRow>(
    `INSERT INTO flash_sales (product_name, starts_at, ends_at, initial_stock, stock_remaining, active)
     VALUES ($1, $2, $3, $4, $4, true)
     RETURNING id, product_name, starts_at, ends_at, initial_stock, stock_remaining, active, clock_timestamp() AS server_now`,
    [input.productName, input.startsAt, input.endsAt, input.initialStock],
  );
  return toPublicSale(result.rows[0]);
}
