import type { SaleMetrics } from '../src/services/metrics-service.js';

export function stressPasses(requestCount: number, stock: number, outcomes: Map<string, number>, errors: number, metrics: SaleMetrics): boolean {
  const expectedConfirmed = Math.min(requestCount, stock);
  return errors === 0
    && [...outcomes.keys()].every((key) => key === 'confirmed' || key === 'sold_out')
    && (outcomes.get('confirmed') ?? 0) === expectedConfirmed
    && (outcomes.get('sold_out') ?? 0) === requestCount - expectedConfirmed
    && metrics.initialStock === stock
    && metrics.confirmedOrderCount === expectedConfirmed
    && metrics.stockRemaining === stock - expectedConfirmed
    && metrics.duplicateUserCount === 0
    && metrics.invariants?.stockNonNegative === true
    && metrics.invariants?.noOversell === true
    && metrics.invariants?.uniqueConfirmedUsers === true
    && metrics.invariants?.stockConserved === true;
}
