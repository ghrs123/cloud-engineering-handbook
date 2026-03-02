# Module 8 — Senior Communication & Interview Readiness

> **Theme:** Technical competence is necessary but not sufficient for senior roles at international product companies. You must communicate architecture clearly, defend trade-offs under pressure, handle gaps honestly, and do all of this in English. This module prepares you for the system design interview and for the technical conversations that happen after you're hired.

---

## What This Module Delivers — Milestone M8

- 2-minute architecture explanation of the complete capstone system
- Written answers to the 12 most common questions about this architecture
- A framework for answering questions when you don't know the answer
- English vocabulary for common technical concepts
- A structured self-assessment against the senior-level bar

---

## 8.1 — The Architecture Explanation (2 Minutes)

This is your answer to: *"Tell me about a backend system you built or designed."*

You should be able to deliver this from memory. Practice it out loud.

---

### The Script

> "I designed a cloud-native order processing platform using two Spring Boot microservices. The first, `order-api`, is a REST service that accepts order creation requests. The second, `order-worker`, is an asynchronous consumer that processes orders in the background.
>
> When a client sends `POST /orders`, `order-api` validates the request, persists the order to PostgreSQL with a status of PENDING, publishes an `OrderCreatedEvent` to an SQS queue, and returns 202 Accepted immediately. The client doesn't wait for processing to complete.
>
> `order-worker` polls SQS using long polling, receives the event, and runs two processing steps: inventory check and payment authorization. On success, it marks the order COMPLETED. On failure, it marks it FAILED.
>
> A few design decisions worth mentioning. First, idempotency: `order-api` uses an `Idempotency-Key` header. If a client retries with the same key, they get the same order ID back — the order is not created twice. This is stored in a PostgreSQL table with the key and the cached response.
>
> Second, resilience: `order-worker` uses Resilience4j with exponential backoff and jitter for transient failures, and a circuit breaker around the payment step. After three SQS-level retries, permanently failing messages go to a Dead Letter Queue. We alert immediately on any DLQ depth above zero.
>
> Third, observability: every log line carries a `correlationId` that propagates from the HTTP request through SQS to the worker. A single grep reconstructs the full lifecycle of any order across both services.
>
> For deployment: both services run in Kubernetes with readiness and liveness probes, horizontal pod autoscaling based on CPU, and zero-downtime rolling updates. Infrastructure — the SQS queues and RDS instance — is provisioned with Terraform with separate state per environment."

**Runtime:** approximately 2 minutes at a natural pace. Adjust based on the context — in a phone screen, 90 seconds. In a design interview, expand on whichever component the interviewer probes.

---

## 8.2 — The 12 Questions You Will Be Asked

Each answer below is structured as what a senior engineer would say. Not a textbook definition — a practitioner's answer with trade-offs acknowledged.

---

### Q1: *"Why did you choose SQS over Kafka?"*

> "For this use case, SQS was the right trade-off. The queue volume is moderate — hundreds to low thousands of messages per second — and we don't need message replay or multiple consumer groups with independent offsets. SQS gives us zero operational overhead: no cluster to provision or monitor, DLQ configuration in three lines of Terraform, and LocalStack for local development with a single Docker image.
>
> Kafka would be the right answer if we needed to replay events — for example, to rebuild a read model after a schema change — or if we had multiple services that needed to independently consume the same events at different speeds. The throughput advantage of Kafka matters above roughly 100,000 messages per second, which we're nowhere near. The operational complexity of Kafka — partition management, offset tracking, consumer group coordination — would be a real cost for the team size involved."

---

### Q2: *"How does your idempotency implementation work?"*

