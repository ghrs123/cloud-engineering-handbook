# Course Index — Cloud-Native Engineering with Spring Boot

Complete navigation map for all 8 modules.

---

## Modules

### [Module 1 — Engineering for Production](./modules/01-engineering-for-production/README.md)
| Chapter | File |
|---|---|
| 1.1 Clean Architecture in Spring Boot | [01-clean-architecture.md](./modules/01-engineering-for-production/01-clean-architecture.md) |
| 1.2 DTO vs Entity Separation | [02-dto-entity-separation.md](./modules/01-engineering-for-production/02-dto-entity-separation.md) |
| 1.3 Exception Handling Strategy | [03-exception-strategy.md](./modules/01-engineering-for-production/03-exception-strategy.md) |
| 1.4 Logging Strategy | [04-logging-strategy.md](./modules/01-engineering-for-production/04-logging-strategy.md) |
| 1.5 Spring Actuator & Health Endpoints | [05-actuator-health.md](./modules/01-engineering-for-production/05-actuator-health.md) |
| 1.6 Capstone Milestone M1 | [06-capstone-milestone.md](./modules/01-engineering-for-production/06-capstone-milestone.md) |

### [Module 2 — Containers & Runtime](./modules/02-containers-runtime/README.md)
| Chapter | File |
|---|---|
| 2.1 Multi-Stage Dockerfile | [01-dockerfile-multistage.md](./modules/02-containers-runtime/01-dockerfile-multistage.md) |
| 2.2 JVM in Containers | [02-jvm-in-containers.md](./modules/02-containers-runtime/02-jvm-in-containers.md) |
| 2.3 Graceful Shutdown | [03-graceful-shutdown.md](./modules/02-containers-runtime/03-graceful-shutdown.md) |
| 2.4 Health Probes in Docker | [04-health-probes-docker.md](./modules/02-containers-runtime/04-health-probes-docker.md) |
| 2.5 Docker Compose for Local Dev | [05-docker-compose.md](./modules/02-containers-runtime/05-docker-compose.md) |

### [Module 3 — Kubernetes/OpenShift for Backend Engineers](./modules/03-kubernetes-openshift/README.md)
| Chapter | File |
|---|---|
| 3.1 Cluster Anatomy | [01-cluster-anatomy.md](./modules/03-kubernetes-openshift/01-cluster-anatomy.md) |
| 3.2 Deployments & Services | [02-deployments-services.md](./modules/03-kubernetes-openshift/02-deployments-services.md) |
| 3.3 ConfigMaps & Secrets | [03-config-secrets.md](./modules/03-kubernetes-openshift/03-config-secrets.md) |
| 3.4 Scaling & HPA | [04-scaling-hpa.md](./modules/03-kubernetes-openshift/04-scaling-hpa.md) |
| 3.5 Debugging with kubectl | [05-debugging-kubectl.md](./modules/03-kubernetes-openshift/05-debugging-kubectl.md) |
| 3.6 Capstone Milestone M3 | [06-capstone-milestone.md](./modules/03-kubernetes-openshift/06-capstone-milestone.md) |

### [Module 4 — AWS Essentials for Spring Boot](./modules/04-aws-essentials/README.md)
| Chapter | File |
|---|---|
| 4.1 SQS Fundamentals | [01-sqs-fundamentals.md](./modules/04-aws-essentials/01-sqs-fundamentals.md) |
| 4.2 Spring Boot + SQS Integration | [02-spring-boot-sqs.md](./modules/04-aws-essentials/02-spring-boot-sqs.md) |
| 4.3 Building the order-worker | [03-order-worker.md](./modules/04-aws-essentials/03-order-worker.md) |
| 4.4 RDS & Database Patterns | [04-rds-patterns.md](./modules/04-aws-essentials/04-rds-patterns.md) |
| 4.5 IAM & IRSA | [05-iam-irsa.md](./modules/04-aws-essentials/05-iam-irsa.md) |
| 4.6 Capstone Milestone M4 | [06-capstone-milestone.md](./modules/04-aws-essentials/06-capstone-milestone.md) |

