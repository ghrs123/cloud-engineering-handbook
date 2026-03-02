# 8.2 — Defending Trade-offs

> **Capstone connection:** Every major decision in this architecture has a "why not X?" question waiting for it. This chapter prepares answers for the five most likely challenges — using the same ADR thinking that produced them.

---

## The Senior Difference: Proactive Trade-off Communication

Junior engineers describe what they built.
Senior engineers describe what they built *and why* — including what they chose not to build.

In an interview, the difference shows up like this:

**Junior:** "We used SQS for the message queue."

**Senior:** "We chose SQS over Kafka because our volume is moderate — hundreds to low thousands of messages per second — and we don't need message replay or multiple independent consumer groups. SQS gives us zero operational overhead. Kafka would be the right call if we needed event sourcing or if multiple services needed to independently replay the same events."

The senior answer demonstrates:
- You know the alternative exists
- You understand where the alternative wins
- You made a deliberate, reasoned choice — not the default

This is what interviewers are probing for when they ask "why not X?"

---

## The ADR Framework for Trade-off Answers

An Architecture Decision Record (ADR) has three parts: **Context → Decision → Consequences.**

When defending a trade-off, map to this structure:

```
Context:   What was the constraint or requirement?
Decision:  What we chose, and why it fits the constraint.
Consequences: What we gave up, and when we'd revisit.
```

This structure works in interviews because it's complete. Context prevents the "but what about high scale?" objection. Consequences show honesty.

---

## Trade-off 1: SQS over Kafka

**The challenge:** *"Why not Kafka? Kafka has better throughput and replay capabilities."*

> "For this use case, SQS was the right trade-off. The constraints: one producer (order-api), one consumer group (order-worker), moderate volume (hundreds to low thousands of orders per minute), no need for event replay to rebuild read models.
>
> SQS gives zero operational overhead — no cluster to provision, no partition management, no consumer group offset tracking. The DLQ is three lines of Terraform. LocalStack runs SQS with a single Docker image.
>
> Kafka wins when you need: (1) high throughput above ~100k messages per second — we're nowhere near that, (2) multiple independent consumer groups with independent offsets — we have one, (3) message replay for rebuilding projections — we don't do event sourcing.
>
> If the system grew to include an analytics service that needs to independently replay all orders from the beginning, I would revisit. That's the first scenario where Kafka's value proposition becomes concrete."

---

## Trade-off 2: PostgreSQL over DynamoDB

**The challenge:** *"Why not DynamoDB? It scales better and has no maintenance."*

> "PostgreSQL fits this use case better for three reasons. First, the data model is relational — orders have items, items reference SKUs, statuses have transition rules. Modeling this in DynamoDB requires careful design of partition keys and composite sort keys, and you lose ad-hoc queries, joins, and foreign key constraints.
>
> Second, Flyway migrations. Schema evolution in a PostgreSQL database is straightforward — versioned SQL files that run in sequence. In DynamoDB, you don't have a schema to migrate, which sounds simpler but means your application code must handle old and new attribute formats simultaneously, forever.
>
> Third, idempotency with transactions. The idempotency check and order creation are in the same database transaction — atomically. In DynamoDB, you'd use `TransactWriteItems`, which works but adds complexity and has different limits.
>
> DynamoDB would win if I needed to scale writes to tens of thousands per second, or if I needed a serverless deployment with zero DB management. For order processing at product company scale — say up to a few thousand requests per second — PostgreSQL with read replicas handles it comfortably."

---

## Trade-off 3: REST (202 Accepted) over WebSockets or Callbacks

**The challenge:** *"How does the client know when the order is done? Polling is inefficient."*

> "The `POST /orders` returns `202 Accepted` with an `orderId`. The client polls `GET /orders/{id}` to check status. This is intentional.
>
> The use case is order placement, not real-time dashboard. The processing takes 0.5–2 seconds and the client typically moves to a confirmation screen immediately. A single poll after 1 second covers most cases. The implementation is simple — no WebSocket lifecycle management, no callback URL registration, no webhook delivery guarantees.
>
> WebSockets would be the right choice for a real-time dashboard showing live order status updates to an operations team. Server-Sent Events would work for a single long-lived connection per order. Webhooks would be appropriate if the client is another backend service that needs async notification.
>
> For a customer-facing checkout flow, polling every second for up to 5 seconds is acceptable. The trade-off I'm making is simplicity over push efficiency. If polling became a significant load driver — say thousands of clients polling simultaneously — I'd add a Server-Sent Events endpoint."

---

## Trade-off 4: Kubernetes over ECS or Serverless

**The challenge:** *"Why Kubernetes? ECS is simpler and Lambda removes all the infrastructure."*

