# 8.3 — The 12 Interview Questions

> **Capstone connection:** These are the 12 questions you will be asked about this architecture. Every answer comes from something you built in this course. This chapter is a reference — but the goal is to answer all 12 without consulting it.

---

## How to Use This Chapter

Read each question and attempt the answer before reading the scripted answer. Use the self-assessment at the end to identify gaps.

The scripted answers are calibrated for a senior-level audience. They are not textbook definitions — they are practitioner answers with trade-offs acknowledged.

---

### Q1: *"Why did you choose SQS over Kafka?"*

> "For this use case, SQS was the right trade-off. The queue volume is moderate — hundreds to low thousands of messages per second — and we don't need message replay or multiple consumer groups with independent offsets. SQS gives zero operational overhead: no cluster to provision or monitor, DLQ configuration in three lines of Terraform, and LocalStack for local development with a single Docker image.
>
> Kafka would be the right answer if we needed to replay events to rebuild a read model, or if we had multiple services that needed to independently consume the same events at different speeds. The throughput advantage of Kafka matters above roughly 100,000 messages per second — we're nowhere near that."

---

### Q2: *"How does your idempotency implementation work?"*

> "The client sends an `Idempotency-Key` header — a UUID they generate. On the server, before processing, I check a PostgreSQL table for that key. If it exists, I return the stored response. If it doesn't, I run the operation inside a transaction that atomically inserts the order and the idempotency record, then cache the response.
>
> The critical detail: the check-and-insert is inside the same database transaction as the order creation. Without that, two concurrent requests with the same key could both check, both find nothing, and both proceed — a race condition. The transaction serializes this.
>
> Idempotency records are cleaned up after 24 hours via a scheduled job — you don't need them forever, only during the client's retry window."

---

### Q3: *"What happens if order-worker crashes while processing an order?"*

> "SQS handles this via the visibility timeout. When the worker receives a message, SQS makes it invisible for 30 seconds. If the worker crashes before deleting it, the timeout expires and the message becomes visible again for another worker to pick up.
>
> The worker is idempotent at the start: it reads the order status. If it's already PROCESSING or COMPLETED from a previous attempt, it skips. If it's still PENDING, it proceeds normally.
>
> After three SQS-level retries — three separate receive-then-crash cycles — the message goes to the DLQ. We alert on any DLQ depth above zero and investigate manually."

---

### Q4: *"How would you scale this system 10x?"*

> "The bottlenecks at 10x are different for each service.
>
> For `order-api`: the HPA scales horizontally on CPU. The constraint is database connections. Each pod has a HikariCP pool of 10; with 20 pods that's 200 connections, which exceeds a small RDS instance's limit. The solution is PgBouncer — or AWS RDS Proxy — which multiplexes hundreds of application connections onto a small number of real database connections.
>
> For `order-worker`: more consumer pods means more parallel processing. HPA handles this on CPU. For queue-depth-based scaling, KEDA with an SQS scaler scales workers directly proportional to queue depth — more precise than CPU-based scaling for consumer workloads.
>
> For SQS: Standard queues handle nearly unlimited throughput — SQS itself doesn't bottleneck here.
>
> For the database at 10x write volume: read replicas for status queries, and partitioning the orders table by `created_at` if the table grows very large."

---

### Q5: *"What's the difference between readiness and liveness probes?"*

> "They answer different questions and have different consequences on failure.
>
> Readiness asks: is this pod ready to receive traffic right now? If it fails, Kubernetes removes the pod from the Service's endpoint list — no new traffic, but the pod continues running. This is right when the pod is temporarily unable to serve: DB is slow, queue is unreachable, warming up.
>
> Liveness asks: is the JVM alive? If it fails, Kubernetes kills and restarts the container. This is for detecting a truly stuck process.
>
> The critical mistake is putting DB checks in the liveness probe. If the database goes down, liveness fails, Kubernetes restarts all pods — a restart storm during a DB outage. Liveness should only check that the JVM is responding. DB and queue checks belong in readiness."

---

### Q6: *"How do you handle database migrations in production?"*

