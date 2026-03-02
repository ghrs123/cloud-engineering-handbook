# Module 7 — Observability & Operability

> **Theme:** A service that works is not enough. A service you can understand when it's failing — in production, under load, at 2am — is what makes the difference between an incident resolved in 5 minutes and one that takes 4 hours.

---

## What This Module Builds — Milestone M7

By the end of this module, `order-api` and `order-worker` will be production-observable:

- Structured JSON logs with `correlationId` in every line — traceable end-to-end from HTTP request through SQS to worker
- Custom Micrometer metrics: `orders.created.total`, `orders.creation.duration`, `orders.processing.completed`
- `/actuator/prometheus` endpoint scraped automatically by Prometheus via Kubernetes pod annotations
- Readiness probe that checks SQS reachability (with 15s cache) and DB connectivity
- Runbook for the three most common production failure scenarios

---

## Prerequisites

- Module 6 complete: `order-api` and `order-worker` both running with resilience patterns
- Docker Compose stack up: PostgreSQL + LocalStack SQS + both services
- Kubernetes cluster running locally (kind or minikube) with both services deployed

---

## Chapters

| Chapter | Topic |
|---------|-------|
| [7.1 — The Three Pillars of Observability](./01-observability-pillars.md) | Logs, Metrics, Traces — what each solves, the correlationId contract |
| [7.2 — Custom Metrics with Micrometer](./02-custom-metrics-micrometer.md) | Counter, Timer, Gauge — cardinality rules, `order-api` + `order-worker` metrics |
| [7.3 — Prometheus & Actuator](./03-prometheus-actuator.md) | Exposing `/actuator/prometheus`, Kubernetes pod annotations, PromQL queries |
| [7.4 — Health & Readiness Probes](./04-health-readiness-probes.md) | Liveness vs readiness, `SqsHealthIndicator`, K8s probe configuration |
| [7.5 — Production Runbook & Milestone M7](./05-production-runbook.md) | Incident response structure, three common scenarios, M7 verification checklist |

---

## Key Concepts Introduced

| Concept | Chapter |
|---------|---------|
| Structured JSON logging with logstash-encoder | 7.1 |
| MDC and correlationId propagation HTTP → SQS → Worker | 7.1 |
| Micrometer `Counter`, `Timer`, `Gauge` | 7.2 |
| Tag cardinality | 7.2 |
| `/actuator/prometheus` endpoint | 7.3 |
| `kubernetes_sd_configs` pod annotation auto-discovery | 7.3 |
| PromQL alerting rules | 7.3 |
| `readinessState` vs `livenessState` health groups | 7.4 |
| Custom `HealthIndicator` with caching | 7.4 |
| `startupProbe` pattern | 7.4 |
| Four-phase incident response | 7.5 |
| DLQ replay procedure | 7.5 |

---

*Next: [Module 8 — Senior Communication & Interview Readiness →](../08-senior-communication/README.md)*
