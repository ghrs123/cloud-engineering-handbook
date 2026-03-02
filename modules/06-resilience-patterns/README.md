# Module 6 — Resilience Patterns in Spring

> **Theme:** Production systems fail. Networks time out. Databases get overloaded. Downstream services become unavailable. The difference between a fragile system and a resilient one is not whether failures happen — it is how the system behaves when they do. This module adds Resilience4j to `order-worker` and makes failure handling explicit, configurable, and observable.

---

## What This Module Builds

By the end of this module you will have implemented **Milestone M6**:

- Resilience4j `@Retry` with exponential backoff replaces manual retry logic
- `@CircuitBreaker` opens when downstream steps fail repeatedly
- `@TimeLimiter` prevents processing steps from hanging indefinitely
- All resilience configuration externalised to `application.yml`
- Retry and circuit breaker events visible in logs and metrics

---

## Chapters

| # | Title | What you learn |
|---|---|---|
| [6.1](./01-retry-backoff.md) | Retry with Exponential Backoff | Resilience4j `@Retry`, backoff configuration, jitter, max attempts |
| [6.2](./02-circuit-breaker.md) | Circuit Breaker | States (Closed/Open/Half-Open), failure threshold, recovery, fallback |
| [6.3](./03-timeout-bulkhead.md) | Timeout & Bulkhead | `@TimeLimiter`, bulkhead thread pool isolation |
| [6.4](./04-dlq-patterns.md) | DLQ Patterns | When to DLQ vs retry, replayability, alerting on DLQ depth |
| [6.5](./05-capstone-milestone.md) | Capstone Milestone M6 | Full resilience wiring, configuration, verification |

---

## Key Principle

> Resilience patterns are not a safety net for bad code. They are a production contract: "this service degrades gracefully under failure rather than cascading failures to its callers."

---

*Start with [Chapter 6.1 →](./01-retry-backoff.md)*
