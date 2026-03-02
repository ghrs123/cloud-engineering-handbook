# 7.5 — Production Runbook & Milestone M7

> **Capstone connection:** Observability without a runbook is incomplete. This chapter turns the metrics, logs, and probes from the previous chapters into a structured incident response workflow — and confirms everything is working with the M7 checklist.

---

## Why Runbooks Exist

A runbook is the answer to: *what does the on-call engineer do at 2am when this alert fires?*

Without a runbook:
- The on-call engineer wastes 20 minutes figuring out what commands to run
- They make guesses under pressure and risk making the incident worse
- Institutional knowledge lives only in the heads of senior engineers who might not be on call

With a runbook:
- The first 5 minutes of every incident are the same: find the scope, stop the bleeding, find the correlationId
- Junior engineers can follow the steps and escalate only when genuinely needed
- Post-mortem reviews can improve the runbook for next time

A runbook is not exhaustive documentation of the system. It is a decision tree for the most common failure scenarios, written for someone who is stressed and time-pressured.

---

## Incident Response Structure (4 Phases)

```
Phase 1: TRIAGE    (2 min)  — scope and severity
Phase 2: STABILISE (5 min)  — stop the bleeding
Phase 3: TRACE     (10 min) — find the root cause
Phase 4: FIX       (varies) — deploy, replay, verify
```

**Phase 1 — Triage:**
What is the user-visible impact?
- Orders failing to create → `order-api` problem
- Orders stuck in PENDING → `order-worker` problem
- Total outage → infrastructure problem

Check Grafana dashboards first. Three panels tell the story immediately:
1. Order creation rate — is it zero or dropping?
2. DLQ depth — is it growing?
3. Error rate (HTTP 5xx) — which service?

**Phase 2 — Stabilise:**
Depending on what triage shows:

*Order creation failing:*
```bash
# Is the DB pool exhausted?
curl http://api-pod:8081/actuator/prometheus | grep hikaricp_connections_active

# Is the SQS endpoint timing out?
kubectl logs -l app=order-api --since=5m | grep "Failed to publish"

# Is the circuit breaker open?
kubectl logs -l app=order-api --since=5m | grep "CircuitBreaker"

# Scale up if overloaded
kubectl scale deployment order-api --replicas=5 -n order-platform
```

*Order processing stuck:*
```bash
# How many messages in queue vs DLQ?
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible

# Are worker pods running?
kubectl get pods -l app=order-worker -n order-platform

# Any recent worker errors?
kubectl logs -l app=order-worker --since=10m | grep ERROR
```

**Phase 3 — Trace:**
Find the correlationId of a failing order:
```bash
# From a customer report (orderId known)
kubectl logs -l app=order-api | grep "orderId=ord-4421"
# This shows the correlationId: "req-7f3a91bc4a2e"

# From DLQ (message attributes contain correlationId)
aws sqs receive-message \
  --queue-url $DLQ_URL \
  --message-attribute-names correlationId \
  --max-number-of-messages 1 | jq '.Messages[0].MessageAttributes.correlationId.StringValue'

# Reconstruct the full timeline
kubectl logs -l app=order-api | grep "req-7f3a91bc4a2e"
kubectl logs -l app=order-worker | grep "req-7f3a91bc4a2e"
```

**Phase 4 — Fix and validate:**
```bash
# After deploying a fix — verify metrics recover
watch 'curl -s http://localhost:8081/actuator/prometheus | grep "orders_processing_completed"'

# Replay DLQ messages (after fix is deployed)
aws sqs start-message-move-task \
  --source-arn $DLQ_ARN \
  --destination-arn $QUEUE_ARN \
  --max-number-of-messages-per-second 5

# Run smoke test
curl -sf -X POST http://order-api/orders \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "X-API-Key: $API_KEY" \
  -d '{"customerId":"smoke-test","items":[{"sku":"TEST","qty":1}],"totalAmount":1.00}' \
  | jq .
```

---

## Scenario A: Orders Stuck in PENDING

**Symptom:** `orders.processing.completed` rate drops to 0. Worker pods are Running. Queue depth is growing.

**Steps:**
```bash
# 1. Confirm queue depth is growing
aws sqs get-queue-attributes --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages

# 2. Check if worker is consuming (NotVisible = messages in flight)
aws sqs get-queue-attributes --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessagesNotVisible

# 3. Check worker circuit breaker state
kubectl logs -l app=order-worker --since=5m | grep -i "circuitbreaker"

# 4. Check if payment mock is down
kubectl logs -l app=order-worker --since=5m | grep -i "payment"

# 5. If circuit breaker is OPEN — wait for recovery window, or redeploy if config bug
# If payment mock is down — check that service separately
```

**Common causes:** Circuit breaker OPEN due to payment mock failures. Worker pods can't reach SQS (IAM policy issue, network policy). DB connection pool exhausted.

---

## Scenario B: High Latency on POST /orders

**Symptom:** P99 `orders_creation_duration_seconds` alert fires (>2s). HTTP error rate increasing.

