# 8.4 — Vocabulary & Language Precision

> **Capstone connection:** Knowing the concepts is necessary. Using the right words for them is what signals senior-level fluency in English-language technical interviews. This chapter covers the vocabulary that distinguishes practitioner answers from textbook definitions.

---

## Why Word Choice Matters

Technical vocabulary is not pedantry. It is compression. The sentence "the circuit breaker is in half-open state" communicates a precise state in 8 words. Without the vocabulary, describing the same state takes a paragraph.

In an English-language interview, imprecise vocabulary signals one of two things: you don't know the concept deeply, or you know it but can't express it. Either way, it creates doubt.

This chapter covers three areas:
1. Concepts where the precise definition differs from the colloquial use
2. Pairs of terms that are commonly confused
3. English phrases for common engineering communication situations

---

## Concepts With Precise Definitions

### SLO vs SLA

| Term | What it is | Who uses it |
|------|-----------|-------------|
| **SLO** (Service Level Objective) | Internal target: "99.9% of requests complete in under 200ms" | Engineering team |
| **SLA** (Service Level Agreement) | External contract: "We guarantee 99.9% uptime or we pay a penalty" | Business and customers |
| **SLI** (Service Level Indicator) | The actual measured metric: "This month, 99.87% of requests were under 200ms" | Engineering, monitoring |

**Common mistake:** Saying "our SLA is..." when referring to an internal engineering target. SLAs have legal and commercial weight. SLOs are engineering targets.

**In an interview:**
> "Our SLO for order creation is P99 under 200ms and availability above 99.9%. We don't have a customer-facing SLA for this internal service, but the SLO drives our alerting thresholds."

---

### Availability vs Reliability

| Term | Meaning | Example |
|------|---------|---------|
| **Availability** | What percentage of the time is the service responsive? | 99.9% = 8.7 hours/year downtime |
| **Reliability** | Does the service produce the correct result consistently? | An available service that returns wrong data is unreliable |

You can have availability without reliability (service responds but with wrong data) and reliability without high availability (service is correct when it's up, but it's often down).

**In an interview:**
> "We target 99.9% availability. Reliability is harder to measure — we use the processing success rate metric: orders that complete successfully versus those that go to the DLQ."

---

### Idempotency vs Deduplication

| Term | Meaning | Where it lives |
|------|---------|---------------|
| **Idempotency** | Calling the same operation multiple times has the same effect as calling it once | API design, business logic |
| **Deduplication** | The system detects and discards duplicate messages | Messaging layer, SQS |

SQS Standard queues have *best-effort* deduplication (not guaranteed). Your worker must be *idempotent* — it should handle the same message arriving twice without creating duplicate data.

**In an interview:**
> "SQS Standard queues provide at-least-once delivery, which means duplicates are possible. We handle this with idempotency in the worker: it checks the order status before processing. If the order is already COMPLETED, the duplicate message is ignored."

---

### Retry vs Idempotency (the relationship)

Retry and idempotency are complementary:
- Retry says: *try again if it failed*
- Idempotency says: *it's safe to try again because the result is the same*

Without idempotency, retry creates duplicates. Without retry, transient failures become permanent. Together, they handle transient failures safely.

---

### Partition Key vs Shard Key vs Index

| Term | Context | What it determines |
|------|---------|--------------------|
| **Partition key** | DynamoDB, SQS FIFO | Which partition stores the data / determines ordering group |
| **Shard key** | MongoDB, distributed databases | Which shard owns the data |
| **Index** | SQL databases | Secondary lookup structure that doesn't affect storage partitioning |

In interviews, avoid using these interchangeably. "We indexed the orders table on `customerId`" is correct. "We partitioned by `customerId`" implies data sharding, which is a different operation.

---

### At-least-once vs Exactly-once vs At-most-once

| Delivery semantics | Behavior | Common use case |
|-------------------|----------|----------------|
| **At-most-once** | Message delivered zero or one times — may be lost | Fire-and-forget logging |
| **At-least-once** | Message delivered one or more times — no loss, possible duplicates | SQS Standard, Kafka (default) |
| **Exactly-once** | Message delivered exactly once — no loss, no duplicates | SQS FIFO with deduplication ID, Kafka transactions |

**In an interview:**
> "SQS Standard gives at-least-once delivery. We assume duplicates will occur and design the consumer to be idempotent. Exactly-once semantics with SQS FIFO would add ordering constraints and a deduplication window, which we don't need for order processing."

---

## Commonly Confused Pairs

### Rolling Update vs Blue-Green Deployment vs Canary

| Strategy | What happens | When to use |
|----------|-------------|-------------|
| **Rolling update** | Replace old pods with new pods gradually; both versions briefly coexist | Default for most changes |
| **Blue-Green** | Run two full environments simultaneously; switch traffic at once | Zero-risk cutover, easy rollback |
| **Canary** | Route small percentage of traffic to new version | High-risk changes, need production validation |

Our Kubernetes deployment uses rolling updates with `maxUnavailable: 0` and `maxSurge: 1`. Blue-green requires double the infrastructure. Canary requires a traffic-splitting mechanism (Argo Rollouts, Istio, or weighted services).

---

### Horizontal vs Vertical Scaling

