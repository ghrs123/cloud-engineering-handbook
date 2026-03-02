# ADR-0002 — Idempotency Implementation Strategy

**Status:** Accepted  
**Date:** 2024-01  

---

## Context

`POST /orders` must be idempotent: if a client sends the same request twice (due to timeout, network failure, or retry logic), the system must return the same response without creating a duplicate order.

The `Idempotency-Key` header is the client-side mechanism: the client generates a UUID per payment/order attempt and includes it on every retry.

---

## Decision

**Store idempotency keys in a dedicated PostgreSQL table**, co-located with the orders database.

Schema:
```sql
CREATE TABLE idempotency_keys (
  key         VARCHAR(255) PRIMARY KEY,
  order_id    UUID NOT NULL,
  response    JSONB NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
```

The check-and-insert happens **within the same transaction** as the order creation.

---

## Reasoning

### Options considered

| Option | Pros | Cons |
|---|---|---|
| PostgreSQL table (chosen) | Transactional with order insert, no extra infra | Table grows; needs TTL or cleanup job |
| Redis with TTL | Fast reads, auto-expiry | Extra infra dependency; eviction risk |
| In-memory (app level) | Zero latency | Lost on restart; fails with multiple replicas |
| SQS message deduplication | Native for FIFO queues | Only applies to the queue, not to API layer |

### Why PostgreSQL

The simplest correct solution. The idempotency key and the order row must be committed atomically — either both exist or neither does. This is trivially achieved with PostgreSQL transactions. Adding Redis would introduce a distributed atomicity problem (what if PostgreSQL commits but Redis fails to store the key?).

The table will not grow unboundedly in practice: add a background job or scheduled `@Transactional` method to clean up keys older than 24 hours (or 7 days depending on retry window policy).

---

## Implementation Pattern

```java
@Transactional
public CreateOrderResponse createOrder(CreateOrderRequest request, String idempotencyKey) {
    // 1. Check if key already processed
    return idempotencyRepository.findById(idempotencyKey)
        .map(record -> objectMapper.convertValue(record.getResponse(), CreateOrderResponse.class))
        .orElseGet(() -> {
            // 2. Process and persist
            Order order = orderService.persist(request);
            eventPublisher.publish(new OrderCreatedEvent(order));
            
            CreateOrderResponse response = new CreateOrderResponse(order.getId(), order.getStatus(), ...);
            
            // 3. Store key + response (same transaction)
            idempotencyRepository.save(new IdempotencyKey(idempotencyKey, order.getId(), response));
            
            return response;
        });
}
```

---

## Consequences

**Positive:**
- Atomic: no race condition between key storage and order creation
- No extra infrastructure
- Inspectable: you can query the table to debug replay behavior

**Negative:**
- Table needs a cleanup strategy (scheduled job, or TTL enforced in application layer)
- Slightly slower than Redis for pure key lookup (acceptable: PostgreSQL indexed lookup on primary key is sub-millisecond)

---

## What a Race Condition Looks Like Without This Approach

Without a transaction-bound idempotency check:

```
T1: Request A checks key → not found
T2: Request B checks key → not found  (race!)
T3: Request A inserts order + key
T4: Request B inserts order + key → DUPLICATE ORDER
```

With `@Transactional` and `INSERT ... ON CONFLICT DO NOTHING` (or `findById` within the same transaction with proper isolation), one of the two concurrent requests wins and the other receives the stored response.

For high-concurrency scenarios, use `INSERT INTO idempotency_keys ... ON CONFLICT (key) DO NOTHING` and check rows affected.