> "With Flyway. Migrations are versioned SQL files — `V1__create_orders.sql`, `V2__add_index.sql` — that run in sequence. Flyway records applied migrations in `flyway_schema_history` and only runs new ones.
>
> Spring Boot runs Flyway on startup before accepting traffic. In a Kubernetes rolling update, the new pod runs migrations first. If a migration fails, the pod doesn't start and the rollout stops — existing pods continue serving on the old schema. No downtime.
>
> The constraint: migrations must be backward-compatible with the running version. You can't remove a column the current code reads. The pattern: first deployment adds the new column, second deployment removes the old one after the first is fully rolled out."

---

### Q7: *"Explain the circuit breaker pattern."*

> "A circuit breaker monitors failure rates for a downstream dependency. Closed state: calls pass through. When failures exceed a threshold — say 50% of the last 10 calls — it transitions to Open. In Open state, calls are rejected immediately without attempting the downstream. After a wait duration, it transitions to Half-Open and allows probe calls. Successes close it; failures reopen it.
>
> Two benefits: fail fast — rather than holding threads waiting for a service that's down, you return an error immediately, freeing resources. Second: you give the downstream service time to recover without being overwhelmed by retry traffic from all instances simultaneously.
>
> I pair it with retry: the circuit breaker is the outer layer. If it's open, no retries are attempted. If it's closed and a call fails, the retry layer handles the transient case."

---

### Q8: *"Why do you use structured JSON logging?"*

> "Two reasons: queryability and context propagation.
>
> Log aggregation systems — CloudWatch Logs Insights, Loki, Elasticsearch — can filter and aggregate on structured fields. 'Show me all ERROR logs for orderId X' or 'show me the P99 time between creation and completion by extracting timestamps' — these are simple queries with JSON. With plain text, it's regex, which is fragile.
>
> Context propagation: the `correlationId` in MDC means every log line in a request's thread automatically carries the same ID. When the worker processes the message, it restores the correlationId from the message attribute to its MDC. One ID, one grep, full picture across both services."

---

### Q9: *"What would you change if this needed to be 99.99% available?"*

> "99.99% is 52 minutes of downtime per year. That changes several things.
>
> First, multi-region. A regional failure — rare but not hypothetical — takes the current single-region system down. Active-passive with Route 53 failover to a secondary region gets close to 99.99%.
>
> Second, the transactional outbox pattern. If the service crashes between saving the order to PostgreSQL and publishing to SQS, the event is lost. With the outbox pattern, the event is written atomically in the same transaction as the order. A separate process reads the outbox and publishes, guaranteeing at-least-once delivery.
>
> Third, chaos testing. At 99.99%, the retry and deduplication paths must be tested under failure conditions — not assumed to work. AWS Fault Injection Simulator or similar.
>
> Fourth, the DLQ alert response time drops from 'Slack notification' to 'PagerDuty page immediately'."

---

### Q10: *"How do you keep credentials out of your code?"*

> "Three layers.
>
> For AWS access in Kubernetes: IRSA. Pods have a ServiceAccount annotated with an IAM Role ARN. EKS injects temporary, auto-rotating credentials via a web identity token. No `AWS_ACCESS_KEY_ID` anywhere — not in the pod, not in the image, not in Kubernetes Secrets.
>
> For other secrets — DB passwords, API keys: the External Secrets Operator syncs them from AWS Secrets Manager into Kubernetes Secrets. The Deployment reads from `secretKeyRef`. The source of truth is Secrets Manager, which supports rotation and audit logging.
>
> Nothing sensitive ever touches Git. `.gitignore` covers `.tfstate` files and `.env` files. CI injects secrets via environment variables sourced from Secrets Manager at runtime, not stored in the pipeline."

---

### Q11: *"What's in your Dockerfile and why?"*

