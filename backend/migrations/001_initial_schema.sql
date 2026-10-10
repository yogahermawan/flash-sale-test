CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flash_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  initial_stock integer NOT NULL CHECK (initial_stock >= 0),
  stock_remaining integer NOT NULL CHECK (stock_remaining >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (stock_remaining <= initial_stock)
);

CREATE UNIQUE INDEX IF NOT EXISTS flash_sales_one_active_idx
  ON flash_sales ((active)) WHERE active;

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES flash_sales(id) ON DELETE RESTRICT,
  user_id text NOT NULL CHECK (length(btrim(user_id)) > 0),
  idempotency_key uuid NOT NULL,
  status text NOT NULL CHECK (status = 'confirmed'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, user_id),
  UNIQUE (sale_id, idempotency_key)
);
