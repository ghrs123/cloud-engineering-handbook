# ADR-0001 — Queue Technology Choice: AWS SQS over Kafka

**Status:** Accepted  
**Date:** 2024-01  
**Deciders:** Course author

---

## Context

The system needs a durable message queue to decouple `order-api` from `order-worker`. The two main candidates for a Java/Spring Boot system targeting AWS are:

- **AWS SQS** — fully managed, pull-based, native DLQ, IAM-integrated
- **Apache Kafka** — distributed log, push/pull hybrid, consumer groups, log compaction, replay

Both are production-grade. The choice matters for the operational model and the Spring integration approach.

---

## Decision

**Use AWS SQS** as the primary queue, with LocalStack for local development.

---

## Reasoning

### Why SQS for this system

| Factor | SQS | Kafka |
|---|---|---|
| Operational complexity | Near-zero (fully managed) | High (brokers, ZooKeeper/KRaft, retention) |
| Local dev setup | LocalStack: `docker run localstack/localstack` | Redpanda or multi-container compose |
| DLQ support | Native, 3 config lines | Manual setup, separate topic, consumer group |
| Ordering | FIFO queues when needed | Native (per partition) |
| Replay | No native replay | Core feature |
| AWS IAM integration | Native (IRSA) | Via MSK IAM or SASL |
| Spring integration | `spring-cloud-aws-messaging` | `spring-kafka` |
| Throughput ceiling | ~3,000 msg/s (standard), unlimited with sharding | Millions/s |

### When SQS is the right choice

- You don't need event replay or log compaction
- You're running on AWS and want managed infrastructure
- You want native DLQ without additional configuration
- Your throughput is under millions of messages per second per queue
- Teams don't have Kafka operational expertise

### When Kafka would be the right choice

- You need to replay events (audit, reprocessing after bug fix)
- You have multiple consumer groups reading the same events independently
- You need log compaction (latest state per key)
- You're processing millions of events per second
- You already have Kafka operational expertise in the team

### For this capstone

The order domain does **not** require replay. Orders are state-driven, persisted in PostgreSQL, and the worker only needs to process each event once. SQS covers this perfectly and is dramatically simpler to operate.

---

## Consequences

**Positive:**
- LocalStack simulates SQS with zero AWS account required in dev
- Native DLQ: if message fails after N retries, SQS moves it automatically
- IAM-based access control: no credentials in code (IRSA in production)
- Zero Kafka cluster to manage

**Negative:**
- No native replay — if you need to reprocess completed orders, you must re-read from PostgreSQL, not from the queue
- Standard SQS does not guarantee strict ordering (use FIFO if needed, with throughput trade-off)
- Lock-in to AWS ecosystem

**Mitigation for ordering:**
For this system, strict ordering is not required per order (each order has a unique ID and processing is idempotent). If ordering were critical, SQS FIFO queues with message group IDs per customerId would solve it.

---

## Alternatives Considered

**Kafka with Redpanda locally:** Valid, but adds ~3x complexity to local dev setup and module content without adding value for the learning objectives of this course.

**RabbitMQ:** Strong candidate for Spring Boot, but not as aligned with AWS-centric hiring requirements at product companies targeting this audience.

**Database polling (outbox pattern):** Valid for very high reliability, but over-engineered for this scope. The transactional outbox pattern is documented in the appendix as a reference.
