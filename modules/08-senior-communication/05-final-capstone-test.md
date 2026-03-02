# 8.5 — Self-Assessment & Final Capstone Test

> **Capstone connection:** This is the end. Every module led to this point. The acceptance test confirms the system is built correctly. The self-assessment confirms you can explain and defend it. Both must pass before this course is complete.

---

## The Gap Between Pleno and Senior

The technical gap is smaller than people think. Most mid-level engineers have the knowledge. What separates mid-level from senior at international product companies is not knowing more concepts — it's how knowledge is applied and communicated.

**Senior engineers communicate trade-offs proactively.**

They don't wait to be asked "what's the downside?" They say it first. When a senior engineer says "we chose SQS," the next sentence is "and the trade-off we accepted is..." without being prompted.

**Senior engineers own the operational story.**

"This will work in dev" is not enough. "Here's how we monitor it, here's how we debug it at 2am, here's what we do when it fails." If you can't answer the operational questions, you're not ready for senior.

**Senior engineers know what to simplify.**

The answer to "how would you build X?" from a senior engineer often starts with "what's the constraint?" Not jumping to the most sophisticated solution. The right amount of complexity is the minimum needed for the current requirements.

---

## Technical Depth Self-Assessment

Rate yourself honestly. These are not pass/fail — they identify where to invest more practice.

### Architecture

- [ ] I can explain the complete capstone architecture from memory in 2 minutes, including three design decisions
- [ ] I can draw the request flow diagram (Client → API → DB/SQS → Worker) without looking
- [ ] I can describe the order state machine (PENDING → PROCESSING → COMPLETED/FAILED) and what triggers each transition
- [ ] I can explain why `POST /orders` returns `202 Accepted` instead of `200 OK`

### Resilience

- [ ] I can explain retry with exponential backoff + jitter without notes
- [ ] I can explain what the circuit breaker does in each state (Closed, Open, Half-Open)
- [ ] I can explain the visibility timeout and what happens when the worker crashes mid-processing
- [ ] I can explain why the idempotency check and order creation must be in the same transaction

### Infrastructure

- [ ] I can explain multi-stage Docker builds and why the layer order matters
- [ ] I can explain what `UseContainerSupport` and `MaxRAMPercentage=75.0` do and why they're needed
- [ ] I can explain what an HPA does and what metric it uses in our deployment
- [ ] I can explain the difference between a rolling update, blue-green, and canary deployment

### Observability

- [ ] I can explain the three pillars of observability and when each is useful
- [ ] I can explain how correlationId flows from HTTP request to SQS message to worker log
- [ ] I can explain why DB checks belong in readiness, not liveness probes
- [ ] I can explain what PromQL query I'd use to detect a processing failure rate spike

### AWS & Terraform

- [ ] I can explain how IRSA works and why it's better than static `AWS_ACCESS_KEY_ID` credentials
- [ ] I can explain the SQS at-least-once delivery model and its implications for consumers
- [ ] I can explain what `terraform plan` shows and why it should be reviewed before `apply`
- [ ] I can explain what Terraform state is and why it must not be committed to Git

---

## Operational Maturity Self-Assessment

These require you to have actually run the system — not just read about it.

- [ ] I have run `docker compose up` and seen all services start healthy
- [ ] I have sent `POST /orders` via curl and seen `202 Accepted`
- [ ] I have verified the order status changed to COMPLETED by polling `GET /orders/{id}`
- [ ] I have seen the idempotency check work — sent the same `Idempotency-Key` twice and got the same `orderId`
- [ ] I have seen a message go to the DLQ (simulated with a permanent failure)
- [ ] I have run `kubectl apply` and seen both pods reach Ready state
- [ ] I have run `terraform plan` and reviewed the output before applying
- [ ] I have triggered CrashLoopBackOff (by misconfiguring something) and debugged it with `kubectl describe pod`

---

## Communication Self-Assessment

