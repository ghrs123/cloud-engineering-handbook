# Module 4 — AWS Essentials for Spring Boot

> **Theme:** The Cloud Layer. Your service runs in Kubernetes. Now it needs to talk to managed AWS infrastructure — a message queue that decouples your services, a managed database with automatic failover, and IAM policies that let your pods access AWS without embedding credentials. This module wires the `order-api` → SQS → `order-worker` pipeline and completes the async processing flow.

---

## What This Module Builds

By the end of this module you will have implemented **Milestone M4** of the capstone:

- `order-api` publishes `OrderCreatedEvent` to SQS after every successful order creation
- `order-worker` consumes events, transitions order through `PENDING → PROCESSING → COMPLETED`
- LocalStack runs locally simulating real AWS SQS and RDS
- IAM awareness: no AWS credentials in code — IRSA pattern documented
- Dead Letter Queue wired at the infrastructure level (redrive policy)
- `GET /orders/{id}` returns `COMPLETED` after the worker processes the event

---

## Chapters

| # | Title | What you learn |
|---|---|---|
| [4.1](./01-sqs-fundamentals.md) | SQS Fundamentals | Standard vs FIFO, visibility timeout, DLQ redrive, polling models |
| [4.2](./02-spring-boot-sqs.md) | Spring Boot + SQS Integration | `spring-cloud-aws`, publisher, consumer, message attributes |
| [4.3](./03-order-worker.md) | Building the `order-worker` | Full consumer implementation, step orchestration, status updates |
| [4.4](./04-rds-patterns.md) | RDS & Database Patterns | Multi-AZ vs read replicas, connection pooling, failover behavior |
| [4.5](./05-iam-irsa.md) | IAM & IRSA | Least privilege, IRSA for pod identity, never hardcode credentials |
| [4.6](./06-capstone-milestone.md) | Capstone Milestone M4 | End-to-end smoke test, verification checklist |

---

## Key Principle

> AWS services are not magic. They have failure modes, limits, and pricing implications. Knowing *when* to use a managed service, *what it guarantees*, and *what it doesn't* is what separates engineers who integrate AWS from engineers who depend on AWS.

---

*Start with [Chapter 4.1 — SQS Fundamentals →](./01-sqs-fundamentals.md)*
