# Checkpoint 2 — Dependency-Ordered Implementation Tasks

## Scope and delivery order

This document is the implementation checklist for the approved local architecture:
React/Vite/TypeScript, Fastify/TypeScript, PostgreSQL, Redis, and Docker Compose.
It deliberately describes the local, transaction-based purchase path only. A
FIFO queue partitioned by product is documented as the production-scale
evolution; it is not an additional local service to implement.

1. Scaffold workspace configuration and shared conventions.
2. Add Docker Compose and database migration/reset foundations.
3. Implement backend configuration, schemas, database access, and sale/purchase
   services.
4. Add public and protected internal Fastify routes.
5. Build the React demo client against the API contract.
6. Add unit, integration, concurrency, and stress coverage.
7. Finish README, Mermaid/system diagram, and final verification.

Every phase must pass its verification checklist before the next phase begins.

## Planned repository structure

```text
.
├── .env.example                         # Non-secret local configuration template
├── .gitignore                           # Excludes secrets, dependencies, builds, coverage
├── docker-compose.yml                   # PostgreSQL and Redis local services
├── package.json                         # Workspace scripts and root development tooling
├── README.md                            # Setup, API, architecture, test/stress instructions
├── docs/
│   ├── REQUIREMENTS.md                  # Approved requirements (existing)
│   ├── PLAN.md                          # Approved architecture (existing)
│   ├── TASKS.md                         # This dependency-ordered plan
│   └── system-diagram.mmd               # Mermaid source for the local/scale-evolution diagram
├── backend/
│   ├── package.json                     # Fastify, database, Redis, test scripts/dependencies
│   ├── tsconfig.json                    # Backend TypeScript settings
│   ├── migrations/
│   │   └── 001_initial_schema.sql       # Extensions, tables, indexes, constraints
│   ├── src/
│   │   ├── app.ts                       # Builds Fastify app; registers plugins and routes
│   │   ├── server.ts                    # Loads config and starts HTTP listener
│   │   ├── config.ts                    # Typed, validated environment configuration
│   │   ├── db.ts                        # PostgreSQL pool and transaction helper
│   │   ├── redis.ts                     # Redis client used by rate limiting
│   │   ├── errors.ts                    # Typed/domain error mapping to API responses
│   │   ├── types.ts                     # Shared backend domain and DTO types
│   │   ├── routes/
│   │   │   ├── sale.ts                  # GET /api/sale
│   │   │   ├── purchases.ts             # POST /api/purchases and GET /api/purchases/me
│   │   │   └── internal.ts              # Reset and metrics routes plus protection hook
│   │   ├── services/
│   │   │   ├── sale-service.ts          # Sale state/query and reset operations
│   │   │   ├── purchase-service.ts      # Transactional reservation algorithm
│   │   │   └── metrics-service.ts       # Invariant calculations for internal metrics
│   │   └── schemas/
│   │       ├── sale.ts                  # Fastify JSON schemas for sale endpoint
│   │       ├── purchases.ts             # Request/header/query and response schemas
│   │       └── internal.ts              # Protected development/test endpoint schemas
│   ├── test/
│   │   ├── unit/                        # Pure sale-state and response/error tests
│   │   ├── integration/                 # Fastify inject tests using PostgreSQL
│   │   ├── concurrency/                 # Simultaneous transactional-purchase tests
│   │   └── helpers/                     # Test DB/reset/app setup utilities
│   └── scripts/
│       ├── migrate.ts                   # Applies ordered SQL migrations
│       ├── reset-sale.ts                # Local CLI wrapper for repeatable reset, if useful
│       └── stress.ts                    # Configurable HTTP load/stress runner
└── frontend/
    ├── package.json                     # Vite/React scripts and dependencies
    ├── tsconfig.json                    # Frontend TypeScript settings
    ├── vite.config.ts                   # Development proxy to the API and build settings
    └── src/
        ├── main.tsx                     # React entry point
        ├── App.tsx                      # Page composition and top-level data flow
        ├── api.ts                       # Typed API client and error decoding
        ├── types.ts                     # Client copies of public API DTOs
        ├── hooks/useSale.ts              # Initial/refresh sale-state loading
        ├── hooks/usePurchase.ts          # One-click submission/retry state and idempotency key
        ├── components/
        │   ├── UserIdForm.tsx           # User ID input and validation presentation
        │   ├── SaleCard.tsx              # Product, window, stock, and state display
        │   ├── BuyButton.tsx             # Disabled/loading eligibility behavior
        │   └── PurchaseOutcome.tsx       # Terminal purchase feedback
        └── styles.css                   # Small responsive demo-client styling
```