- [ ] I have delivered the 2-minute architecture pitch out loud (not read it) and timed it
- [ ] I can answer all 12 interview questions in English without switching to Portuguese
- [ ] I can explain "why not Kafka?" without reading the chapter
- [ ] I have practiced saying "I'm not certain, but my reasoning is..." in at least one mock interview
- [ ] I can rewrite a PT-influenced English sentence in real-time without thinking about it

---

## Final Acceptance Test — Automated

Run this script from the repository root. All checks must pass.

```bash
#!/bin/bash
set -e

echo "=============================="
echo "FINAL ACCEPTANCE TEST — M1–M8"
echo "=============================="
echo ""

PASS=0
FAIL=0

check() {
    if eval "$2" &>/dev/null; then
        echo "PASS: $1"
        PASS=$((PASS + 1))
    else
        echo "FAIL: $1"
        FAIL=$((FAIL + 1))
    fi
}

# Prerequisite: docker compose up must be running
echo "--- Prerequisites ---"
check "order-api container running" \
    "docker ps | grep order-api"
check "order-worker container running" \
    "docker ps | grep order-worker"
check "postgres container running" \
    "docker ps | grep postgres"
check "localstack container running" \
    "docker ps | grep localstack"

echo ""
echo "--- M1: API and persistence ---"
IKEY_M1=$(uuidgen)
RESPONSE=$(curl -sf -X POST http://localhost:8080/orders \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: $IKEY_M1" \
    -H "X-API-Key: dev-secret-key" \
    -d '{"customerId":"test-m1","items":[{"sku":"SKU-01","qty":1}],"totalAmount":10.00}')
ORDER_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['orderId'])" 2>/dev/null)

check "POST /orders returns 202 Accepted" \
    "[ -n '$ORDER_ID' ]"

check "GET /orders/{id} returns order" \
    "curl -sf http://localhost:8080/orders/$ORDER_ID -H 'X-API-Key: dev-secret-key' | python3 -c \"import sys,json; d=json.load(sys.stdin); exit(0 if d.get('orderId') else 1)\""

echo ""
echo "--- M1: Idempotency ---"
RESPONSE2=$(curl -sf -X POST http://localhost:8080/orders \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: $IKEY_M1" \
    -H "X-API-Key: dev-secret-key" \
    -d '{"customerId":"test-m1","items":[{"sku":"SKU-01","qty":1}],"totalAmount":10.00}')
ORDER_ID2=$(echo "$RESPONSE2" | python3 -c "import sys,json; print(json.load(sys.stdin)['orderId'])" 2>/dev/null)

check "Duplicate Idempotency-Key returns same orderId" \
    "[ '$ORDER_ID' = '$ORDER_ID2' ]"

echo ""
echo "--- M2: Docker build ---"
check "order-api Docker image builds" \
    "docker build -q -t order-api:test ./services/order-api"

echo ""
echo "--- M3: Kubernetes readiness ---"
check "order-api pod is Ready in Kubernetes" \
    "kubectl get pods -l app=order-api -n order-platform -o jsonpath='{.items[0].status.containerStatuses[0].ready}' | grep -q true"
check "order-worker pod is Ready in Kubernetes" \
    "kubectl get pods -l app=order-worker -n order-platform -o jsonpath='{.items[0].status.containerStatuses[0].ready}' | grep -q true"

echo ""
echo "--- M4: End-to-end processing ---"
IKEY_M4=$(uuidgen)
E2E_ORDER_ID=$(curl -sf -X POST http://localhost:8080/orders \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: $IKEY_M4" \
    -H "X-API-Key: dev-secret-key" \
    -d '{"customerId":"test-e2e","items":[{"sku":"SKU-01","qty":1}],"totalAmount":49.99}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['orderId'])")

echo "  Waiting 5s for processing..."
sleep 5

E2E_STATUS=$(curl -sf http://localhost:8080/orders/$E2E_ORDER_ID \
    -H "X-API-Key: dev-secret-key" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")

check "Order processes to COMPLETED" \
    "[ '$E2E_STATUS' = 'COMPLETED' ]"

echo ""
echo "--- M5: Terraform ---"
check "terraform output returns order_queue_url" \
    "cd capstone/terraform && terraform output order_queue_url 2>/dev/null && cd ../.."

echo ""
echo "--- M6: Resilience configuration ---"
check "Resilience4j config present in order-worker" \
    "grep -q 'resilience4j' services/order-worker/src/main/resources/application.yml"
check "DLQ config present in order-worker" \
    "grep -q 'dlq' services/order-worker/src/main/resources/application.yml"

echo ""
echo "--- M7: Observability ---"
check "Prometheus endpoint returns orders_created_total" \
    "curl -sf http://localhost:8081/actuator/prometheus | grep -q 'orders_created_total'"
check "Readiness probe returns UP" \
    "curl -sf http://localhost:8081/actuator/health/readiness | python3 -c \"import sys,json; exit(0 if json.load(sys.stdin)['status']=='UP' else 1)\""
check "Liveness probe returns UP" \
    "curl -sf http://localhost:8081/actuator/health/liveness | python3 -c \"import sys,json; exit(0 if json.load(sys.stdin)['status']=='UP' else 1)\""
check "X-Correlation-Id header present on response" \
    "curl -sf -I http://localhost:8080/orders/$ORDER_ID -H 'X-API-Key: dev-secret-key' | grep -qi 'x-correlation-id'"

echo ""
echo "=============================="
echo "RESULTS: $PASS passed, $FAIL failed"
echo "=============================="

if [ $FAIL -gt 0 ]; then
    echo "Fix the failing checks before considering the capstone complete."
    exit 1
else
    echo "All automated checks pass."
fi
```

