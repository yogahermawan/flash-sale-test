import { describe, expect, it } from 'vitest';
import { stressPasses } from '../../scripts/stress-validation.js';
const metrics = { initialStock: 3, stockRemaining: 0, confirmedOrderCount: 3, duplicateUserCount: 0, invariants: { stockNonNegative: true, noOversell: true, uniqueConfirmedUsers: true, stockConserved: true } };
describe('stress workload validation', () => {
  it('accepts exactly exhausted stock and matching order counts', () => {
    expect(stressPasses(10, 3, new Map([['confirmed', 3], ['sold_out', 7]]), 0, metrics)).toBe(true);
  });
  it('rejects all-ended responses even when inventory invariants hold', () => {
    expect(stressPasses(10, 3, new Map([['ended', 10]]), 0, { ...metrics, confirmedOrderCount: 0, stockRemaining: 3 })).toBe(false);
  });
  it('rejects under-selling, transport errors and disagreement with stored orders', () => {
    expect(stressPasses(10, 3, new Map([['confirmed', 2], ['sold_out', 8]]), 0, metrics)).toBe(false);
    expect(stressPasses(10, 3, new Map([['confirmed', 3], ['sold_out', 7]]), 1, metrics)).toBe(false);
    expect(stressPasses(10, 3, new Map([['confirmed', 3], ['sold_out', 7]]), 0, { ...metrics, confirmedOrderCount: 2 })).toBe(false);
  });
  it('accepts demand lower than stock', () => {
    expect(stressPasses(2, 3, new Map([['confirmed', 2]]), 0, { ...metrics, confirmedOrderCount: 2, stockRemaining: 1 })).toBe(true);
  });
});