```bash
# 1. DB connection pool — is it at max?
curl http://api-pod:8081/actuator/prometheus \
  | grep -E "hikaricp_connections_(active|pending|max)"

# 2. SQS publish timing out?
kubectl logs -l app=order-api --since=5m | grep -E "(timeout|SQS|publish)"

# 3. CPU/memory OK?
kubectl top pods -l app=order-api -n order-platform

# 4. Is HPA at max replicas?
kubectl describe hpa order-api-hpa -n order-platform | grep "Current Replicas"

# 5. If DB connections at max — consider PgBouncer or scaling the DB instance
# If SQS is slow — check LocalStack/endpoint connectivity
```

---

## Scenario C: DLQ Depth Growing

**Symptom:** CloudWatch alarm fires on DLQ `ApproximateNumberOfMessages > 0`.

```bash
# 1. Inspect the failing message
aws sqs receive-message \
  --queue-url $DLQ_URL \
  --message-attribute-names All \
  --max-number-of-messages 1 | jq .

# 2. Extract correlationId and find logs
CORRELATION_ID=$(aws sqs receive-message ... | jq -r '.Messages[0].MessageAttributes.correlationId.StringValue')
kubectl logs -l app=order-worker | grep $CORRELATION_ID

# 3. Determine failure type
# Permanent (bug): fix code, redeploy, then replay
# Transient (temporary downstream): wait for recovery, then replay

# 4. Replay after fix
aws sqs start-message-move-task \
  --source-arn $DLQ_ARN \
  --destination-arn $QUEUE_ARN \
  --max-number-of-messages-per-second 5

# 5. Monitor replay progress
watch 'aws sqs get-queue-attributes --queue-url $DLQ_URL \
  --attribute-names ApproximateNumberOfMessages | jq .Attributes'
```

---

## Capstone Milestone M7 — Verification Checklist

Complete the following items before marking M7 done.

### Logging

- [ ] `order-api` emits structured JSON logs in `prod`/`kubernetes` profile
- [ ] Every log line in `order-api` carries `correlationId` for a given request
- [ ] `order-worker` restores `correlationId` from SQS message attribute to MDC
- [ ] A single `grep` for a correlationId shows events from both services

Verify:
```bash
# Start order-api with kubernetes profile
SPRING_PROFILES_ACTIVE=kubernetes java -jar order-api.jar &

# Create an order
CORRELATION_ID="req-verify-$(date +%s)"
curl -X POST http://localhost:8080/orders \
  -H "X-Correlation-Id: $CORRELATION_ID" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"verify","items":[{"sku":"SKU-01","qty":1}],"totalAmount":9.99}'

# Check logs contain correlationId in JSON format
journalctl -u order-api | grep "$CORRELATION_ID" | python3 -m json.tool
```

### Metrics

- [ ] `/actuator/prometheus` returns `orders_created_total` counter
- [ ] `/actuator/prometheus` returns `orders_creation_duration_seconds` summary with quantiles
- [ ] `order-worker` exposes `orders_processing_completed` and `orders_processing_failed` counters
- [ ] `resilience4j_circuitbreaker_state` appears in `order-worker` metrics

```bash
curl -s http://localhost:8081/actuator/prometheus | grep -E "orders_created_total|orders_creation_duration"
curl -s http://localhost:8082/actuator/prometheus | grep -E "orders_processing_|resilience4j_circuit"
```

### Health & Readiness

- [ ] `/actuator/health/readiness` returns `UP` when DB and SQS are reachable
- [ ] `/actuator/health/readiness` returns `DOWN` (503) when SQS is unreachable
- [ ] `/actuator/health/liveness` returns `UP` independently of DB/SQS state
- [ ] Kubernetes Deployment YAML has correct readiness and liveness probe configuration

```bash
# Verify readiness UP
curl -s http://localhost:8081/actuator/health/readiness | jq .status

# Simulate SQS unavailable — stop LocalStack and check
docker stop localstack
sleep 20  # wait for cache TTL
curl -s http://localhost:8081/actuator/health/readiness | jq .
# Expected: {"status":"DOWN",...}

# Verify liveness stays UP even when SQS is down
curl -s http://localhost:8081/actuator/health/liveness | jq .status
# Expected: "UP"

# Restart LocalStack
docker start localstack
sleep 20
curl -s http://localhost:8081/actuator/health/readiness | jq .status
# Expected: "UP" again
```

### Kubernetes Annotations

- [ ] `order-api` Deployment has Prometheus scrape annotations
- [ ] `order-worker` Deployment has Prometheus scrape annotations

```bash
kubectl get pods -l app=order-api -n order-platform -o json \
  | jq '.items[0].metadata.annotations | keys'
# Expected: ["prometheus.io/path", "prometheus.io/port", "prometheus.io/scrape"]
```

---

## What You Have Now

After completing M7, the order platform is **operationally ready**:

- Every failure leaves a traceable trail via `correlationId`
- Business health is visible in metrics and alertable
- Kubernetes knows when pods are genuinely ready to serve traffic
- On-call engineers have a decision tree for the three most common failure scenarios

The final module (M8) prepares you to explain and defend all of this in an interview.

---

*Module 7 complete. Move to [Module 8 — Senior Communication & Interview Readiness →](../08-senior-communication/README.md)*