The exact package-manager lockfile is selected when the workspace is scaffolded
and then committed. No server-side code may trust frontend eligibility checks.

## Phase 1 — workspace, configuration, and local services

1. Create the root, `backend`, and `frontend` package manifests and TypeScript
   configuration. Define explicit scripts for development, build, lint/typecheck,
   migrations, test, concurrency test, and stress test.
2. Add `.env.example` with `DATABASE_URL`, `REDIS_URL`, `PORT`, `NODE_ENV`,
   `INTERNAL_API_KEY`, and documented rate-limit settings. Keep `.env` ignored;
   never provide a real secret in source control.
3. Add `docker-compose.yml` for PostgreSQL 16 and Redis 7 with named local
   volumes, health checks, and ports documented in README. The application itself
   runs locally for development unless a later documented compose profile is
   needed.
4. Implement configuration parsing which refuses to start when required database
   configuration is missing. It must reject a missing internal key outside an
   explicitly isolated test configuration.

Verification checklist:

- TypeScript configuration resolves independently for backend and frontend.
- `.env.example` contains no credentials and names every runtime setting.
- Compose configuration parses successfully before services are started.
- Startup configuration tests cover missing/invalid required values.

## Phase 2 — database model, migrations, and reset strategy

### Schema and migration tasks

1. Enable `pgcrypto` (or otherwise generate UUIDs in the application) and choose
   one approach consistently. Apply migrations in a transaction where PostgreSQL
   permits it and record applied migration names in a `schema_migrations` table.
2. Create `flash_sales`:

   ```text
   id              uuid primary key
   product_name    text not null
   starts_at       timestamptz not null
   ends_at         timestamptz not null
   initial_stock   integer not null check (initial_stock >= 0)
   stock_remaining integer not null check (stock_remaining >= 0)
   active          boolean not null default true
   created_at      timestamptz not null default now()
   updated_at      timestamptz not null default now()
   check (ends_at > starts_at)
   check (stock_remaining <= initial_stock)
   ```

   The local reset procedure maintains exactly one active sale; the service must
   detect and surface a configuration error if that invariant is violated.
3. Create `orders`:

   ```text
   id              uuid primary key
   sale_id         uuid not null references flash_sales(id) on delete restrict
   user_id         text not null check (length(trim(user_id)) > 0)
   idempotency_key uuid not null
   status          text not null check (status = 'confirmed')
   created_at      timestamptz not null default now()
   unique (sale_id, user_id)
   unique (sale_id, idempotency_key)
   ```

   `UNIQUE(sale_id, user_id)` is the final one-item-per-user guarantee;
   `UNIQUE(sale_id, idempotency_key)` makes a retry safe only within its sale.
4. Add indexes explicitly required by endpoint queries: a partial index for the
   active sale lookup (`WHERE active`), `orders(sale_id, user_id)` and
   `orders(sale_id, idempotency_key)`. The unique constraints supply the latter
   two indexes, so do not duplicate them unless query analysis proves a different
   index is necessary.
5. Add migration tests/inspection assertions for both check constraints, both
   unique constraints, the foreign key, and the active-sale index.

### Seed/reset strategy

1. Do not ship a fixed production seed. Provide a deterministic development/test
   reset path that receives product name (optional/defaulted), `initialStock`,
   `startsAt`, and `endsAt`.
2. In a single transaction, the reset service locks existing sale rows, removes
   their dependent test orders (or creates a fresh replacement sale only after
   safely deactivating old sales), then establishes exactly one active sale with
   `stock_remaining = initial_stock`. The chosen approach must preserve the
   foreign-key rule and be documented.
3. Route the same reset service through the internal endpoint and test helpers;
   this prevents test setup from bypassing application data rules. Test cleanup
   uses a dedicated test database, never a developer/production database.

Verification checklist:

- Applying migrations twice is safe (the second run has no schema changes).
- Invalid windows and negative/excess remaining stock are rejected by PostgreSQL.
- Duplicate user and duplicate idempotency-key inserts fail at the database.
- A reset leaves one active sale, zero orders for it, and matching initial/remaining stock.

## Phase 3 — API contract and route implementation

### Shared behavior

- All timestamps are UTC ISO-8601 strings. The API/server database clock is
  authoritative; no client time is accepted.
- Define Fastify JSON schemas for request, query, headers, success payloads, and
  expected error payloads. Reject unknown/malformed required fields when schema
  configuration supports it.
- User IDs are non-empty trimmed strings with a documented bounded length (for
  example, 1–254 characters). No authentication claim is implied: this is the
  assessment's supplied user identity.
