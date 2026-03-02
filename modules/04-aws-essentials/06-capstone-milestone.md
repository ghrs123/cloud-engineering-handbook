# 4.6 — Capstone Milestone M4

> **Deliverable:** Full end-to-end flow working. `POST /orders` → SQS → `order-worker` → `COMPLETED`. Idempotency verified. DLQ demonstrated. CorrelationId visible in both service logs.

---

## Verification Checklist

- [ ] `docker-compose up` starts all four services cleanly (postgres, localstack, order-api, order-worker)
- [ ] All services reach healthy status within 60 seconds
- [ ] `POST /orders` returns `202 Accepted` with `orderId` and `correlationId`
- [ ] `GET /orders/{id}` returns `COMPLETED` within 5 seconds of creation
- [ ] Duplicate `Idempotency-Key` returns the original `orderId` (no new order created, verified in DB)
- [ ] `order-api` logs show `correlationId` matching the value returned in the response
- [ ] `order-worker` logs show the same `correlationId` for the same order
- [ ] Simulated transient failure causes retry visible in `order-worker` logs
- [ ] Simulated permanent failure moves message to DLQ (verified with `aws sqs` CLI)
- [ ] `GET /actuator/health/readiness` returns `UP` on both services

---

## Full End-to-End Smoke Test

```bash
#!/bin/bash
# Run from repo root after docker-compose up

BASE_API="http://localhost:8080"
BASE_WORKER="http://localhost:8081"

echo "============================================"
echo "Capstone M4 — End-to-End Smoke Test"
echo "============================================"

# ── Test 1: Create order ─────────────────────────────────────────────
echo ""
echo "TEST 1: Create order"
IKEY=$(uuidgen)
RESPONSE=$(curl -s -X POST $BASE_API/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IKEY" \
  -H "X-API-Key: dev-secret-key" \
  -d '{
    "customerId": "cust-smoke-test",
    "items": [{"sku": "PROD-001", "qty": 2}],
    "totalAmount": 99.90
  }')

HTTP_STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK')" 2>/dev/null && echo "valid JSON" || echo "invalid")
ORDER_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['orderId'])" 2>/dev/null)
CORRELATION_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['correlationId'])" 2>/dev/null)

echo "  OrderId:       $ORDER_ID"
echo "  CorrelationId: $CORRELATION_ID"
[ -n "$ORDER_ID" ] && echo "  PASS: order created" || echo "  FAIL: no orderId in response"

# ── Test 2: Wait for processing ──────────────────────────────────────
echo ""
echo "TEST 2: Wait for worker to process order (up to 10s)"
for i in $(seq 1 10); do
  sleep 1
  STATUS=$(curl -s $BASE_API/orders/$ORDER_ID \
    -H "X-API-Key: dev-secret-key" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
  echo "  Attempt $i: status=$STATUS"
  [ "$STATUS" = "COMPLETED" ] && break
done

[ "$STATUS" = "COMPLETED" ] && echo "  PASS: order COMPLETED" || echo "  FAIL: order not COMPLETED (status=$STATUS)"

# ── Test 3: Idempotency ──────────────────────────────────────────────
echo ""
echo "TEST 3: Idempotency — same key returns same orderId"
RESPONSE2=$(curl -s -X POST $BASE_API/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IKEY" \
  -H "X-API-Key: dev-secret-key" \
  -d '{"customerId":"cust-smoke-test","items":[{"sku":"PROD-001","qty":2}],"totalAmount":99.90}')
ORDER_ID2=$(echo "$RESPONSE2" | python3 -c "import sys,json; print(json.load(sys.stdin)['orderId'])" 2>/dev/null)

[ "$ORDER_ID" = "$ORDER_ID2" ] && echo "  PASS: same orderId returned" || echo "  FAIL: different orderIds ($ORDER_ID vs $ORDER_ID2)"

# ── Test 4: Health checks ────────────────────────────────────────────
echo ""
echo "TEST 4: Health checks"
API_HEALTH=$(curl -s $BASE_API/actuator/health/readiness | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
WORKER_HEALTH=$(curl -s $BASE_WORKER/actuator/health/readiness | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)

[ "$API_HEALTH" = "UP" ] && echo "  PASS: order-api readiness UP" || echo "  FAIL: order-api readiness $API_HEALTH"
[ "$WORKER_HEALTH" = "UP" ] && echo "  PASS: order-worker readiness UP" || echo "  FAIL: order-worker readiness $WORKER_HEALTH"

# ── Test 5: CorrelationId in logs ────────────────────────────────────
echo ""
echo "TEST 5: CorrelationId traceable"
echo "  Look for correlationId=$CORRELATION_ID in both service logs:"
echo "  docker-compose logs order-api   | grep $CORRELATION_ID"
echo "  docker-compose logs order-worker | grep $CORRELATION_ID"

echo ""
echo "============================================"
echo "Smoke test complete."
echo "============================================"
```

