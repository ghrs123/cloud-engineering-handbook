# Module 1 — Engineering for Production

> **Theme:** The foundation. Before containers, before Kubernetes, before any cloud integration — you need a service that is worth deploying. This module builds the `order-api` base: properly layered, properly logged, properly instrumented.

---

## What This Module Builds

By the end of this module you will have implemented **Milestone M1** of the capstone:

- A runnable `order-api` Spring Boot service with `POST /orders` and `GET /orders/{id}`
- Clean architecture: controller → service → repository, with no layer leaking into another
- A global exception handler that returns consistent error responses
- Structured logging with `correlationId` in MDC from the first request
- Spring Actuator with `health`, `readiness`, and `liveness` endpoints
- OpenAPI documentation via springdoc

This is the service all subsequent modules will containerize, deploy, and instrument.

---

## Chapters

| # | Title | What you learn |
|---|---|---|
| [1.1](./01-clean-architecture.md) | Clean Architecture in Spring Boot | Layers, dependency rules, why they matter in production |
| [1.2](./02-dto-entity-separation.md) | DTO vs Entity Separation | Why leaking your JPA entity into the API layer causes real bugs |
| [1.3](./03-exception-strategy.md) | Exception Handling Strategy | Global handler, error response contract, validation errors |
| [1.4](./04-logging-strategy.md) | Logging Strategy | Structured logs, MDC, correlationId filter, what to log and what not to |
| [1.5](./05-actuator-health.md) | Spring Actuator & Health Endpoints | Readiness vs liveness, custom health indicators, what Kubernetes needs |
| [1.6](./06-capstone-milestone.md) | Capstone Milestone M1 | Full implementation checklist, pom.xml, project structure |

---

## Prerequisites for This Module

- Java 17+ and Spring Boot 3.x basics (you know how to create a `@RestController`)
- Basic JPA/Hibernate (you know what `@Entity` and `@Repository` are)
- Maven or Gradle builds

---

## What You Don't Need Yet

- Docker (Module 2)
- Kubernetes (Module 3)
- SQS or any AWS service (Module 4)
- Resilience4j (Module 6)

---

## Key Principle

> A service that is not observable is not production-ready, regardless of how well the business logic works.

Logging, health endpoints, and error contracts are not "nice to haves." They are the minimum viable surface area that an on-call engineer needs to debug your service at 2am.

---

*Start with [Chapter 1.1 — Clean Architecture →](./01-clean-architecture.md)*