- `Idempotency-Key` is required only for purchases and must be a UUID. The
  backend normalizes neither the UUID identity nor user ID beyond the documented
  trim/validation rule; it stores and compares the validated values consistently.
- Use structured request logs without logging secrets. Rate limit only the public
  purchase route through Redis; a Redis failure may be configured to fail open in
  local development, but never changes database transaction correctness.

### `GET /api/sale`

- Validation: no body or parameters.
- Success: `200` with

  ```json
  {
    "id": "uuid",
    "name": "Limited Edition Bookipi Headphones",
    "status": "upcoming|active|ended",
    "stockRemaining": 99,
    "startsAt": "ISO-8601 UTC",
    "endsAt": "ISO-8601 UTC"
  }
  ```

- Derive `status` from database/server time: before `startsAt` is `upcoming`, at
  or after `endsAt` is `ended`, otherwise `active`.
- Failure: `503` with `code: "SALE_CONFIGURATION_ERROR"` if zero/multiple active
  sales exist, and `500` only for unexpected infrastructure errors.

### `POST /api/purchases`

- Validation: JSON object `{ "userId": "non-empty user ID" }`; required
  `Idempotency-Key` UUID header. Malformed/missing request data returns `400`
  with `{ "code": "VALIDATION_ERROR", "message": "..." }`. A rate-limit
  rejection returns `429` with `code: "RATE_LIMITED"` and `Retry-After` when
  available.
- Every valid, processed purchase returns `200` and exactly one terminal body:

  ```json
  { "outcome": "confirmed", "orderId": "uuid" }
  { "outcome": "already_purchased", "orderId": "uuid" }
  { "outcome": "upcoming" }
  { "outcome": "ended" }
  { "outcome": "sold_out" }
  ```

- Idempotency rule: lookup by `(sale_id, idempotency_key)` occurs inside the same
  transaction before time/stock decisions. If it maps to the same user, return
  the persisted terminal confirmation (`confirmed`, same `orderId`) without
  decrementing stock. If it maps to another user, return `409` with
  `code: "IDEMPOTENCY_KEY_REUSED"`; never reveal that order's ID. A different
  idempotency key for a user who already has an order returns the successful
  `already_purchased` terminal outcome and that existing order ID.
- Unexpected transaction/database failures return `500` with
  `code: "PURCHASE_UNAVAILABLE"`; no partial success response is sent.

### `GET /api/purchases/me?userId=...`

- Validation: required non-empty `userId` query parameter; malformed/missing is
  `400` / `VALIDATION_ERROR`.
- Success: `200` `{ "purchased": true, "orderId": "uuid" }` when the user has
  a confirmed order in the active sale, otherwise `200` `{ "purchased": false }`.
- Active-sale configuration failures use the same `503` contract as sale lookup.

### Internal endpoints

- `POST /api/internal/sales/reset`: accepts a validated reset payload with
  non-negative integer `initialStock`, future/past UTC timestamps satisfying
  `endsAt > startsAt`, and optional bounded `productName`. Returns `200` with
  the created/reset sale public shape. Bad payloads return `400`.
- `GET /api/internal/metrics`: returns `200` with `initialStock`,
  `stockRemaining`, `confirmedOrderCount`, `duplicateUserCount`, and `invariants`
  including `stockNonNegative`, `noOversell`, and `uniqueConfirmedUsers`.
- Register these routes only when `NODE_ENV !== "production"`. Require an
  `x-internal-api-key` header equal to `INTERNAL_API_KEY` via timing-safe
  comparison; missing/incorrect is `404` to avoid advertising the routes.
  Production must not register them at all. Do not rely on frontend hiding,
  network location, or a plain equality check for protection.

Verification checklist:

- Schemas reject missing and malformed required fields with consistent errors.
- All documented public response shapes have route-level tests.
- Internal routes are unavailable in production configuration and rejected without the key in development.
- Redis rate-limit degradation is logged/tested separately from database correctness.

## Phase 4 — purchase transaction algorithm

Implement the following in one PostgreSQL transaction at an isolation level
appropriate for row locking (the default `READ COMMITTED` is sufficient when
combined with `SELECT ... FOR UPDATE` and constraints):

1. Begin transaction.
2. Select the one active sale using `SELECT ... FOR UPDATE`. If it is absent or
   ambiguous, roll back and surface the sale configuration error. This is the
   serialization point for the local single-product sale.
3. Look up `orders` by `(sale_id, idempotency_key)` while still in the
   transaction. If present for the same `user_id`, commit/read-only complete and
   return `confirmed` with its existing ID. If present for another user, roll
   back/read-only complete and return the `409 IDEMPOTENCY_KEY_REUSED` error.
