# 8.1 — The Architecture Pitch

> **Capstone connection:** You've built the entire order processing platform. Now you need to explain it in 2 minutes to someone who will decide whether to hire you. This chapter prepares that explanation and trains the delivery.

---

## Why This Matters More Than You Think

Senior engineering interviews at international product companies have a pattern: *"Tell me about a complex backend system you designed or built."*

This is not a warm-up question. It is a technical communication assessment. The interviewer is evaluating:

- Can you identify what matters in a complex system without prompting?
- Do you communicate trade-offs proactively, or only when pushed?
- Do you understand *why* decisions were made, not just *what* was built?
- Is your English precise enough for async engineering communication?

A poorly delivered answer in the first 2 minutes signals all of the above before you've reached the technically complex questions.

---

## The Structure of a Good Architecture Explanation

A 2-minute architecture explanation has four parts:

```
1. ONE SENTENCE: What is the system and what problem does it solve?
2. THE FLOW: Walk the request path from client to storage
3. THREE DECISIONS: Call out the most consequential design choices
4. ONE TRADE-OFF: Proactively mention what you would do differently at 10x scale
```

This structure works because:
- It gives context before detail (engineers who skip to detail lose non-domain listeners)
- The request path is always easy to follow
- Proactively naming decisions demonstrates senior-level thinking
- Naming trade-offs shows you understand the system's limits — which is more impressive than pretending it's perfect

---

## The Script — Full Version (2 minutes)

Practice this out loud. Do not read it. Time yourself.

> "I designed a cloud-native order processing platform using two Spring Boot microservices running in Kubernetes.
>
> The first service, `order-api`, is a REST API that accepts order creation requests. When a client sends `POST /orders`, it validates the request, persists the order to PostgreSQL with a status of PENDING, publishes an `OrderCreatedEvent` to an SQS queue, and returns `202 Accepted` immediately. The client doesn't wait for processing to finish.
>
> The second service, `order-worker`, polls SQS using long polling. It receives the event, runs two processing steps — an inventory check and a payment authorization — and updates the order status to COMPLETED or FAILED.
>
> Three design decisions worth calling out. First, idempotency: `order-api` requires an `Idempotency-Key` header. If a client retries with the same key, they get the same order ID back — the order isn't created twice. This is implemented with a PostgreSQL table inside the same transaction as the order creation, so the check-and-insert is atomic.
>
> Second, resilience: the worker uses Resilience4j with exponential backoff and jitter for transient failures, and a circuit breaker around the payment step. After three SQS-level retries, permanently failing messages go to a Dead Letter Queue. We alert immediately on any DLQ depth above zero.
>
> Third, observability: every log line carries a `correlationId` that propagates from the HTTP request through SQS to the worker. A single grep reconstructs the full lifecycle of any order across both services.
>
> For deployment: both services run in Kubernetes with readiness and liveness probes, HPA based on CPU, and zero-downtime rolling updates. Infrastructure — SQS queues and RDS — is provisioned with Terraform with separate state per environment."

**Runtime:** approximately 100–120 seconds at a natural speaking pace.

---

## The Script — Short Version (90 seconds, phone screen)

When time is limited or the interviewer signals "just the overview":

> "I built a cloud-native order processing platform: two Spring Boot microservices. `order-api` accepts REST requests, persists to PostgreSQL, and publishes events to SQS asynchronously — returning 202 immediately. `order-worker` consumes events and processes orders with retry, circuit breaker, and DLQ handling.
>
> Key design decisions: idempotency via database-backed key deduplication, correlationId propagation end-to-end for tracing, and Terraform-managed infrastructure. Both services run on Kubernetes with HPA and zero-downtime rolling updates."

---

## Adjusting for the Interviewer

Different interviewers probe different areas. After your opening, listen for what they pick up:

| Interviewer picks up... | They want to know about... |
|------------------------|---------------------------|
| "Tell me more about the SQS integration" | Messaging patterns, at-least-once delivery, DLQ |
| "How does the idempotency work technically?" | Database transactions, race conditions |
| "How would this scale?" | HPA, PgBouncer, KEDA, read replicas |
| "What about observability?" | Metrics, logs, correlationId, alerting |
| "How would you handle a production incident?" | Runbook, correlationId grep, DLQ replay |

The architecture pitch is the entry point. Have depth ready for every branch.

---

## Common Mistakes

**Starting with technologies, not the problem:**

❌ "We used Spring Boot 3 with PostgreSQL and SQS and deployed to Kubernetes with Terraform..."
✅ "I designed an order processing platform..." — what does it do, then how is it built

**Not mentioning trade-offs:**

❌ Describing only what the system does correctly
✅ "The trade-off with the async model is that the client doesn't know immediately if processing succeeded — they need to poll or use webhooks for completion notification. That's acceptable for order processing but wouldn't be for a payment confirmation."

**Over-explaining implementation details:**

❌ Spending 30 seconds on Hibernate entity mapping
✅ Stay at architecture level; go deep only when the interviewer asks

**Reading or reciting from memory without naturalness:**

❌ Mechanical delivery that sounds like documentation
✅ Practice until you can deliver it conversationally — vary pacing, pause after key decisions

---

## Exercise 8.1

1. Deliver the full 2-minute script out loud without reading it. Time yourself.
2. Record yourself on your phone. Play it back.
3. Answer the following self-assessment questions:
   - Did it take between 90 and 130 seconds?
   - Did you mention all three key decisions (idempotency, resilience, observability)?
   - Did you mention at least one trade-off?
   - Was the delivery natural, or did it sound like you were reading?
4. Repeat until all four answers are yes.

**Checkpoint questions (answer without notes):**
- What status does `POST /orders` return and why?
- What does the idempotency check prevent?
- What happens to messages that fail after three retries?
- What does `correlationId` allow you to do?

### Answer

There is no code answer for this exercise. The deliverable is a timed, recorded delivery that passes the four self-assessment checks.

If you cannot answer the four checkpoint questions without notes, go back to the relevant modules:
- Status 202 and async model: Module 1 capstone milestone
- Idempotency: Module 1.2 (DTO/Entity), Module 4 (SQS integration)
- DLQ: Module 6.3 (resilience patterns)
- correlationId: Module 1.4 (logging strategy) and Module 7.1 (observability pillars)

---

## Interview Mode

There is no separate Interview Mode for this chapter — this entire chapter is interview preparation.

The pitch itself is the exercise. Fluency requires repetition. Record. Review. Repeat.

---

*Next: [8.2 — Defending Trade-offs](./02-defending-tradeoffs.md)*