---

## Demonstrating DLQ Behavior

```bash
# Enable transient failure in PaymentAuthStep:
# Change TRANSIENT_FAILURE_RATE to 1.0 (always fail)
# Rebuild and restart order-worker

# Create an order
IKEY=$(uuidgen)
curl -s -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IKEY" \
  -H "X-API-Key: dev-secret-key" \
  -d '{"customerId":"test","items":[{"sku":"X","qty":1}],"totalAmount":1.00}'

# Watch worker retry 3 times
docker-compose logs -f order-worker | grep -E "transient|retry|attempt"

# After 3 failures, check DLQ
sleep 60  # Wait for visibility timeout cycles
aws --endpoint-url=http://localhost:4566 --region us-east-1 \
  sqs receive-message \
  --queue-url http://localhost:4566/000000000000/order-created-dlq \
  --max-number-of-messages 1

# Order should be in PENDING state (not FAILED — transient failures don't mark FAILED)
# (Or PROCESSING if the reset-to-PENDING path has a timing issue)
```

---

## CorrelationId Trace — What You Should See

After creating an order with `correlationId: req-a1b2c3d`:

**`order-api` logs:**
```json
{"timestamp":"...","level":"INFO","service":"order-api","correlationId":"req-a1b2c3d","message":"Order created","orderId":"uuid-xxx","customerId":"cust-1"}
{"timestamp":"...","level":"INFO","service":"order-api","correlationId":"req-a1b2c3d","message":"OrderCreatedEvent published","orderId":"uuid-xxx"}
```

**`order-worker` logs (seconds later):**
```json
{"timestamp":"...","level":"INFO","service":"order-worker","correlationId":"req-a1b2c3d","message":"Received OrderCreatedEvent","orderId":"uuid-xxx"}
{"timestamp":"...","level":"INFO","service":"order-worker","correlationId":"req-a1b2c3d","message":"Executing step","step":"inventory-check","orderId":"uuid-xxx"}
{"timestamp":"...","level":"INFO","service":"order-worker","correlationId":"req-a1b2c3d","message":"Executing step","step":"payment-authorization","orderId":"uuid-xxx"}
{"timestamp":"...","level":"INFO","service":"order-worker","correlationId":"req-a1b2c3d","message":"Order processing completed","orderId":"uuid-xxx"}
```

One grep finds the entire lifecycle:
```bash
docker-compose logs | grep '"correlationId":"req-a1b2c3d"'
```

---

## What's Added in Next Modules

- **Module 5 (Terraform):** provisions the SQS queues and RDS instance with proper Terraform instead of docker-compose/localstack scripts
- **Module 6 (Resilience):** adds Resilience4j `@Retry` and `@CircuitBreaker` annotations to the processing steps, replacing the manual TransientProcessingException approach with a proper resilience layer
- **Module 7 (Observability):** adds custom metrics (`orders.created.total`, `orders.processing.duration`), configures Prometheus scraping, and upgrades the readiness probe to check SQS connectivity

---

*Module 4 complete. Move to [Module 5 — Infrastructure as Code with Terraform →](../05-terraform-iac/README.md)*
