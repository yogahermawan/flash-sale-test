import { describe, expect, it } from 'vitest';
import { statusForSale } from '../../src/services/sale-service.js';

const startsAt = new Date('2026-10-10T02:00:00.000Z');
const endsAt = new Date('2026-10-10T03:00:00.000Z');
const sale = { starts_at: startsAt, ends_at: endsAt };

describe('statusForSale', () => {
  it('uses inclusive start and exclusive end boundaries', () => {
    expect(statusForSale(sale, new Date('2026-10-10T01:59:59.999Z'))).toBe('upcoming');
    expect(statusForSale(sale, startsAt)).toBe('active');
    expect(statusForSale(sale, new Date('2026-10-10T02:30:00.000Z'))).toBe('active');
    expect(statusForSale(sale, endsAt)).toBe('ended');
  });
});
