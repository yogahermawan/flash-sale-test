import type { Pool, PoolClient } from 'pg';
import { inTransaction } from '../db.js';
import type { Attempt } from './attempt-service.js';

// Hook permits meaningful rollback/crash testing; never used by the runtime.
export async function processNext(
  db: Pool,
  beforeCommit?: (client: PoolClient) => Promise<void>,
): Promise<boolean> {
  let attemptId: string | undefined;
  try {
    return await inTransaction(db, async (client) => {
      // Only one logical consumer for the single product, even across processes.
      const lock = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock(817263) AS acquired',
      );
      if (!lock.rows[0].acquired) return false;
      const next = await client.query<Attempt>(
        "SELECT * FROM purchase_attempts WHERE status='pending' ORDER BY sequence LIMIT 1 FOR UPDATE",
      );
      const attempt = next.rows[0];
      if (!attempt) return false;
      const ready = await client.query<{ ready: boolean }>(
        'SELECT retry_after<=clock_timestamp() AS ready FROM purchase_attempts WHERE id=$1',
        [attempt.id],
      );
      if (!ready.rows[0].ready) return false;
      attemptId = attempt.id;
      await client.query('SELECT id FROM flash_sales WHERE id=$1 FOR UPDATE', [
        attempt.sale_id,
      ]);
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM orders WHERE sale_id=$1 AND user_id=$2',
        [attempt.sale_id, attempt.user_id],
      );
      let status = 'already_purchased';
      let orderId: string | null = existing.rows[0]?.id ?? null;
      if (!orderId) {
        const stock = await client.query(
          'UPDATE flash_sales SET stock_remaining=stock_remaining-1,updated_at=now() WHERE id=$1 AND stock_remaining>0 RETURNING id',
          [attempt.sale_id],
        );
        if (!stock.rowCount) status = 'sold_out';
        else {
          const order = await client.query<{ id: string }>(
            "INSERT INTO orders(sale_id,user_id,idempotency_key,status) VALUES($1,$2,$3,'confirmed') RETURNING id",
            [attempt.sale_id, attempt.user_id, attempt.idempotency_key],
          );
          orderId = order.rows[0].id;
          status = 'confirmed';
        }
      }
      // Admission time is authoritative: accepted work may finish after ends_at.
      await client.query(
        'UPDATE purchase_attempts SET status=$2,order_id=$3,completed_at=clock_timestamp() WHERE id=$1',
        [attempt.id, status, orderId],
      );
      await client.query(
        'INSERT INTO order_status_events(attempt_id,status) VALUES($1,$2)',
        [attempt.id, status],
      );
      await client.query("SELECT pg_notify('order_status',$1)", [attempt.id]);
      if (status === 'confirmed')
        await client.query("SELECT pg_notify('sale_status',$1)", [
          attempt.sale_id,
        ]);
      if (beforeCommit) await beforeCommit(client);
      return true;
    });
  } catch (error) {
    if (attemptId)
      await inTransaction(db, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(817263)');
        const failed = await client.query<Attempt>(
          "UPDATE purchase_attempts SET failure_count=failure_count+1,retry_after=clock_timestamp()+interval '1 second',status=CASE WHEN failure_count+1>=3 THEN 'failed' ELSE 'pending' END,completed_at=CASE WHEN failure_count+1>=3 THEN clock_timestamp() ELSE NULL END WHERE id=$1 AND status='pending' RETURNING *",
          [attemptId],
        );
        if (failed.rows[0]?.status === 'failed') {
          await client.query(
            "INSERT INTO order_status_events(attempt_id,status) VALUES($1,'failed')",
            [attemptId],
          );
          await client.query("SELECT pg_notify('order_status',$1)", [
            attemptId,
          ]);
        }
      }).catch(() => {}); // If DB is down, durable work remains pending for recovery.
    throw error;
  }
}
export function startWorker(
  db: Pool,
  log: { error: (value: unknown) => void },
) {
  let stopping = false;
  const done = (async () => {
    while (!stopping) {
      try {
        if (await processNext(db)) continue;
      } catch (error) {
        log.error(error);
      }
      // Transient failure backs off; three processing failures dead-letter the attempt.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
  return async () => {
    stopping = true;
    await done;
  };
}
