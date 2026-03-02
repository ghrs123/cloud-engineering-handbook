# Acceptance Criteria — Cloud-Native Order Processing Platform

> Use this checklist to verify the capstone is complete. Every item must pass before considering the project done. Items are grouped by the module that introduces them.

---

## M1 — Engineering for Production

- [ ] `POST /orders` returns `202 Accepted` with body `{ orderId, status, correlationId }`
- [ ] `GET /orders/{id}` returns order data and current status
- [ ] Request with invalid payload (missing `customerId`, empty `items`, negative `totalAmount`) returns `400 Bad Request` with descriptive error
- [ ] `POST /orders` without `Idempotency-Key` header returns `400 Bad Request`
- [ ] Application logs are structured (JSON or key-value, not plain text)
- [ ] `/actuator/health` returns `{ "status": "UP" }`
- [ ] No business logic in controller layer

---

## M2 — Containers & Runtime

- [ ] `docker build` produces an image without errors
- [ ] Image uses multi-stage build (builder stage does not appear in final image)
- [ ] Image size is under 300MB
- [ ] `docker-compose up` starts `order-api`, `order-worker`, `postgres`, `localstack` successfully
- [ ] Both services pass their readiness probe within 30 seconds of startup
- [ ] `SIGTERM` causes graceful shutdown (in-flight requests complete, connections close cleanly)
- [ ] JVM heap is explicitly configured via `-Xmx` or `JAVA_TOOL_OPTIONS`

---

## M3 — Kubernetes/OpenShift

- [ ] `kubectl apply -f k8s/order-api/` succeeds without errors
- [ ] `kubectl apply -f k8s/order-worker/` succeeds without errors
- [ ] `kubectl get pods` shows both deployments with status `Running`
- [ ] Rolling update: `kubectl set image` triggers rolling update with zero downtime
- [ ] `kubectl describe hpa order-api-hpa` shows HPA is configured and active
- [ ] Secrets are not hardcoded in manifests (values are base64-encoded references)
- [ ] ConfigMaps contain non-sensitive environment config
- [ ] `kubectl rollout undo deployment/order-api` successfully rolls back

---

## M4 — AWS Essentials

- [ ] `order-api` publishes `OrderCreatedEvent` to SQS after order creation
- [ ] `order-worker` consumes message from SQS (verify in logs)
- [ ] Worker updates order status to `PROCESSING` after consuming event
- [ ] Worker updates order status to `COMPLETED` after successful processing steps
- [ ] `GET /orders/{id}` returns `COMPLETED` status after processing
- [ ] SQS queue URL is configured via environment variable (not hardcoded)
- [ ] No AWS credentials hardcoded in application code or properties files

---

## M5 — Terraform IaC

- [ ] `terraform init` succeeds
- [ ] `terraform plan` shows expected resources (SQS queue, RDS instance or LocalStack equivalents)
- [ ] `terraform apply` provisions resources without errors
- [ ] `terraform output` shows queue URL and DB endpoint
- [ ] Dev environment (`envs/dev/`) uses LocalStack endpoint
- [ ] Prod environment (`envs/prod/`) uses real AWS endpoints (with proper region variables)
- [ ] State is configured for remote storage (S3 backend defined, even if using LocalStack)

---

## M6 — Resilience Patterns

- [ ] Simulated transient failure in `order-worker` triggers retry (visible in logs with attempt count)
- [ ] After max retries, message is sent to DLQ
- [ ] Message in DLQ is logged/recorded (not silently dropped)
- [ ] Circuit breaker activates when downstream mock fails repeatedly (log shows `OPEN` state)
- [ ] Retry configuration (attempts, backoff) is externalized to `application.yml`
- [ ] `order-api` does not crash if SQS publish fails (graceful error handling)

---

## M7 — Observability

- [ ] All log lines contain `correlationId` for a given request/event lifecycle
- [ ] `order-api` logs and `order-worker` logs share the same `correlationId` for the same order
- [ ] `/actuator/health/readiness` returns `UP` only when DB and SQS are accessible
- [ ] `/actuator/health/liveness` returns `UP` when JVM is alive
- [ ] `/actuator/prometheus` returns Prometheus-formatted metrics
- [ ] Custom counter metric `orders.created.total` incremented on each order creation
- [ ] Readiness probe is configured in K8s Deployment manifests

---

## M8 — Senior Communication

- [ ] All acceptance criteria above are passing
- [ ] You can explain the full system architecture in 2 minutes in English
- [ ] You can answer "why SQS over Kafka?" with specific trade-offs (see ADR-0001)
- [ ] You can answer "how does idempotency work?" with implementation details (see ADR-0002)
- [ ] You can answer "how would you scale this under 10x load?" with concrete changes
- [ ] You can answer "what happens if the worker crashes mid-processing?" with confidence
- [ ] Architecture defense document is complete: [`/docs/interview-notes/architecture-defense.md`](../docs/interview-notes/architecture-defense.md)

---

## Final Verification Script

```bash
#!/bin/bash
# Run from repo root after docker-compose up

BASE=http://localhost:8080
KEY=$(uuidgen)

echo "=== 1. Create order ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST $BASE/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -H "X-API-Key: dev-secret-key" \
  -d '{"customerId":"test-1","items":[{"sku":"X","qty":1}],"totalAmount":10.00}')
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -1)
ORDER_ID=$(echo $BODY | jq -r '.orderId')
echo "Status: $HTTP_CODE (expected 202)"
echo "OrderId: $ORDER_ID"

echo ""
echo "=== 2. Test idempotency (same key) ==="
RESPONSE2=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -H "X-API-Key: dev-secret-key" \
  -d '{"customerId":"test-1","items":[{"sku":"X","qty":1}],"totalAmount":10.00}')
echo "Status: $RESPONSE2 (expected 200 or 202 with same orderId)"

echo ""
echo "=== 3. Wait for processing and check status ==="
sleep 3
STATUS=$(curl -s $BASE/orders/$ORDER_ID -H "X-API-Key: dev-secret-key" | jq -r '.status')
echo "Final status: $STATUS (expected COMPLETED)"

echo ""
echo "=== 4. Health check ==="
HEALTH=$(curl -s $BASE/actuator/health/readiness | jq -r '.status')
echo "Readiness: $HEALTH (expected UP)"

echo ""
echo "=== Done ==="
```