> "The client sends an `Idempotency-Key` header — a UUID they generate. On the server, before processing the request, I check a PostgreSQL table for that key. If it exists, I return the stored response directly. If it doesn't, I run the operation inside a transaction that atomically inserts the order and the idempotency record, then cache the response.
>
> The important detail is that the check-and-insert is inside the same database transaction as the order creation. Without that, two concurrent requests with the same key could both check, both find nothing, and both proceed to create duplicate orders — a race condition. The transaction serializes this.
>
> For cleanup: idempotency records have a TTL. A scheduled job or Flyway cleanup migration removes records older than 24 hours. You don't need to store idempotency data forever — it's only relevant during the client's retry window."

---

### Q3: *"What happens if order-worker crashes while processing an order?"*

> "SQS handles this via the visibility timeout. When the worker receives a message, SQS makes it invisible for 30 seconds. If the worker crashes before deleting it, the timeout expires and the message becomes visible again. Another worker — or the restarted worker — picks it up and retries.
>
> The worker handles duplicate delivery with an idempotency check at the start: it reads the current order status. If it's already PROCESSING or COMPLETED from a previous attempt, it skips. If it's still PENDING, it proceeds normally.
>
> After three SQS-level retries — three separate receive-then-crash cycles — the message goes to the DLQ. We alert on DLQ depth and investigate manually."

---

### Q4: *"How would you scale this system 10x?"*

> "Let me think about where the bottlenecks are.
>
> For `order-api`: the HPA scales horizontally on CPU. The main constraint at 10x is database connections. Each pod holds a HikariCP pool of 10 connections; with 20 pods that's 200 connections, which exceeds RDS's default limit of 100 for a small instance. The solution is PgBouncer — a connection pooler that multiplexes hundreds of application connections onto a small number of real DB connections. In AWS, RDS Proxy is the managed version of this.
>
> For `order-worker`: more consumers means more parallel processing. The HPA on CPU handles this to a point. For queue-depth-based scaling, I'd replace CPU-based HPA with KEDA using an SQS scaler — it scales worker replicas directly proportional to the number of messages in the queue.
>
> For the database at 10x write volume: read replicas for status queries, and potentially partitioning the `orders` table by `created_at` if the table grows very large. Multi-AZ stays in place for HA.
>
> For SQS: Standard queues handle nearly unlimited throughput — SQS itself doesn't bottleneck here."

---

### Q5: *"What's the difference between readiness and liveness probes?"*

> "They answer different questions and have different failure consequences.
>
> Readiness asks: is this pod ready to receive traffic right now? If it fails, Kubernetes removes the pod from the Service's endpoint list — no new traffic is routed to it. But the pod continues running. This is the right behavior when the pod is temporarily unable to serve: DB is slow, queue is unreachable, warming up.
>
> Liveness asks: is the JVM alive? If it fails repeatedly, Kubernetes kills and restarts the container. This is for detecting a truly stuck or hung process.
>
> The critical mistake is putting DB checks in the liveness probe. If the database goes down, liveness fails, Kubernetes restarts all your pods — now you have a restart storm during a DB outage, the worst possible time. Liveness should only check that the JVM is responding. DB and queue checks belong in readiness."

---

### Q6: *"How do you handle database migrations in production?"*

> "With Flyway. Migrations are versioned SQL files — `V1__create_orders.sql`, `V2__add_index.sql` — that run in sequence. Flyway records which migrations have been applied in `flyway_schema_history` and only runs new ones.
>
> Spring Boot runs Flyway on startup before accepting traffic. In a Kubernetes rolling update, the new pod runs migrations first. If a migration fails, the pod doesn't start and the rollout stops — existing pods continue serving traffic on the old schema. No downtime.
>
> The constraint that makes this work: migrations must be backward-compatible with the running version. You can't remove a column that the current production code reads, even if the new code doesn't use it. The pattern is: first deployment adds the new column; second deployment removes the old column after the first is fully rolled out. Two deployments, not one."

---

### Q7: *"Explain the circuit breaker pattern."*

