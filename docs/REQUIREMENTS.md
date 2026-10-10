# Flash Sale Requirements Matrix

## Scope

One limited-stock product is sold during one configurable sale window. A user can secure at most one item. The browser is a demo client; the backend owns every purchase decision.

## Functional requirements

| ID | Requirement | Implementation decision | Acceptance criteria |
| --- | --- | --- | --- |
| F1 | Configurable sale period | `flash_sales.starts_at` and `ends_at` are server-side timestamps. | Purchase returns `upcoming` before the start and `ended` at/after the end. |
| F2 | One product, limited stock | A sale row stores `stock_remaining >= 0`. | Confirmed orders never exceed initial stock; stock never becomes negative. |
| F3 | One item per user | Database constraint: `UNIQUE(sale_id, user_id)`. | Repeated attempts by the same user return `already_purchased` and never consume another item. |
| F4 | Sale status endpoint | `GET /api/sale`. | Returns sale state, public product information, stock remaining, and sale window. |
| F5 | Purchase endpoint | `POST /api/purchases`. | Returns exactly one terminal outcome: `confirmed`, `already_purchased`, `upcoming`, `ended`, or `sold_out`. |
| F6 | Purchase lookup endpoint | `GET /api/purchases/me?userId=...`. | Returns whether the user secured an item and its order ID when present. |
| F7 | Basic React client | User ID field, sale status, Buy Now, and outcome feedback. | A user can run the full demo flow from one browser. |
| F8 | System diagram | Mermaid source plus rendered diagram in README. | Shows client, edge protection, API, database, Redis, and production queue/worker path. |

## Internal development/test endpoints

These endpoints do not support the public client. They are disabled in production and require `x-internal-api-key`.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/internal/sales/reset` | Sets stock and window for a repeatable demo, integration test, or stress test. |
| `GET /api/internal/metrics` | Shows initial stock, remaining stock, confirmed order count, duplicate-user count, and invariant results. |

## Non-functional requirements

| Area | Local runnable implementation | Production-scale evolution |
| --- | --- | --- |
| Concurrency | PostgreSQL transaction locks the single sale row and decrements stock only inside the transaction. | FIFO queue partitioned by product serializes reservations; workers scale across different products. |
| Fairness | PostgreSQL lock acquisition defines a deterministic server-side processing order. | Queue offset is the accepted server-side order per product. Client timestamps are never trusted. |
| Retry safety | The client sends an idempotency key; database enforces it per sale. | Retain idempotency records with a bounded TTL/audit policy. |
| One-user rule | Unique database constraint on `(sale_id, user_id)`. | Same constraint remains the final source of truth. |
| Load shedding | Redis-backed rate limit protects the purchase endpoint. | CDN/WAF, per-user/IP limits, queue backpressure, and autoscaled stateless API replicas. |
| Failure handling | Transaction rollback preserves stock/order consistency. | Durable queue, dead-letter queue, monitoring, alerting, multi-AZ managed database. |
| Observability | Structured request logs and internal metrics endpoint. | Central logs, metrics, traces, queue depth/age alerts, and purchase-outcome dashboards. |

## Explicit assumptions

1. Authentication is outside this assessment. `userId` represents an already authenticated user; production would derive it from a verified session/JWT rather than request input.
2. Payment is outside scope. A confirmed order means the user secured inventory, not that payment settled.
3. There is one active sale and one product in the local implementation.
4. The server clock is authoritative for the sale window.
5. A purchase is final once confirmed; cancellation/release logic is not required.

## Important edge cases

- User retries due to a timeout: same idempotency key returns the same completed order.
- User double-clicks Buy Now: unique user constraint ensures at most one order.
- Stock is one and many users purchase concurrently: exactly one transaction confirms.
- Sale ends while requests are waiting: the worker/transaction checks the server time before confirmation.
- Redis is unavailable: do not bypass database correctness; rate limiting is degraded only if explicitly configured for local development.