| | Horizontal | Vertical |
|--|-----------|---------|
| **What changes** | Number of instances (pods/VMs) | Size of instance (CPU/RAM) |
| **Also called** | Scale out/in | Scale up/down |
| **Limit** | Very high (Kubernetes manages it) | Hard limit of available machine sizes |
| **Statefulness** | Requires stateless design | Works with stateful services |

`order-api` and `order-worker` are designed for horizontal scaling. They are stateless — all state lives in PostgreSQL or SQS. HPA handles horizontal scaling automatically.

---

### Throughput vs Latency

| Term | Meaning | Unit |
|------|---------|------|
| **Throughput** | How much work per unit of time | Requests per second, messages per minute |
| **Latency** | How long each unit of work takes | Milliseconds, P50/P95/P99 |

They are related but not interchangeable. A system can have high throughput with high latency (batch processing). Or low throughput with low latency (interactive UI). Or the configuration you're optimizing for will differ.

---

## English Phrases for Engineering Conversations

### Acknowledging trade-offs proactively

| Instead of... | Say... |
|--------------|--------|
| Just describing what you built | "The upside of this approach is X. The trade-off is Y." |
| Defending a decision when challenged | "That's a valid concern. At our scale, Y hasn't been a bottleneck. If traffic grew 10x, I'd revisit." |
| Dismissing an alternative | "Kafka would win here if we needed replay or multiple consumer groups — we don't." |

### Expressing uncertainty honestly

| Instead of... | Say... |
|--------------|--------|
| Guessing confidently | "I'm not certain about the exact behavior, but my reasoning is..." |
| Saying "I don't know" and stopping | "I haven't used that specific feature, but based on how X works, I'd expect Y because Z." |
| Avoiding the topic | "That's outside my direct experience. Let me reason through it with you." |

### Clarifying before answering

| Situation | Phrase |
|-----------|--------|
| Ambiguous requirements | "Before I go further — what's the expected throughput?" |
| Unclear scope | "Are you asking about local development or production deployment?" |
| Leading question | "It depends on the constraint. Can you tell me more about what's driving this?" |

---

## False Friends: Portuguese → English

These are common patterns where Portuguese sentence structure or vocabulary produces unnatural English in technical contexts.

| Portuguese pattern | Sounds like in English | Correct English |
|-------------------|----------------------|----------------|
| "fazer uma chamada" | "make a call to the database" | "query the database" |
| "persistir no banco" | "persist in the bank" | "persist to the database" |
| "o método faz um retorno" | "the method makes a return" | "the method returns" |
| "vai explicar o fluxo" | "I will explain the flow" | "let me walk you through the flow" |
| "funciona de tal forma que" | "functions in such a way that" | "works by..." |
| "realizar o deploy" | "realize the deploy" | "deploy" or "run the deployment" |
| "subir o serviço" | "raise the service" | "start the service" |
| "tratar o erro" | "treat the error" | "handle the error" |

---

## Precision Vocabulary Reference — Quick List

Terms you should be able to define precisely:

| Term | Precise meaning |
|------|----------------|
| Visibility timeout | Duration SQS hides a received message from other consumers |
| Dead Letter Queue | Queue that receives messages after N failed processing attempts |
| Long polling | SQS receives waiting up to 20s for messages (reduces empty polls) |
| MDC | Mapped Diagnostic Context — thread-local key-value store for log context |
| HikariCP | JDBC connection pool library used by Spring Boot; pool = set of reusable connections |
| IRSA | IAM Roles for Service Accounts — AWS mechanism for pod-level IAM access without static credentials |
| Rolling update | Kubernetes deployment strategy replacing pods one at a time |
| maxSurge | Number of extra pods allowed above desired count during rolling update |
| maxUnavailable | Number of pods allowed to be down during rolling update |
| Correlated subquery | SQL query inside a WHERE clause that references the outer query's row |
| PgBouncer | Connection pooler that multiplexes many application connections onto fewer real DB connections |
| Cardinality | Number of distinct values — high cardinality in metrics tags creates too many time series |

---

## Exercise 8.4

Rewrite these five sentences. Remove Portuguese sentence patterns and imprecision.

1. "The system makes a call to the database to persist the order in the bank."
2. "The method makes a return of the order ID to the client."
3. "We will do a deploy of the new version and the system will go up."
4. "The retry logic treats the error and tries to process the message again."
5. "We utilize the SQS service for the async communication between the services."

### Answer

1. "The service queries the database to persist the order."
2. "The method returns the order ID to the client."
3. "We'll deploy the new version. The service will start and be ready within 30 seconds."
4. "The retry logic handles the error and reprocesses the message with exponential backoff."
5. "We use SQS for asynchronous communication between the two services."

**Key patterns fixed:**
- "makes a call to" → "queries"
- "in the bank" → removed (it's always "the database")
- "makes a return of" → "returns"
- "do a deploy" → "deploy" (deploy is already a verb)
- "go up" → "start", "be ready"
- "treats" → "handles"
- "utilize" → "use" (more natural)
- "the services" → "the two services" (be specific)

---

*Next: [8.5 — Self-Assessment & Final Capstone Test](./05-final-capstone-test.md)*
