# System Architecture

> This document describes the overall architecture of the Cloud-Native Order Processing Platform. It is the reference point for all design decisions documented in `/docs/decisions/`.

---

## Architectural Style

The system uses **event-driven microservices** — two Spring Boot services communicate asynchronously via a message queue. This is intentional and not over-engineering: it allows the `order-api` to return immediately to the client without waiting for processing to complete, and it decouples the processing lifecycle from the REST API.

**What this is not:** a full microservices mesh with service discovery, sidecar proxies, or distributed tracing infrastructure. Those are valid for systems at scale — but this capstone targets the minimum viable architecture that demonstrates the patterns expected of a senior backend engineer.

---

## Service Responsibilities

| Service | Layer | Responsibility |
|---|---|---|
| `order-api` | HTTP boundary | Validate, persist, publish, respond |
| `order-worker` | Event processor | Consume, process steps, update state |
| PostgreSQL | State | Single source of truth for order data |
| SQS | Transport | Durable async delivery, retry, DLQ |

---

## Data Flow

```
1. Client sends POST /orders with Idempotency-Key header
2. order-api validates the request
3. order-api checks idempotency key (already processed?)
4. order-api persists Order(status=PENDING) in PostgreSQL
5. order-api publishes OrderCreatedEvent to SQS
6. order-api returns 202 Accepted to client
7. order-worker polls SQS (long polling, 20s)
8. order-worker updates Order(status=PROCESSING)
9. order-worker executes steps (inventory-check, payment-authorization)
10. order-worker updates final status (COMPLETED or FAILED)
11. If permanent failure: order-worker sends to DLQ, logs failure event
```

---

## What Lives Where

### `order-api` internal layers

```
com.example.orderapi
├── api/              ← Controllers, request/response DTOs, exception handlers
├── service/          ← Business logic, idempotency, event publishing
├── domain/           ← Order entity, OrderStatus enum, domain events
├── repository/       ← Spring Data JPA repositories
├── messaging/        ← SQS publisher, event types
├── config/           ← Spring config, SQS client config, security filter
└── common/           ← CorrelationId MDC filter, logging config
```

### `order-worker` internal layers

```
com.example.orderworker
├── consumer/         ← SQS message listener/poller
├── processor/        ← OrderProcessor, step orchestration
├── steps/            ← InventoryCheckStep, PaymentAuthStep
├── service/          ← OrderStatusService (updates DB)
├── messaging/        ← Event types, DLQ publisher
└── common/           ← CorrelationId propagation from message
```

---

## Key Architectural Decisions

| Decision | Choice | Why |
|---|---|---|
| Queue technology | AWS SQS | Managed, reliable, native DLQ support, IAM-integrated. [ADR-0001](../decisions/adr-0001-queue-choice.md) |
| Idempotency storage | PostgreSQL table | Same DB as orders, transactional safety, simple. [ADR-0002](../decisions/adr-0002-idempotency.md) |
| CorrelationId propagation | HTTP header → SQS attribute → MDC | Enables cross-service log correlation. [ADR-0003](../decisions/adr-0003-correlation.md) |
| Sync vs Async API | Async (202 Accepted) | Decouples API latency from processing duration |
| Monorepo | Yes | Simpler for course; production may separate repos per team |
| Auth approach | API key via header | Faster to implement than full OAuth2; upgradeable |

---

## Deployment Topology (Kubernetes)

```
Namespace: order-platform

order-api Deployment (replicas: 2-10)
  └── order-api Service (ClusterIP)
      └── Ingress (external access)

order-worker Deployment (replicas: 1-10, KEDA optional)
  └── No Service needed (consumer, not server)

Shared:
  └── ConfigMaps: app config per environment
  └── Secrets: DB credentials, SQS config, API key
  └── HPA: CPU-based for both deployments
```

---

## What This Architecture Does NOT Address

Explicitly out of scope for this capstone (but worth knowing exist):

- **Service mesh** (Istio, Linkerd): mTLS between services, traffic management — relevant at larger scale
- **Distributed tracing** (Jaeger, Zipkin): full trace visualization — the correlationId approach covers 80% of the debugging value
- **Event sourcing**: orders are state-based, not event-sourced — appropriate for this domain
- **CQRS**: single read/write model — CQRS adds complexity not warranted here
- **Multi-region**: single-region HA via Multi-AZ is the target
- **GraphQL**: REST is appropriate for this bounded context
