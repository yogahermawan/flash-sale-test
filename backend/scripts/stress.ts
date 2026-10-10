import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const baseUrl = process.env.STRESS_BASE_URL ?? `http://localhost:${config.port}`;
const requestCount = Number(process.env.STRESS_REQUESTS ?? 1000);
const concurrency = Number(process.env.STRESS_CONCURRENCY ?? 50);
const stock = Number(process.env.STRESS_STOCK ?? 100);
const userPrefix = process.env.STRESS_USER_PREFIX ?? 'stress';

if (![requestCount, concurrency, stock].every((value) => Number.isSafeInteger(value) && value > 0)) {
  throw new Error('STRESS_REQUESTS, STRESS_CONCURRENCY, and STRESS_STOCK must be positive integers.');
}

const now = Date.now();
const resetResponse = await fetch(`${baseUrl}/api/internal/sales/reset`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-internal-api-key': config.internalApiKey },
  body: JSON.stringify({
    initialStock: stock,
    startsAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 10 * 60_000).toISOString(),
    productName: 'Stress-test headphones',
  }),
});
if (!resetResponse.ok) throw new Error(`Sale reset failed: ${resetResponse.status} ${await resetResponse.text()}`);

const outcomes = new Map<string, number>();
const latencies: number[] = [];
let unexpectedErrors = 0;
let cursor = 0;
const startedAt = performance.now();

async function worker(): Promise<void> {
  while (true) {
    const index = cursor++;
    if (index >= requestCount) return;
    const requestStartedAt = performance.now();
    try {
      const response = await fetch(`${baseUrl}/api/purchases`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
        body: JSON.stringify({ userId: `${userPrefix}-${index}@example.com` }),
      });
      const body = await response.json().catch(() => ({})) as { outcome?: string };
      if (!response.ok) unexpectedErrors += 1;
      const label = body.outcome ?? `http_${response.status}`;
      outcomes.set(label, (outcomes.get(label) ?? 0) + 1);
    } catch {
      unexpectedErrors += 1;
      outcomes.set('transport_error', (outcomes.get('transport_error') ?? 0) + 1);
    } finally {
      latencies.push(performance.now() - requestStartedAt);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, requestCount) }, worker));
const elapsedMs = performance.now() - startedAt;
const metricsResponse = await fetch(`${baseUrl}/api/internal/metrics`, { headers: { 'x-internal-api-key': config.internalApiKey } });
if (!metricsResponse.ok) throw new Error(`Metrics fetch failed: ${metricsResponse.status} ${await metricsResponse.text()}`);
const metrics = await metricsResponse.json();
const sortedLatencies = latencies.sort((a, b) => a - b);
const percentile = (ratio: number) => sortedLatencies[Math.min(sortedLatencies.length - 1, Math.ceil(sortedLatencies.length * ratio) - 1)].toFixed(1);
const confirmed = outcomes.get('confirmed') ?? 0;
const passes = unexpectedErrors === 0
  && confirmed <= stock
  && metrics.invariants.stockNonNegative
  && metrics.invariants.noOversell
  && metrics.invariants.uniqueConfirmedUsers
  && metrics.invariants.stockConserved;

console.log(JSON.stringify({
  configuration: { baseUrl, requestCount, concurrency, stock, userPrefix },
  elapsedMs: Number(elapsedMs.toFixed(1)),
  requestsPerSecond: Number((requestCount / (elapsedMs / 1000)).toFixed(1)),
  outcomes: Object.fromEntries(outcomes),
  unexpectedErrors,
  latencyMs: { p50: Number(percentile(0.5)), p95: Number(percentile(0.95)), p99: Number(percentile(0.99)) },
  metrics,
  pass: passes,
}, null, 2));

if (!passes) process.exitCode = 1;