### [Module 5 — Infrastructure as Code with Terraform](./modules/05-terraform-iac/README.md)
| Chapter | File |
|---|---|
| 5.1 Core Concepts | [01-terraform-concepts.md](./modules/05-terraform-iac/01-terraform-concepts.md) |
| 5.2 State Management | [02-state-management.md](./modules/05-terraform-iac/02-state-management.md) |
| 5.3 Variables, Outputs & Environment Separation | [03-variables-outputs.md](./modules/05-terraform-iac/03-variables-outputs.md) |
| 5.4 Capstone Milestone M5 | (included in 03-variables-outputs.md) |

### [Module 6 — Resilience Patterns in Spring](./modules/06-resilience-patterns/README.md)
| Chapter | File |
|---|---|
| 6.1 Retry with Exponential Backoff | [01-retry-backoff.md](./modules/06-resilience-patterns/01-retry-backoff.md) |
| 6.2 Circuit Breaker | [02-circuit-breaker.md](./modules/06-resilience-patterns/02-circuit-breaker.md) |
| 6.3 Timeout, Bulkhead & DLQ Patterns | [03-timeout-bulkhead-dlq-milestone.md](./modules/06-resilience-patterns/03-timeout-bulkhead-dlq-milestone.md) |

### [Module 7 — Observability & Operability](./modules/07-observability/README.md)
| Chapter | Included in README |
|---|---|
| 7.1 Three Pillars of Observability | Module README |
| 7.2 Custom Metrics with Micrometer | Module README |
| 7.3 Prometheus + Grafana Queries | Module README |
| 7.4 Hardened Readiness Probe | Module README |
| 7.5 Production Runbook | Module README |

### [Module 8 — Senior Communication & Interview Readiness](./modules/08-senior-communication/README.md)
| Chapter | Included in README |
|---|---|
| 8.1 The 2-Minute Architecture Explanation | Module README |
| 8.2 The 12 Interview Questions | Module README |
| 8.3 Handling Questions You Don't Know | Module README |
| 8.4 English Technical Vocabulary | Module README |
| 8.5 Senior-Level Self-Assessment | Module README |
| 8.6 Final Acceptance Test | Module README |

---

## Capstone Files

| File | Purpose |
|---|---|
| [capstone/README.md](./capstone/README.md) | Project overview, architecture diagrams, acceptance criteria |
| [capstone/ACCEPTANCE_CRITERIA.md](./capstone/ACCEPTANCE_CRITERIA.md) | Full M1–M8 checklist |
| [capstone/docker/docker-compose.yml](./capstone/docker/docker-compose.yml) | Local dev stack |
| [capstone/docker/localstack-init.sh](./capstone/docker/localstack-init.sh) | Queue creation script |
| [capstone/k8s/order-api/](./capstone/k8s/order-api/) | Deployment, Service, ConfigMap, Secret, HPA |
| [capstone/k8s/order-worker/](./capstone/k8s/order-worker/) | Worker Deployment and HPA |
| [capstone/terraform/](./capstone/terraform/) | IaC for SQS, RDS, IAM |

## Architecture & Decisions

| File | Purpose |
|---|---|
| [docs/architecture/context.md](./docs/architecture/context.md) | System overview and data flow |
| [docs/decisions/adr-0001-queue-choice.md](./docs/decisions/adr-0001-queue-choice.md) | Why SQS over Kafka |
| [docs/decisions/adr-0002-idempotency.md](./docs/decisions/adr-0002-idempotency.md) | Idempotency implementation |
| [docs/decisions/adr-0003-correlation.md](./docs/decisions/adr-0003-correlation.md) | CorrelationId propagation |
| [appendix/glossary.md](./appendix/glossary.md) | 30+ production engineering terms |