> "Kubernetes was chosen for three reasons in this context: portable, declarative, and consistent with international product company environments.
>
> Portable: the same manifests run on local kind clusters, staging, and production OpenShift — no vendor lock-in, no ECS task definition format. Lambda would lock us to AWS.
>
> Declarative: the full runtime configuration — replicas, resource limits, health probes, config, secrets — is version-controlled YAML. A Terraform apply plus a `kubectl apply` reproduces the entire environment.
>
> Consistent: mid-to-senior positions at product companies expect Kubernetes proficiency. The course specifically targets that audience.
>
> ECS is a valid choice if the team is small, already deep in AWS, and doesn't need multi-cloud or on-premises options. Lambda would require redesigning the service as function handlers — viable for event-driven workloads but the cold start latency and 15-minute execution limit are constraints that don't fit `order-worker`'s model well."

---

## Trade-off 5: Correlation ID over OpenTelemetry

**The challenge:** *"Why a manual correlationId instead of OpenTelemetry? It's the industry standard."*

> "The correlationId approach gives 80% of the debugging value at 10% of the infrastructure cost.
>
> OpenTelemetry requires: an OTel SDK in every service, a collector sidecar or DaemonSet, a tracing backend (Jaeger or AWS X-Ray), and instrumentation for every span. For two services, that's significant overhead for the gain.
>
> With correlationId: one servlet filter, one MDC key, one SQS message attribute, one grep. You can reconstruct the full lifecycle of any request across both services without any additional infrastructure.
>
> OpenTelemetry becomes the right choice when: (1) you have 5+ services and the correlation ID approach breaks down because the dependency graph is complex, (2) you need visualised call trees and don't want to aggregate logs manually, (3) you have a platform team to maintain the collector and backend.
>
> The upgrade path is clear: when we add a third service, I'd switch to OTel and have the correlationId become the OTel trace ID — they're conceptually the same thing."

---

## Common Mistakes

**Defending decisions with appeal to authority:**

❌ "We used SQS because that's what Netflix uses."
✅ "We used SQS because our constraints were X, and SQS fits X because Y."

**Not knowing when the alternative wins:**

❌ "Kafka is more complex so we chose SQS." (sounds like lack of knowledge)
✅ "Kafka wins when you need replay or multiple consumer groups — we don't have those requirements."

**Being defensive instead of analytical:**

❌ "DynamoDB wouldn't work here." (no explanation)
✅ "DynamoDB is a valid choice when X. Our constraints are Y, so PostgreSQL fits better."

**Claiming the current design is perfect at any scale:**

❌ "This handles any scale."
✅ "At 10x volume, I'd add PgBouncer for connection pooling and reconsider the DB instance size. At 100x, I'd look at partitioning the orders table."

---

## Exercise 8.2

Answer these questions out loud without reading the answers from this chapter. Time each answer (target: 60–90 seconds).

1. *"Why not Kafka for the message queue?"*
2. *"Why did you keep everything in PostgreSQL instead of splitting to a document database for orders and a relational DB for the idempotency table?"*
3. *"Why not use Spring WebFlux (reactive) instead of Spring MVC (blocking)?"*

For question 3, you haven't been given the answer. Reason through it yourself using the ADR framework: what's the constraint? what does reactive win at? what did you give up?

### Answer

**Question 1:** See Trade-off 1 above. Deliver it in 60–90 seconds.

**Question 2:**
> "Splitting databases for operational convenience is premature optimization. The idempotency records and orders are related — they're both written in the same transaction. Splitting them would require distributed transactions or an eventual consistency strategy, adding complexity with no benefit at this scale.
>
> A single PostgreSQL database with separate tables and a Flyway migration for each schema change is simpler, easier to operate, and sufficient for the expected volume. I'd revisit if the idempotency table grows to hundreds of millions of rows, but we can archive old records on a TTL schedule well before that becomes a problem."

**Question 3 (reasoning exercise):**
> "Spring MVC with virtual threads (Java 21 + Spring Boot 3.2+) gives the same concurrency benefit as reactive without the reactive programming model. Reactive code is harder to read, harder to debug, and the ecosystem support (especially for JDBC and SQS) still has gaps. The tradeoff isn't `reactive vs blocking` anymore with virtual threads — it's `reactive complexity vs simple blocking code that scales well under virtual threads`.
>
> If the system used purely non-blocking IO across every layer — WebClient, R2DBC, reactive SQS SDK — reactive would be compelling. But we use JDBC for PostgreSQL, which blocks, negating the reactive benefit. Virtual threads + MVC is the pragmatic choice for this stack."

---

*Next: [8.3 — The 12 Interview Questions](./03-twelve-interview-questions.md)*
