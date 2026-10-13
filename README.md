# Flash Sale - asynchronous FIFO purchases with WebSocket results

A React + Fastify + TypeScript assessment for one product, limited stock, a
configurable sale window, and one confirmed item per demo user. Purchase
admission is separate from order confirmation: the API returns **202 Processing**,
a durable worker processes FIFO attempts, and the browser receives final status
through WebSocket.

## Architecture

```mermaid
flowchart TD
  Client[React client] -->|status / purchase| API[Fastify Purchase API]
  API -->|rate limit| Redis[(Redis)]
  API -->|202 + attemptId, durable admission| Queue[(PostgreSQL FIFO attempts)]
  Queue --> Worker[Inventory + Order Worker]
  Worker -->|one atomic transaction| Tables[(PostgreSQL inventory + orders)]
  Worker --> Events[(Durable order status events)]
  Events -->|post-commit NOTIFY| WS[API WebSocket subscriptions]
  WS -->|snapshot + final status| Client
  Edge[Production: CDN / WAF / gateway / verified auth] -.-> API
```

The queue is a durable local PostgreSQL substitute for a FIFO broker, permitted by
this assignment. API admission briefly locks the sale row so sequence allocation
and commit define acceptance order. A PostgreSQL advisory transaction lock
allows only one logical worker for this single product across processes. The
worker selects pending attempts in sequence order and commits a conditional
stock decrement, order insert, attempt result and status event together.

**Orders DB and Inventory DB are logical tables in the same physical database.**
Splitting them across physical services would require a reservation/saga and
reconciliation design, not an ordinary transaction. Queueing controls execution
and recovery; it does not remove the hot-product throughput bottleneck.

The local web client, API, Redis rate limiter, FIFO queue, worker, persistence,
events and WebSocket path are implemented. CDN/WAF, a managed gateway and real
identity verification are production deployment concerns, not provisioned here.
Vite supplies the local HTTP/WebSocket proxy; userId remains demo identity.
See [checkpoint coverage](docs/ASYNC-CHECKPOINTS.md).

## Setup

Prerequisites: Node.js 20+, pnpm 11.18.0 and Docker Compose. Use `docker-compose`
instead of `docker compose` if your installation uses the standalone command.

```sh
pnpm install
cp .env.example .env
docker compose up -d
docker compose exec postgres createdb -U flash_sale flash_sale_test
pnpm -C backend migrate
pnpm -C backend dev
pnpm -C frontend dev
```

Run frontend/backend in separate terminals. Match root `.env` URLs to the host
ports published by Compose. Current Compose ports: PostgreSQL 5432, Redis 16379.
No sale is created by migration. In Scalar at `http://localhost:3000/docs`,
authorize InternalApiKey using your local key and reset a demo sale. Use ISO 8601
start/end values that include the current time. Reset deletes all previous sale,
attempt, event and order data; use a dedicated demo/test database.

The API embeds a worker by default for easy local setup. To demonstrate separate
processes, run the API with `RUN_WORKER=false pnpm -C backend dev` and in another
terminal run `pnpm -C backend worker` using the same DATABASE_URL. Accepted work
remains pending while the worker is stopped and resumes when it restarts.

## API and completion contract

| Method | Endpoint | Behaviour |
| --- | --- | --- |
| WS | /api/sale/events | Initial sale snapshot and committed stock/reset updates for every browser |
| GET | /api/sale | Status, window, stock and authoritative server time |
| POST | /api/purchases | UUID Idempotency-Key + userId; eligible attempt returns 202 Processing + attemptId |
| GET | /api/purchases/:attemptId | Persisted status; demo userId query required |
| WS | /api/purchases/:attemptId/events?userId=... | Initial snapshot and subsequent final status |
| GET | /api/purchases/me?userId=... | Confirmed order lookup or pending attemptId |
| POST | /api/internal/sales/reset | Protected development/test reset |
| GET | /api/internal/metrics | Consistent snapshot of inventory and queue invariants |

Example admission body: `{ "userId": "yoga@example.com" }`, with an
`Idempotency-Key` UUID header. A 202 response is `{ "outcome": "processing",
"attemptId": "..." }`; it does **not** reserve an item or confirm an order.
WebSocket statuses are processing, confirmed, already_purchased, sold_out or
failed. Successful statuses include orderId. Outside-window admission returns
upcoming or ended immediately without creating queued work.

The server checks eligibility against fresh database time after taking the
admission lock and stores that time. **Admission-time semantics:** work accepted
before the deadline may complete after it. FIFO refers to committed queue
acceptance, not the exact order users clicked Buy.

Same sale/user/key always returns the original attempt, including terminal
results via its subscription. Reusing a key for a different user returns 409.
Different keys for the same user may queue separately, but only one can create an
order; subsequent attempts return already_purchased. PostgreSQL unique
constraints remain the final safeguard.

## Recovery and failure handling

