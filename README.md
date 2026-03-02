# Cloud-Native Engineering with Spring Boot

> **A production-grade curriculum for Java backend engineers transitioning to senior roles in international product companies.**

---

## What This Is — And What It Is Not

This is **not** a generic system design interview guide.  
This is **not** a Spring Boot tutorial for beginners.

This is a curriculum for engineers who already build Spring Boot services and want to answer the question that actually gets people hired at senior level:

> *"Can you take a service from working locally to running reliably in production at scale?"*

Every module feeds directly into a single **Capstone Project**: a cloud-native order processing platform built with Spring Boot, SQS, PostgreSQL, Docker, Kubernetes, Terraform, and full observability.

---

## Prerequisites

You should already be comfortable with:

- Java 17+ and Spring Boot (REST, JPA, validation basics)
- Maven or Gradle builds
- Basic SQL and PostgreSQL
- Git and GitHub/GitLab workflows

You do **not** need prior experience with Kubernetes, AWS, Terraform, or Docker — those are exactly what this course builds.

---

## Learning Outcomes

By the end of this course, you will be able to:

1. Build a production-ready Spring Boot service with proper error handling, logging, and health endpoints
2. Containerize a Java application correctly (multi-stage builds, JVM memory awareness, graceful shutdown)
3. Deploy to Kubernetes with rolling updates, HPA, ConfigMaps, and Secrets
4. Integrate AWS SQS for async processing with retry, backoff, and DLQ
5. Provision cloud infrastructure with Terraform (state, environments, modules)
6. Implement Resilience4j patterns: circuit breaker, retry, rate limiting, bulkhead
7. Instrument services with structured logging, correlation IDs, and Actuator metrics
8. Explain architectural decisions and trade-offs in English in a technical interview

---

## How to Use This Course

**Option A — Follow the modules sequentially.**  
Each module ends with a *Capstone Milestone* — a concrete deliverable you add to the project. By Module 8, the entire system is built.

**Option B — Use as a reference.**  
If you already know containers but not Kubernetes, go directly to Module 3. The chapters are self-contained enough for targeted study.

**Recommendation:** Do Option A at least once. The order is intentional. Module 2 (Containers) depends on Module 1 (knowing what to put in the container). Module 6 (Resilience) depends on Module 4 (understanding why queues need retries).

---

## Capstone Project Overview

### Cloud-Native Order Processing Platform

A production-grade system composed of two Spring Boot microservices coordinated via a message queue.

```
Client → order-api → PostgreSQL
                   → SQS → order-worker → PostgreSQL
```

| Service | Responsibility |
|---|---|
| `order-api` | Accepts REST requests, persists orders, publishes events |
| `order-worker` | Consumes events, processes order steps, updates status |

**Key capabilities you will implement:**
- `POST /orders` returns `202 Accepted` with `orderId`
- Idempotency via `Idempotency-Key` header (no duplicate orders)
- `correlationId` propagated from HTTP request → queue message → worker logs
- Retry with exponential backoff for transient failures
- Dead Letter Queue for permanent failures
- Spring Actuator health and readiness probes
- Multi-stage Docker builds
- Kubernetes manifests: Deployment, Service, ConfigMap, Secret, HPA
- Terraform to provision SQS + RDS + outputs (LocalStack for local dev)

**Full capstone documentation → [`/capstone/`](./capstone/)**

---

## Module Overview

| # | Module | Capstone Milestone |
|---|---|---|
| 1 | [Engineering for Production](./modules/01-engineering-for-production/) | Base `order-api` with proper layering, logging, exception handling |
| 2 | [Containers & Runtime](./modules/02-containers-runtime/) | Production Docker image, docker-compose with postgres + localstack |
| 3 | [Kubernetes/OpenShift for Backend Engineers](./modules/03-kubernetes-openshift/) | K8s manifests, rolling deploy, HPA on local cluster |
| 4 | [AWS Essentials for Spring Boot](./modules/04-aws-essentials/) | SQS integration, `order-worker` consuming events |
| 5 | [Infrastructure as Code with Terraform](./modules/05-terraform-iac/) | Terraform provisions SQS + RDS, env separation |
| 6 | [Resilience Patterns in Spring](./modules/06-resilience-patterns/) | Retry + circuit breaker + DLQ wired into `order-worker` |
| 7 | [Observability & Operability](./modules/07-observability/) | Structured logs, correlationId, Actuator readiness probes |
| 8 | [Senior Communication & Interview Readiness](./modules/08-senior-communication/) | Architecture defense simulation, trade-off explanations |

---

## Repository Structure

```
cloud-native-handbook/
├── README.md                          ← You are here
├── docs/
│   ├── architecture/
│   │   ├── context.md                 ← System context diagram
│   │   ├── sequence.md                ← Request flow diagrams
│   │   └── decisions.md               ← Key architectural decisions (index)
│   ├── decisions/
│   │   ├── adr-0001-queue-choice.md   ← Why SQS over Kafka
│   │   ├── adr-0002-idempotency.md    ← How idempotency is implemented
│   │   └── adr-0003-correlation.md    ← correlationId propagation strategy
│   └── interview-notes/
│       └── architecture-defense.md    ← Scripts for defending the capstone design
├── modules/
│   ├── 01-engineering-for-production/
│   ├── 02-containers-runtime/
│   ├── 03-kubernetes-openshift/
│   ├── 04-aws-essentials/
│   ├── 05-terraform-iac/
│   ├── 06-resilience-patterns/
│   ├── 07-observability/
│   └── 08-senior-communication/
├── capstone/
│   ├── README.md                      ← Full capstone spec
│   ├── ACCEPTANCE_CRITERIA.md         ← Checklist for completion
│   ├── docker/
│   │   └── docker-compose.yml
│   ├── k8s/
│   │   ├── order-api/
│   │   └── order-worker/
│   └── terraform/
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       └── envs/
│           ├── dev/
│           └── prod/
├── services/
│   ├── order-api/                     ← Spring Boot project (added module by module)
│   └── order-worker/                  ← Spring Boot project (added module by module)
├── libs/
│   ├── common-observability/          ← Shared logging/tracing utilities
│   └── common-messaging/              ← Shared SQS event types
└── appendix/
    ├── glossary.md
    ├── troubleshooting.md
    └── interview-qa.md
```

---

## Tech Stack Reference

| Layer | Technology | Version |
|---|---|---|
| Language | Java | 21 |
| Framework | Spring Boot | 3.3.x |
| Database | PostgreSQL | 16 |
| Queue | AWS SQS via LocalStack | latest |
| Containers | Docker | 26+ |
| Orchestration | Kubernetes / OpenShift | 1.28+ |
| IaC | Terraform | 1.7+ |
| Resilience | Resilience4j | 2.x |
| Observability | Spring Actuator + Micrometer | built-in |
| API Docs | springdoc-openapi | 2.x |
| Build | Maven | 3.9+ |
| CI | GitHub Actions | — |

---

## Conventions Used in This Course

**Code snippets** use Java 21 syntax (records, text blocks, pattern matching where relevant).

**"What you need to know" vs "What you don't need to know"** markers appear throughout to prevent scope creep. Senior engineering is as much about knowing what to skip as knowing what to implement.

**Interview Mode** sections at the end of each chapter give you a 60–120 second English script for explaining the concept in a technical interview.

**Capstone Milestones** at the end of each module are concrete deliverables — not optional exercises.

---

*Start with [Module 1 →](./modules/01-engineering-for-production/README.md)*