> "A circuit breaker monitors failure rates for a downstream dependency. In the Closed state, calls pass through normally. When failures exceed a threshold — say 50% of the last 10 calls — it transitions to Open. In the Open state, calls are rejected immediately without attempting the downstream. After a wait duration, it transitions to Half-Open and allows a small number of probe calls. If those succeed, it closes. If they fail, it reopens.
>
> The value is twofold. First, it fails fast: rather than holding threads waiting for a service that's down, it returns an error immediately, freeing resources for other work. Second, it gives the downstream service time to recover without being overwhelmed by retry traffic from all your instances simultaneously.
>
> In practice I pair it with retry: the circuit breaker is the outer layer. If it's open, no retries are attempted — fail fast. If it's closed and a call fails, the retry layer handles the transient case. This keeps the retry behavior from defeating the circuit breaker's purpose."

---

### Q8: *"Why do you use structured JSON logging?"*

> "Two reasons: queryability and context propagation.
>
> Log aggregation systems — CloudWatch Logs Insights, ELK, Loki — can filter and aggregate on structured fields. If every log line is a JSON object with `orderId`, `correlationId`, `level`, and `service`, I can write: 'show me all ERROR logs for orderId X' or 'show me the P99 time between order creation and completion by extracting timestamps'. With plain text, I'm parsing with regex, which is fragile.
>
> Context propagation: the `correlationId` in MDC means every log line in a request's thread automatically carries the same ID, from the servlet filter all the way through to the SQS publish. When the worker processes the message, it restores the correlationId from the message attribute to its MDC. One ID, one grep, full picture."

---

### Q9: *"What would you change if this needed to be 99.99% available?"*

> "99.99% is 52 minutes of downtime per year. That changes several things.
>
> First, multi-region active-active or active-passive. Currently everything is in one AWS region. A regional failure — rare but not hypothetical — takes the system down. Active-passive with Route 53 failover to a secondary region gets close to 99.99%. Active-active with DynamoDB global tables or Aurora Global Database is more complex but enables zero-RPO.
>
> Second, the transactional outbox pattern. Currently, if the service crashes between saving the order to PostgreSQL and publishing to SQS, the event is lost and the order stays PENDING forever. With the outbox pattern, the event is written atomically in the same transaction as the order. A separate process reads the outbox and publishes, with at-least-once guarantee.
>
> Third, end-to-end idempotency testing. At 99.99%, the retry and deduplication paths must be tested, not assumed. Contract tests, chaos engineering with Chaos Monkey or AWS Fault Injection Simulator.
>
> Fourth, the DLQ alert threshold drops from 0 to triggering a PagerDuty page, not just a Slack notification."

---

### Q10: *"How do you keep credentials out of your code?"*

> "Three-layer approach.
>
> In Kubernetes: IRSA for AWS access. Pods have a ServiceAccount annotated with an IAM Role ARN. The EKS pod identity webhook injects temporary, auto-rotating credentials via a web identity token. No `AWS_ACCESS_KEY_ID` anywhere in the pod, the image, or Kubernetes Secrets.
>
> For other secrets — DB passwords, API keys: the External Secrets Operator syncs them from AWS Secrets Manager into Kubernetes Secrets. The Deployment reads from `secretKeyRef` as normal. The source of truth is Secrets Manager, which supports rotation and audit logging.
>
> Nothing sensitive ever touches Git. `.gitignore` includes all `.tfstate` files and `.env` files. CI injects secrets via environment variables sourced from the secret manager at runtime, not stored in the pipeline configuration."

---

### Q11: *"What's in your Dockerfile and why?"*

> "Multi-stage build with three stages.
>
> Stage one: dependency layer. I copy only `pom.xml` and run `mvn dependency:go-offline`. This creates a Docker layer cached as long as dependencies don't change. Stage two: build. Copy source, compile, and extract the Spring Boot layered JAR into four subdirectories ordered by change frequency. Stage three: runtime. JRE-only Alpine image — no JDK, no compiler, no source code. I copy the four extracted layers in dependency-first order so unchanged layers hit the Docker cache.
>
> Final image is around 230MB instead of 750MB with a naive approach. On a typical code change, only the `application/` layer — maybe 2–3MB — needs to be pushed to the registry.
>
> Security: non-root user via `adduser`, `runAsNonRoot: true` in the Kubernetes SecurityContext. JVM flags: `UseContainerSupport` and `MaxRAMPercentage=75.0` so the heap scales with the container memory limit rather than reading the node's total RAM."