> "Multi-stage build with three stages.
>
> Stage one: dependency layer. Copy only `pom.xml` and run `mvn dependency:go-offline`. This creates a Docker layer cached as long as dependencies don't change. Stage two: build. Copy source, compile, extract the Spring Boot layered JAR into four subdirectories ordered by change frequency. Stage three: runtime. JRE-only Alpine image — no JDK, no compiler, no source code. Copy the four extracted layers in dependency-first order so unchanged layers hit the Docker cache.
>
> Final image is around 230MB instead of 750MB. On a typical code change, only the `application/` layer — 2–3MB — needs to be pushed to the registry.
>
> Security: non-root user, `runAsNonRoot: true` in the Kubernetes SecurityContext. JVM flags: `UseContainerSupport` and `MaxRAMPercentage=75.0` so the heap scales with the container limit, not the node's total RAM."

---

### Q12: *"How do you approach a production incident for this system?"*

> "Four phases.
>
> Triage: what's the user-visible impact? Orders failing to create, processing delays, or total outage? I check Grafana: order creation rate, DLQ depth, error rate, circuit breaker state. This tells me which component within 2 minutes.
>
> Stabilise: if processing is stuck, I check the circuit breaker state in metrics. If the DB is overloaded, I check HikariCP connection count. The goal is to stop the bleeding before root cause analysis.
>
> Trace: I find a failed order's `correlationId` — from the error log, from the DLQ message, or from a customer report. Grep all logs for that ID. Reconstruct the exact sequence across both services.
>
> Fix and validate: for a code bug — fix, deploy, replay DLQ messages. For infrastructure — Terraform apply, verify metrics recover, run the smoke test script."

---

## Self-Assessment Checklist

Answer each question without reading the chapter. Mark the result.

| # | Question | Answered in 60–90s | Mentioned key trade-off |
|---|----------|-------------------|------------------------|
| 1 | SQS vs Kafka | ☐ | ☐ |
| 2 | Idempotency implementation | ☐ | ☐ |
| 3 | Worker crash recovery | ☐ | ☐ |
| 4 | Scale 10x | ☐ | ☐ |
| 5 | Readiness vs liveness | ☐ | ☐ |
| 6 | DB migrations | ☐ | ☐ |
| 7 | Circuit breaker | ☐ | ☐ |
| 8 | Structured logging | ☐ | ☐ |
| 9 | 99.99% availability | ☐ | ☐ |
| 10 | Credentials | ☐ | ☐ |
| 11 | Dockerfile | ☐ | ☐ |
| 12 | Production incident | ☐ | ☐ |

**Target before applying:** All 24 cells checked.

---

## Exercise 8.3

Pick questions 5 and 9. Deliver both answers to a colleague, partner, or into a recording. Have them ask follow-up questions after each answer.

Common follow-ups for Q5: *"So you'd never put a DB check in liveness? What if the DB is essential for the JVM to do anything?"*

Common follow-ups for Q9: *"What's the transactional outbox pattern exactly? How does it guarantee at-least-once?"*

Prepare answers for these follow-ups before the session.

### Answer to Q5 follow-up

> "If the database is down, the JVM should still respond to the liveness probe — it's alive, just unable to serve. The right response is for readiness to fail and remove the pod from traffic rotation. Kubernetes killing and restarting the pod doesn't help when the database is down — the restarted pod will just hit the same unavailable database.
>
> The only case for a DB check in liveness is if the DB connection failure causes a deadlock or JVM hang that makes the process truly unresponsive. In that case, liveness detects the hang and restarts the JVM. But this is the exception, not the rule, and you'd want circuit breaker or health check caching to prevent false positives."

### Answer to Q9 follow-up on transactional outbox

> "The outbox pattern works like this: instead of calling SQS directly from the service, you write a row to an `outbox_events` table inside the same database transaction as the business operation. An order is created AND the event record is inserted atomically.
>
> A separate process — a scheduled job or a database CDC listener — reads unpublished rows from the outbox, publishes them to SQS, and marks them as published. Because the outbox and the order are in the same transaction, you can never have an order created without an event being eventually published.
>
> The trade-off: at-least-once delivery — if the publisher crashes after publishing but before marking as published, the event is published again. The consumer must be idempotent. Which it already is in our design."

---

*Next: [8.4 — Vocabulary & Language Precision](./04-vocabulary-precision.md)*