Pending attempts survive API/worker restart. Worker failure before commit rolls
back stock, order and completion together. A committed terminal attempt is not
processed twice. Failed transactions retry after one second; after three
processing failures the attempt becomes failed (local dead-letter state), a final
event is recorded, and later work can proceed. Failed attempts are inspectable in
the database; automatic redrive is not implemented.

LISTEN/NOTIFY is a wake-up signal, not a durable broker. Results/events are durable
rows; registration precedes snapshot reads and reconnect replays persisted state.
The notification listener also reconnects and refreshes subscribers after loss.
The browser reconnects with backoff; after 30 seconds it stops waiting and offers
a retry to resume the same attempt. Timeout does not cancel a purchase. Lookup
can restore a pending attempt after refresh. Heartbeats clean up dead sockets. All pages also subscribe to public sale snapshots over WebSocket. Stock updates are signalled only after successful commit (including demo resets); admission and rolled-back purchases do not reduce displayed stock. Reconnect reads current database state. Each API process coalesces notifications into shared snapshot reads rather than querying once per browser.

The pending backlog is capped at 10,000; full admission returns 503. DB waits are
bounded: acquisition/lock 2s, statement 5s, idle transaction 10s. Selected transient
DB errors return 503. Redis fail-open is configurable; neither Redis nor sockets
decide inventory. Production still needs verified auth, allowed-origin policy,
operational socket limits, monitoring and appropriate admission capacity.

## Tests

```sh
pnpm -C backend test
pnpm -C backend test:integration
pnpm -C frontend test:e2e
pnpm typecheck
pnpm build
```

Unit tests need no database. Integration requires a dedicated database name
containing flash_sale_test and loads root .env; missing configuration fails.
Integration creates tables from migrations and resets test data. Browser tests
use E2E_DATABASE_URL or TEST_DATABASE_URL, isolated API :3100 and Vite :5174.
Do not run integration and browser suites concurrently against the same database.
CI runs these checks with PostgreSQL/Redis containers and Chromium.

Coverage includes FIFO winners, competing workers, concurrent duplicate keys and
users, admission windows, completion after deadline, rollback before commit,
restart recovery, dead-letter progression, WebSocket notifications and reconnect
snapshot replay. Browser tests assert 202 admission and a WebSocket connection
before checking final confirmation.

## Async stress tests

Use a dedicated backend/database and raise its rate limit so the workload tests
inventory rather than intentional 429 rejection. Replace DATABASE_URL below with
the actual dedicated test database URL and correct host port. Never use an empty
shell expansion from a variable that exists only in .env.

```sh
DATABASE_URL=postgres://flash_sale:flash_sale@localhost:5432/flash_sale_test \
RATE_LIMIT_MAX=120000 pnpm -C backend dev
```

In a separate terminal:

```sh
STRESS_REQUESTS=10000 STRESS_CONCURRENCY=50 STRESS_STOCK=5000 pnpm -C backend stress
STRESS_REQUESTS=10000 STRESS_CONCURRENCY=200 STRESS_STOCK=100 pnpm -C backend stress
```

Each run resets orders. Workers wait for the final WebSocket result; 202 responses
are never counted as confirmed. The runner requires exactly min(requests, stock)
confirmed results, the expected sold-out count, unique valid order IDs, matching
persisted orders, non-negative/conserved stock, no failed/pending attempts and no
unexpected errors. Latency includes admission through final WebSocket result;
admission mean is also reported. It is a closed-loop local load test, not a fixed
arrival-rate or production capacity claim.

Historical synchronous results are in [the baseline document](docs/SYNCHRONOUS-BASELINE.md).
They must not be presented as measurements of this asynchronous version.

## Scope

Real authentication, payments, cancellation, reservation expiry, CDN/WAF
provisioning and multiple-product partitioning are outside this local demo.
For production, derive identity from a verified session, implement a gateway and
edge policies, and evaluate a managed broker if contention or operational needs
justify it. The current single-product worker remains serial by design.

### Recorded async local runs

Measured on October 13, 2026 against a dedicated PostgreSQL/Redis Docker setup,
with API and embedded worker on the same machine and rate limit raised to 120000.
Raw JSON is retained in [docs/stress-results](docs/stress-results).

| Requests | Concurrency | Stock | Confirmed / sold out | Errors | Completion req/s | Mean admission ms | Final p50 / p95 / p99 ms | Result |
| ---: | ---: | ---: | --- | ---: | ---: | ---: | --- | --- |
| 10,000 | 50 | 5,000 | 5,000 / 5,000 | 0 | 105.1 | 11.5 | 452.3 / 625.7 / 751.4 | PASS |
| 10,000 | 200 | 100 | 100 / 9,900 | 0 | 106.9 | 19.8 | 1803.4 / 2280.6 / 2639.7 | PASS |

Both finished with zero stock, no duplicate confirmed users, no pending/failed
attempts and all inventory invariants true. Durable admission, separate worker
processing and WebSocket delivery add overhead; completion throughput is lower
than the historical synchronous baseline. Lower admission latency must not be
misrepresented as final confirmation latency or unlimited queue capacity.