---

### Q12: *"How do you approach a production incident for this system?"*

> "I follow a four-phase approach.
>
> First, triage. What's the user-visible impact? Orders failing to create, processing delays, or total outage? I check Grafana dashboards: order creation rate, DLQ depth, error rate, circuit breaker state. This tells me which component is involved within 2 minutes.
>
> Second, stabilise. If processing is stuck, is it the circuit breaker? I check metrics for `resilience4j_circuitbreaker_state`. If the DB is overloaded, I check HikariCP connection count and RDS CPU. The goal is to stop the bleeding before root cause analysis.
>
> Third, trace. I find a failed order's `correlationId` — from the error log, from the DLQ message attribute, or from a customer report. I grep all logs for that ID and reconstruct the exact sequence of events across both services.
>
> Fourth, fix and validate. For a code bug: fix, deploy, replay DLQ messages. For infrastructure: Terraform apply or console action, verify metrics recover. Run the smoke test script to confirm end-to-end flow is healthy before declaring the incident resolved."

---

## 8.3 — Handling Questions You Don't Know

**The wrong answer:** guess confidently and be wrong. Interviewers at senior level probe assumptions and catch guesses.

**The right approach:**

```
"I haven't worked with [X] directly, but I can reason about it.
Based on how [related concept] works, I would expect [Y] because [Z].
To verify, I would [look at docs / run a test / ask the team]."
```

Example:
> *Interviewer: "How does Aurora's write forwarding work for read replicas?"*
>
> "I haven't used Aurora's write forwarding specifically. My experience is with standard RDS Multi-AZ and read replicas. My understanding is that Aurora replicas share the same storage layer, which is different from standard RDS where replication is at the WAL level. I'd expect write forwarding to route writes from a replica to the primary transparently, but I'm not certain about the latency characteristics. I'd check the Aurora docs before committing to this in a design."

This answer shows reasoning ability, intellectual honesty, and a pattern of verifying before deciding. All of these are what senior engineers actually do.

---

## 8.4 — English Technical Vocabulary Reference

Phrases for common situations:

| Situation | Phrase |
|---|---|
| Acknowledging a trade-off | "The upside is X, the trade-off is Y" |
| Proposing an alternative | "Another approach would be... the reason I chose X over Y is..." |
| Expressing uncertainty | "I'm not certain about the exact behavior here, but my understanding is..." |
| Defending a decision | "We chose X because at our scale, Y wasn't a bottleneck. If traffic grew 10x, I'd revisit." |
| Asking a clarifying question | "Before I go further — what's the expected read/write ratio?" |
| Describing failure behavior | "When X fails, the system degrades to Y rather than failing completely" |
| Describing latency | "The P99 latency is around 200ms under normal load" |
| Describing scale | "We're processing roughly 500 orders per minute at peak" |

**False friends (Portuguese → English):**

| Don't say | Say instead |
|---|---|
| "It makes a call to the database" | "It queries the database" |
| "We persist the data in the bank" | "We persist the data in the database" |
| "The method makes a return" | "The method returns" |
| "I will explain the flow" | "Let me walk you through the flow" |

---

## 8.5 — Senior-Level Self-Assessment

Rate yourself honestly on each dimension before applying for senior roles at international product companies.

### Technical Depth

- [ ] I can explain the entire capstone architecture from memory in 2 minutes
- [ ] I can describe the failure behavior of every component (SQS, RDS, K8s)
- [ ] I can answer all 12 questions above without reading the answers
- [ ] I can explain the trade-off of every major decision (SQS vs Kafka, `ON_SUCCESS` vs `MANUAL`, `maxUnavailable: 0` vs `1`)