Save as `capstone/scripts/final-acceptance-test.sh` and run:
```bash
chmod +x capstone/scripts/final-acceptance-test.sh
./capstone/scripts/final-acceptance-test.sh
```

---

## Final Acceptance Test — Manual

The automated test cannot verify communication. This section requires a human reviewer or a recording.

**Task 1: Architecture Pitch**

Deliver the 2-minute architecture explanation. Record yourself.

Criteria:
- [ ] 90–130 seconds duration
- [ ] Covers request flow (Client → API → SQS → Worker)
- [ ] Mentions idempotency, resilience, and observability
- [ ] Mentions at least one trade-off (SQS vs Kafka, or async model)
- [ ] Natural delivery (not read from notes)

**Task 2: Live Q&A**

Have someone ask you five questions from Chapter 8.3. They should choose which five. You should answer without notes.

Criteria:
- [ ] Each answer delivered in 60–90 seconds
- [ ] Each answer includes a trade-off or limitation
- [ ] No switching to Portuguese mid-answer
- [ ] No "I don't know" without reasoning through the question

**Task 3: Adversarial Questions**

Have someone challenge three of your architectural decisions. They should push back with "why not X?" for any three decisions.

Criteria:
- [ ] You explain what X is good for
- [ ] You explain why X doesn't fit this context
- [ ] You say when you would revisit (at what scale or constraint change)

---

## What Comes Next

Completing this course means you have:

- Built a cloud-native order processing platform end-to-end
- Applied production patterns: idempotency, retry, circuit breaker, DLQ, rolling updates
- Implemented observability: structured logs, correlationId, custom metrics, health probes
- Provisioned infrastructure with Terraform across environments
- Communicated architectural decisions in English with trade-offs

The capstone is not the end. It is the foundation for the next conversation — the one in the interview, or the one with the team after you join.

Every decision in this system is explainable. Every trade-off is defensible. Every failure mode is handled.

That is what production-ready means.

---

*Course complete. Return to the [Course Index](../../COURSE_INDEX.md) or the [Capstone](../../capstone/README.md).*
