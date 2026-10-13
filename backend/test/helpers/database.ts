import '../../src/config.js';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, inTransaction } from '../../src/db.js';
import { resetSale, type ResetSaleInput } from '../../src/services/sale-service.js';

const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) throw new Error('TEST_DATABASE_URL is required for integration tests; configure root .env or export it.');

export function testPool() {
  if (!testUrl) throw new Error('TEST_DATABASE_URL is required for database integration tests.');
  if (!testUrl.includes('flash_sale_test')) {
    throw new Error('TEST_DATABASE_URL must target a dedicated database whose name includes flash_sale_test.');
  }
  return createPool(testUrl);
}

export async function ensureTestSchema(pool: ReturnType<typeof createPool>): Promise<void> {
  const migrationPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations/001_initial_schema.sql');
  await pool.query(await readFile(migrationPath, 'utf8'));
}

export async function resetTestSale(pool: ReturnType<typeof createPool>, input: Partial<ResetSaleInput> = {}) {
  const now = Date.now();
  return inTransaction(pool, (client) => resetSale(client, {
    initialStock: input.initialStock ?? 10,
    startsAt: input.startsAt ?? new Date(now - 60_000),
    endsAt: input.endsAt ?? new Date(now + 3_600_000),
    productName: input.productName ?? 'Test headphones',
  }));
}