### Operational Maturity

- [ ] I have run the end-to-end smoke test and seen it pass
- [ ] I have triggered CrashLoopBackOff and debugged it with `kubectl`
- [ ] I have seen the circuit breaker open in logs
- [ ] I have seen a message go to the DLQ and replayed it
- [ ] I have run `terraform plan` and reviewed the output before applying

### Communication

- [ ] I have delivered the 2-minute architecture explanation out loud (not just read it)
- [ ] I can answer the 12 questions in English without switching to Portuguese
- [ ] I can handle "why not X?" questions for each major decision
- [ ] I have practiced saying "I'm not certain, but my reasoning is..." in a mock interview

### The Gap Between Pleno and Senior

The technical gap is smaller than people think. Most pleno engineers have the knowledge. What separates pleno from senior in international companies:

**Senior engineers communicate trade-offs proactively.** They don't wait to be asked "what's the downside?" They say it first.

**Senior engineers own the operational story.** "This will work in dev" is not enough. "Here's how we monitor it, here's how we debug it, here's what we do when it fails at 2am."

**Senior engineers know what to simplify.** The answer to "how would you build X?" from a senior engineer often starts with "what's the constraint?" rather than jumping to the most sophisticated solution.

---

## 8.6 — Final Capstone Acceptance Test

Before considering the capstone complete, every item below must pass:

```bash
#!/bin/bash
echo "=== FINAL ACCEPTANCE TEST ==="

# M1: API and persistence
curl -sf -o /dev/null -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "X-API-Key: dev-secret-key" \
  -d '{"customerId":"test","items":[{"sku":"A","qty":1}],"totalAmount":10.00}' \
  && echo "PASS: POST /orders" || echo "FAIL: POST /orders"

# M2: Docker image builds and health
docker build -q -t order-api:test ./services/order-api \
  && echo "PASS: Docker build" || echo "FAIL: Docker build"

# M3: K8s readiness
kubectl get pods -n order-platform -l app=order-api \
  -o jsonpath='{.items[0].status.containerStatuses[0].ready}' | grep -q true \
  && echo "PASS: K8s pod ready" || echo "FAIL: K8s pod not ready"

# M4: End-to-end processing
IKEY=$(uuidgen)
OID=$(curl -s -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IKEY" \
  -H "X-API-Key: dev-secret-key" \
  -d '{"customerId":"test","items":[{"sku":"A","qty":1}],"totalAmount":10.00}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['orderId'])")
sleep 5
STATUS=$(curl -s http://localhost:8080/orders/$OID \
  -H "X-API-Key: dev-secret-key" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
[ "$STATUS" = "COMPLETED" ] \
  && echo "PASS: End-to-end processing ($STATUS)" || echo "FAIL: Status=$STATUS"

# M5: Terraform outputs
cd capstone/terraform && terraform output order_queue_url &>/dev/null \
  && echo "PASS: Terraform outputs" || echo "FAIL: Terraform not applied"
cd ../..

# M6: Resilience config present
grep -q "resilience4j" services/order-worker/src/main/resources/application.yml \
  && echo "PASS: Resilience config" || echo "FAIL: Missing resilience config"

# M7: Prometheus metrics
curl -sf http://localhost:8081/actuator/prometheus | grep -q "orders_created_total" \
  && echo "PASS: Custom metrics" || echo "FAIL: Missing custom metrics"

# M8: Can explain architecture — manual check
echo ""
echo "MANUAL: Deliver the 2-minute architecture explanation now."
echo "Record yourself. Play it back. Time it."
echo "If it takes < 90s or > 150s, practice more."
```

---

*Course complete.*

*You have built a cloud-native order processing platform — from a layered Spring Boot service to a Kubernetes-deployed, AWS-integrated, resilience-hardened, fully observable system. Every module contributed to this result. Every chapter connects to production reality.*

*The capstone is not the end. It is the foundation for the next conversation.*