4. Check the server/database current time against the locked sale: if before
   `starts_at`, commit/read-only complete and return `upcoming`; if at/after
   `ends_at`, commit/read-only complete and return `ended`.
5. Check for an existing order by `(sale_id, user_id)`. If found, commit/read-only
   complete and return `already_purchased` with the persisted ID. This ordering
   means a previously successful purchaser sees `already_purchased` on a new key
   even if stock is now exhausted; it still cannot buy again.
6. Check `stock_remaining`. If zero, commit/read-only complete and return
   `sold_out`.
7. Insert an `orders` row with `status = 'confirmed'`, then update the locked
   sale using `stock_remaining = stock_remaining - 1` with the defensive
   predicate `stock_remaining > 0`. Verify exactly one updated row. (The sale-row
   lock and check constraint together prevent oversell.)
8. Commit only after both insert and decrement succeed; return `confirmed` and
   the generated order ID.
9. On any insert/update/constraint/connection error before commit, roll back.
   For a rare uniqueness race or deadlock/serialization error, retry the whole
   bounded transaction only when it is known transient; otherwise map to the
   documented unavailable error. Never retry an already committed transaction
   blindly. A duplicate constraint detected after a concurrent request is
   re-read through the normal terminal paths, never treated as a second order.

The `FOR UPDATE` lock queues local purchase attempts in database lock-acquisition
order. Production evolution is a FIFO queue partitioned by product and workers
that run this same reservation invariant; it is not part of this local build.

Verification checklist:

- Manual code review confirms no stock mutation exists outside this transaction.
- Tests prove a failed insert/update does not reduce stock.
- Tests prove one stock unit and many concurrent distinct users produces one confirmation.
- Tests prove same-key retry returns the same order ID without an additional decrement.

## Phase 5 — frontend demo client

1. Load `GET /api/sale` on page entry and expose loading, retryable API-error,
   `upcoming`, `active`, and `ended` display states. Show product name, window,
   status, and remaining stock.
2. Provide a user-ID field with client-side required/bounded validation. It is
   usability validation only; the API remains authoritative.
3. Enable Buy Now only when user ID is valid, sale is active, stock appears
   positive, and no submission is in flight. Disable during submission to avoid
   accidental double-clicks.
4. Generate a UUID idempotency key once per logical click/attempt. Retain that
   key when retrying a failed/unknown network result, but generate a new key when
   the user deliberately begins a new purchase attempt after receiving a terminal
   response.
5. Render all terminal outcomes distinctly: confirmed (order ID), already
   purchased (order ID), upcoming, ended, and sold out. Render validation,
   rate-limit, key-reuse, and unavailable errors with an actionable retry state.
6. Refresh sale data after a terminal purchase response and offer a safe manual
   refresh. Do not claim frontend stock display reserves inventory.

Verification checklist:

- A keyboard-only user can enter an ID and submit once.
- Loading/submitting/terminal/error states are observable and no button permits duplicate in-flight submits.
- A network retry reuses the original idempotency key.
- UI behavior is tested with mocked contract responses for every terminal outcome.

## Phase 6 — test plan and stress verification

### Unit tests

- Sale-state boundaries: before start, exactly at start, during window, exactly
  at end, and after end.
- Input/schema validation, timestamp parsing, user-ID policy, and idempotency
  header validation.
- Domain error-to-status/response mapping and internal-key protection helper.
- Metrics invariant calculation, including deliberately inconsistent fixture data.

### API integration tests

Use Fastify `inject` against a dedicated PostgreSQL test database after migrations
and reset through test helpers. Cover:

- `GET /api/sale` success/status transitions and configuration failure.
- Purchase validation, missing/invalid idempotency key, and rate-limit response.
- Each terminal outcome: confirmed, same-key confirmed retry, already purchased
  with a new key, upcoming, ended, and sold out.
- Key reuse by a different user (`409`), purchase lookup true/false, and no
  order/stock mutation for rejected outcomes.
- Internal reset/metrics success, missing/incorrect key, and production route
  absence.

### Concurrency tests

Run actual simultaneous requests against PostgreSQL rather than mocks:

- Set stock to 1; submit at least 20 unique users concurrently. Assert exactly
  one `confirmed`, all remaining requests are `sold_out` (unless timing
  deliberately exercises a window transition), one order, and remaining stock 0.
- Set limited stock N; submit substantially more than N unique users. Assert N
  confirmations, unique confirmed users, no negative stock, and
  `confirmedOrderCount + stockRemaining = initialStock`.
