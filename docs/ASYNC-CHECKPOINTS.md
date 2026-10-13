# Async implementation checkpoints

Baseline: cf997c3 (synchronous version already validated by the author).
Branch: feat/async-purchase-websocket. Do not merge until the browser suite passes.

## 1. Contract and architecture

- POST accepts eligible work durably, returns 202 Processing + attemptId.
- Queue acceptance order is serialized for the single sale, not client click order.
- Admission-time eligibility is intentional: accepted work can finish after the sale ends.
- Orders and inventory are logical tables in one database, not a distributed dual write.
- PostgreSQL implements the durable local FIFO queue. SQS is a future broker replacement.

## 2. Worker and correctness

- Advisory transaction lock ensures a single logical consumer across processes.
- Worker selects the first pending sequence; retries at the head preserve order.
- Inventory decrement, order insert, attempt completion and status event commit together.
- Restart reprocesses durable pending attempts. Same-key retries reuse the attempt.
- Three failed processing transactions mark the attempt failed (a local dead-letter state),
  publish that result, and let the next attempt proceed. Operators inspect failed attempts;
  automated/manual redrive is not implemented. Retry scheduling uses database time.
- Admission rejects with 503 when the pending backlog reaches 10,000.

## 3. WebSocket and frontend

- WebSocket subscription validates attemptId + demo userId before upgrade.
- Initial subscription and reconnect send the persisted current state.
- PostgreSQL LISTEN/NOTIFY wakes API instances after commit; notifications are not durable.
  The persisted attempt/event is durable and snapshots recover missed notifications.
- Client reconnects with bounded backoff and stops waiting after 30 seconds, without
  claiming the attempt was cancelled. Retry reconnects to the same logical attempt.
- User lookup can recover pending work after page reload.
- Server heartbeat cleans up dead connections. Vite forwards WebSocket upgrades.

## 4. Diagram coverage and production boundaries

| Original box | Local implementation |
| --- | --- |
| Web/mobile client | React web demo; mobile is not implemented |
| CDN / WAF | Production deployment concerns; not provisioned locally |
| Rate limiter | Redis-backed Fastify rate limiting |
| Gateway / Auth | Fastify routing + Vite reverse proxy; demo identity, not real auth |
| Purchase API | Durable 202 admission and idempotency |
| FIFO queue | PostgreSQL durable ordered attempts, local broker substitute |
| Inventory + order worker | Embedded demo loop or independent worker process |
| Inventory DB + Orders DB | Two tables in the same PostgreSQL transaction |
| Order status event | Durable event table + post-commit NOTIFY |
| WebSocket / polling | WebSocket UI; GET attempt state for debugging/recovery |

A real production identity provider, CDN/WAF, browser origin restrictions, and
operational socket connection limits still need a deployment/security design.
The take-home permits local substitutes; do not claim these cloud components are deployed.

## 5. Verification gate

Run unit, typecheck, build, integration/concurrency/WebSocket tests, browser tests
and both async stress workloads. Confirm actual final outcomes, not just 202 responses.
Old synchronous measurements must not be presented as async capacity results.

Review/checkpoint commits should remain on this feature branch until final verification.

### Current validation status

- Checkpoint 1: contract and architecture implemented.
- Checkpoint 2: queue, worker, transaction, recovery and events implemented.
- Checkpoint 3: WebSocket UI and reconnect implemented; server protocol tested.
- Checkpoint 4: 8 unit + 14 integration/concurrency/WebSocket tests pass; build and typecheck pass.
- Two 10,000-request async workloads pass strict final-result validation.
- An additional 200-request run with the API and two independent worker processes
  confirms exactly 50 orders and 150 sold-out results, without duplicate processing.
- Checkpoint 5: all 5 browser E2E tests passed in 8.6 seconds on the author's
  machine, as reported on October 13, 2026. Includes 202 admission, a WebSocket
  connection, purchase confirmation, refresh lookup, sold-out/ended states and
  device-clock skew. Agent browser launch limitations are no longer an outstanding
  local verification gate. Feature-branch CI still needs verification after push.


Final gate (run from repository root; these databases have been created locally):

```sh
E2E_DATABASE_URL=postgres://flash_sale:flash_sale@localhost:5432/flash_sale_test_async pnpm -C frontend test:e2e
```

Keep every worker/API process pointed at this database stopped before that command;
Playwright starts its own worker-enabled API. Do not share this database with stress
or integration running concurrently. Then review the feature branch and CI before merging.
