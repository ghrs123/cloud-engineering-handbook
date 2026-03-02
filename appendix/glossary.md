# Glossary

> Key terms used throughout this course and in production engineering conversations. These definitions are intentionally practical — not Wikipedia summaries.

---

## A

**ADR (Architecture Decision Record)**  
A document that captures a technical decision: what was decided, why, what alternatives were considered, and what the consequences are. Used to prevent "why did we do this?" questions 6 months later. Every significant decision in this course has an ADR in `/docs/decisions/`.

**At-least-once delivery**  
A message delivery guarantee where the system ensures every message is delivered at least once, but may deliver it multiple times. Your consumer must be idempotent. SQS standard queues use this model.

**Availability Zone (AZ)**  
A physically separate datacenter within an AWS region. Running resources across multiple AZs provides resilience against single-datacenter failures. Relevant for: RDS Multi-AZ, EKS node groups, subnets.

---

## B

**Backoff (exponential)**  
A retry strategy where each subsequent retry waits longer than the previous: 1s → 2s → 4s → 8s. Prevents overwhelming a struggling service. Always add jitter (randomness) to avoid synchronized thundering herds.

**Bulkhead**  
A resilience pattern that isolates thread pools or connection pools per dependency. If service B's thread pool is full, service A's other functionality is not affected. Named after ship compartments that prevent flooding from sinking the whole vessel.

---

## C

**Circuit Breaker**  
A pattern (via Resilience4j) that stops calling a failing service after a threshold of failures. States: `CLOSED` (normal) → `OPEN` (failing, reject calls immediately) → `HALF_OPEN` (probe, see if recovered). Prevents cascade failures.

**ConfigMap**  
Kubernetes object that stores non-sensitive configuration as key-value pairs. Injected into Pods as environment variables or mounted files. Changing a ConfigMap requires a rolling restart to take effect.

**correlationId**  
A unique identifier assigned to a request that is propagated through all systems it touches. Allows you to find all log lines related to one user request across multiple services. Stored in MDC (Mapped Diagnostic Context) in Java.

---

## D

**DLQ (Dead Letter Queue)**  
A separate queue that receives messages that have failed processing N times. Used to prevent a bad message from blocking the main queue indefinitely. Messages in the DLQ are inspectable and can be replayed after the bug is fixed.

**Deployment (Kubernetes)**  
A Kubernetes object that manages a ReplicaSet, which maintains a desired number of running Pod copies. Provides rolling updates and rollback capabilities. The primary way to run stateless applications in Kubernetes.

---

## E

**etcd**  
The distributed key-value store where Kubernetes stores all cluster state. If etcd is unavailable, the cluster can't schedule new Pods or respond to changes. You don't interact with it directly as a backend engineer.

---

## G

**Graceful shutdown**  
A shutdown sequence where the application: (1) stops accepting new requests, (2) completes in-flight requests, (3) closes connections cleanly. In Spring Boot: `server.shutdown=graceful`. In Kubernetes: `terminationGracePeriodSeconds` gives the Pod time to complete this.

---

## H

**HPA (Horizontal Pod Autoscaler)**  
Kubernetes controller that adjusts the number of Pod replicas based on observed metrics (CPU, memory, or custom). `minReplicas` sets the floor (high availability), `maxReplicas` sets the ceiling (cost control).

**Health probe**  
A Kubernetes mechanism to verify a Pod is working correctly. `readinessProbe`: is the Pod ready to receive traffic? `livenessProbe`: is the Pod alive and should it be restarted?

---

## I

**Idempotency**  
Property of an operation where executing it multiple times has the same effect as executing it once. A `POST /orders` endpoint is idempotent if calling it 3 times with the same `Idempotency-Key` creates exactly 1 order.

**IRSA (IAM Roles for Service Accounts)**  
AWS mechanism that allows a Kubernetes ServiceAccount to assume an IAM Role. Enables Pods to access AWS services (S3, SQS, RDS) without storing credentials. The correct approach — never use static `AWS_ACCESS_KEY_ID` in production.

---

## J

**Jitter**  
Random time added to retry delays to prevent synchronized retries from multiple clients (thundering herd). Instead of all clients retrying at exactly T=2s, they retry at T=1.7s, 2.1s, 1.9s, etc.

---

## K

**kubelet**  
The agent that runs on each Kubernetes worker node. Responsible for pulling container images and starting/stopping containers as instructed by the Control Plane.

---

## L

**Liveness probe**  
Kubernetes health check that determines if a Pod should be restarted. Use a low-cost check (e.g., `/actuator/health/liveness`) that only fails if the JVM is truly stuck. Do not include dependency checks here — that belongs in readiness.

---

## M

**MDC (Mapped Diagnostic Context)**  
A thread-local map in SLF4J/Logback that allows you to attach key-value pairs to every log statement in the current thread. Used to propagate `correlationId`, `traceId`, `userId` automatically.

**Multi-AZ**  
RDS configuration that maintains a synchronous standby replica in a different Availability Zone. If the primary fails, RDS promotes the standby automatically (typically < 60s). Required for production databases.

---

## P

**Pod**  
The smallest deployable unit in Kubernetes. Contains one or more containers sharing network and storage. Pods are ephemeral — when they die, they are replaced, not restarted in place. Never create bare Pods; always use Deployments.

---

## R

**Readiness probe**  
Kubernetes health check that determines if a Pod should receive traffic. A Pod that fails readiness is removed from the Service's endpoint list but not restarted. Use it to verify all dependencies (DB, SQS) are available.

**Rolling update**  
A Deployment update strategy that replaces Pods gradually. With `maxUnavailable: 0`, at least N replicas are always running. The new version must pass readiness before old Pods are terminated.

---

## S

**Secret (Kubernetes)**  
Kubernetes object for sensitive data (passwords, API keys, certificates). Values are base64-encoded (not encrypted by default). In production, use External Secrets Operator + AWS Secrets Manager for actual encryption and rotation.

**SQS (Simple Queue Service)**  
AWS managed message queue. Standard queues: at-least-once delivery, high throughput. FIFO queues: exactly-once delivery, ordered, lower throughput. Includes native Dead Letter Queue support via redrive policy.

**State (Terraform)**  
Terraform's record of what infrastructure it manages. Stored remotely (S3 + DynamoDB locking) for team use. Never edit manually. If corrupted, infrastructure management breaks.

---

## T

**Thundering herd**  
When many clients retry simultaneously (e.g., after a brief outage), creating a traffic spike that overwhelms the recovering service. Prevented by jitter on retry backoff.

---

## V

**VPA (Vertical Pod Autoscaler)**  
Kubernetes controller that adjusts CPU and memory requests/limits for Pods. Useful when a service has variable resource needs but can't be horizontally scaled. Requires Pod restart to apply changes (not suitable for all services).

**VisibilityTimeout (SQS)**  
The time a message is invisible to other consumers after being received. If your consumer doesn't delete the message within this window, SQS makes it visible again (enabling automatic retry). Set it to slightly longer than your maximum processing time.