- Submit the same user/key concurrently and assert one order, one decrement, and
  consistent same order ID outcomes. Submit the same user using different keys
  concurrently and assert at most one order.

### Stress test setup, metrics, and pass criteria

1. Implement `backend/scripts/stress.ts` as a configurable HTTP client with
   environment/CLI options for base URL, internal key, stock, request count,
   concurrency, unique-user prefix, and sale duration. It resets the test sale
   through the protected endpoint, records start/end timestamps, then makes
   purchases with generated UUID keys.
2. Report total requests, elapsed time, requests/sec, outcome counts, non-2xx
   transport/error counts, latency percentiles (p50/p95/p99), and metrics from
   `GET /api/internal/metrics` after completion. Do not treat client time as a
   fairness proof.
3. Initial local pass criteria: no unexpected 5xx/transport errors; confirmed
   count is at most initial stock; confirmed users are unique; metrics reports
   `stockNonNegative`, `noOversell`, and `uniqueConfirmedUsers` true; and
   `confirmedOrderCount + stockRemaining = initialStock`. Record the machine,
   configuration, and observed throughput rather than claiming a universal RPS.
4. Include a repeatable default scenario (for example 1,000 requests,
   concurrency 50, stock 100) and a small CI-friendly scenario. The README must
   label these as local verification, not production capacity certification.

Verification checklist:

- Unit and integration suites pass against a clean migrated test database.
- Concurrency suite passes repeatedly, not merely once.
- Stress report includes its exact parameters and all invariant values.
- Any failed invariant retains its raw outcome/metrics output for diagnosis.

## Phase 7 — README and system-diagram deliverables

1. README: prerequisites, environment setup, service start/stop commands,
   migrations, backend/frontend launch commands, test commands, stress command,
   endpoint examples, and explicit internal-key handling.
2. README: state the assumptions—user ID stands in for authentication, payment
   is out of scope, one active product/sale locally, server time is authoritative,
   and confirmations are final inventory reservations.
3. Create `docs/system-diagram.mmd` and render the diagram in README. It must
   show browser client, edge/rate protection, stateless Fastify API, PostgreSQL,
   Redis rate limit/cache, plus the clearly labelled production-only FIFO queue
   and reservation worker path.
4. Explain the local `SELECT ... FOR UPDATE` row-lock algorithm and why it is
   correct but intentionally a hot-row bottleneck. Explain that the FIFO queue
   is the scaling evolution, not an implemented microservice.
5. Document API contracts/outcomes and test/stress pass criteria without
   unsupported availability, throughput, fairness, or cloud-infrastructure claims.

Verification checklist:

- A new developer can follow README from a clean checkout.
- Diagram source and README rendering communicate local versus production-only components.
- Documentation exactly matches implemented routes, configuration, and test commands.

## Risks, trade-offs, and non-goals

| Item | Decision / impact | Mitigation or boundary |
| --- | --- | --- |
| Single-sale row lock | Correct and simple locally, but serializes all purchases for the product. | Keep it local-only; document per-product FIFO queue workers as the scale evolution. |
| Idempotency retention | Orders retain keys indefinitely in this assessment. | Production would use a bounded retention/TTL plus audit policy; no deletion policy is implemented here. |
| User identity | Request `userId` is not authentication. | Production derives identity from a verified session/JWT; auth is a non-goal. |
| Payment and cancellation | A confirmation reserves stock permanently. | Payment settlement, expiry, cancellation, and inventory release are non-goals. |
| Redis outage | Rate limiting may degrade locally. | Database transaction/constraints remain authoritative; behavior is explicit/configured and logged. |
| Reset endpoint | Destructive test/development operation. | Do not register in production; require timing-safe keyed protection otherwise. |
| Clock boundary | Requests can wait on the sale row while the window changes. | Check server/database time after acquiring the lock, immediately before eligibility decisions. |
| Multi-product/multi-sale behavior | The assessment has one active local sale/product. | Do not add catalog, payments, event streaming, cloud services, or queue infrastructure. |

## Final end-to-end verification checklist

1. Start clean PostgreSQL and Redis, apply migrations, and reset a known active sale.
2. Confirm public sale status and purchase lookup before a purchase.
3. Confirm each purchase terminal outcome with deterministic reset windows/stocks.
4. Run the concurrency suite and inspect internal metrics invariants.
5. Run the documented stress scenario and record configuration/results.
6. Typecheck/build backend and frontend, then complete a browser demo flow.
7. Review README and Mermaid rendering against actual behavior.
8. Verify production configuration does not register the internal routes.
