CREATE TABLE IF NOT EXISTS purchase_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  sale_id uuid NOT NULL REFERENCES flash_sales(id),
  user_id text NOT NULL,
  idempotency_key uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','already_purchased','sold_out','failed')),
  order_id uuid REFERENCES orders(id),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  retry_after timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(sale_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS attempts_pending_fifo ON purchase_attempts(sale_id, sequence) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS attempts_user ON purchase_attempts(sale_id,user_id,sequence DESC);
CREATE TABLE IF NOT EXISTS order_status_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id uuid NOT NULL UNIQUE REFERENCES purchase_attempts(id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
