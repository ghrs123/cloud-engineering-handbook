# Module 7 — Observability & Operability

> **Theme:** A service that works is not enough. A service you can understand when it's failing — in production, under load, at 2am — is what makes the difference between an incident resolved in 5 minutes and one that takes 4 hours.

---

## What This Module Builds — Milestone M7

- Structured JSON logs with `correlationId` in every line (already done in Module 1 — now hardened)
- Custom Micrometer metrics: `orders.created.total`, `orders.processing.duration`
- `/actuator/prometheus` endpoint scraped by Prometheus
- Readiness probe updated to check SQS reachability
- Runbook for the top 3 production failure scenarios

---

## 7.1 — The Three Pillars

| Pillar | What it answers | Tool |
|---|---|---|
| **Logs** | What happened? | Logback + logstash-encoder + log aggregation |
| **Metrics** | How much / how often? | Micrometer + Prometheus + Grafana |
| **Traces** | Why did it take so long? | correlationId (this course) / OpenTelemetry (production at scale) |

For this course: logs and metrics are fully implemented. Tracing uses the correlationId approach from Module 1 — sufficient for debugging without additional infrastructure.

---

## 7.2 — Custom Metrics with Micrometer

Spring Boot auto-configures Micrometer. Add custom metrics to track business events:

```java
// service/OrderService.java — updated with metrics
@Service
@RequiredArgsConstructor
@Slf4j
public class OrderService {

    private final OrderRepository orderRepository;
    private final IdempotencyService idempotencyService;
    private final OrderEventPublisher eventPublisher;
    private final MeterRegistry meterRegistry;

    // Counters — increment-only, good for counting events
    private Counter ordersCreatedCounter;
    private Counter ordersDuplicateCounter;

    // Timer — measures duration + counts + percentiles
    private Timer orderCreationTimer;

    @PostConstruct
    void initMetrics() {
        ordersCreatedCounter = Counter.builder("orders.created.total")
            .description("Total number of orders created")
            .tag("service", "order-api")
            .register(meterRegistry);

        ordersDuplicateCounter = Counter.builder("orders.duplicate.total")
            .description("Idempotency key reuse count")
            .register(meterRegistry);

        orderCreationTimer = Timer.builder("orders.creation.duration")
            .description("Time to create and publish an order")
            .publishPercentiles(0.5, 0.95, 0.99)   // p50, p95, p99
            .register(meterRegistry);
    }

    @Transactional
    public CreateOrderResponse createOrder(CreateOrderRequest request, String idempotencyKey) {
        return orderCreationTimer.record(() ->
            idempotencyService.executeIfNew(idempotencyKey,
                () -> {
                    List<OrderItem> items = request.items().stream()
                        .map(i -> OrderItem.of(i.sku(), i.qty()))
                        .toList();

                    Order order = Order.create(request.customerId(), items, request.totalAmount());
                    orderRepository.save(order);
                    eventPublisher.publishOrderCreated(order);

                    MDC.put("orderId", order.getId().toString());
                    log.info("Order created: customerId={} totalAmount={}",
                        order.getCustomerId(), order.getTotalAmount());

                    ordersCreatedCounter.increment();
                    return CreateOrderResponse.from(order, MDC.get("correlationId"));
                },
                () -> {
                    ordersDuplicateCounter.increment();
                    log.debug("Duplicate idempotency key: {}", idempotencyKey);
                }
            )
        );
    }
}
```

Add to `order-worker`:

```java
// processor/OrderProcessor.java — add metrics
private final MeterRegistry meterRegistry;

private Counter ordersCompletedCounter;
private Counter ordersFailedCounter;
private Timer processingTimer;

@PostConstruct
void initMetrics() {
    ordersCompletedCounter = Counter.builder("orders.processing.completed")
        .register(meterRegistry);
    ordersFailedCounter = Counter.builder("orders.processing.failed")
        .register(meterRegistry);
    processingTimer = Timer.builder("orders.processing.duration")
        .publishPercentiles(0.5, 0.95, 0.99)
        .register(meterRegistry);
}
```

---

## 7.3 — What `/actuator/prometheus` Looks Like

After enabling `micrometer-registry-prometheus`, `/actuator/prometheus` returns:

```
# HELP orders_created_total Total number of orders created
# TYPE orders_created_total counter
orders_created_total{service="order-api"} 142.0

# HELP orders_creation_duration_seconds Time to create and publish an order
# TYPE orders_creation_duration_seconds summary
orders_creation_duration_seconds{quantile="0.5"} 0.0234
orders_creation_duration_seconds{quantile="0.95"} 0.0891
orders_creation_duration_seconds{quantile="0.99"} 0.2341
orders_creation_duration_seconds_count 142.0
orders_creation_duration_seconds_sum 4.231

# HELP resilience4j_circuitbreaker_state Circuit breaker state
# TYPE resilience4j_circuitbreaker_state gauge
resilience4j_circuitbreaker_state{name="payment-gateway"} 0.0

# HELP jvm_memory_used_bytes JVM memory used
jvm_memory_used_bytes{area="heap",id="G1 Eden Space"} 4.5088E7

# HELP hikaricp_connections_active Active connections in HikariCP pool
hikaricp_connections_active{pool="HikariPool-1"} 2.0
```

These metrics are standard Prometheus format — any Prometheus-compatible scraper can consume them.

---

## 7.4 — Prometheus Scraping in Kubernetes

The pod annotations added in Module 3 enable auto-discovery:

```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/path: "/actuator/prometheus"
  prometheus.io/port: "8080"
```

A Prometheus instance with `kubernetes_sd_configs` scrapes all pods with these annotations automatically. No per-service Prometheus configuration needed.

**Grafana dashboard queries for order-platform:**

```promql
# Order creation rate (per minute)
rate(orders_created_total[1m]) * 60

# P99 creation latency
histogram_quantile(0.99, rate(orders_creation_duration_seconds_bucket[5m]))

# Processing success rate
rate(orders_processing_completed[5m]) /
  (rate(orders_processing_completed[5m]) + rate(orders_processing_failed[5m]))

# Active DB connections
hikaricp_connections_active{application="order-api"}

# Circuit breaker state (0=closed, 1=open)
resilience4j_circuitbreaker_state{name="payment-gateway"}
```

---

## 7.5 — Hardened Readiness Probe

Update the readiness probe to verify SQS reachability (added in Module 1 but disabled in dev):

```java
// config/health/SqsHealthIndicator.java
@Component("sqs")
@ConditionalOnProperty(name = "management.health.sqs.enabled", havingValue = "true", matchIfMissing = true)
@Slf4j
public class SqsHealthIndicator implements HealthIndicator {

    private final SqsClient sqsClient;
    private final String queueUrl;

    // Cache the last result to avoid hammering SQS on every probe
    private volatile Health cachedHealth = Health.unknown().build();
    private volatile Instant lastCheck = Instant.EPOCH;
    private static final Duration CACHE_TTL = Duration.ofSeconds(15);

    @Override
    public Health health() {
        if (Duration.between(lastCheck, Instant.now()).compareTo(CACHE_TTL) > 0) {
            cachedHealth = checkSqs();
            lastCheck = Instant.now();
        }
        return cachedHealth;
    }

    private Health checkSqs() {
        try {
            sqsClient.getQueueAttributes(GetQueueAttributesRequest.builder()
                .queueUrl(queueUrl)
                .attributeNames(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES)
                .build());
            return Health.up().withDetail("queue", "reachable").build();
        } catch (Exception ex) {
            log.warn("SQS health check failed: {}", ex.getMessage());
            return Health.down().withDetail("error", ex.getMessage()).build();
        }
    }
}
```

---

## 7.6 — Production Runbook: Top 3 Scenarios

### Scenario A: Orders stuck in PENDING

**Symptoms:** `orders.processing.completed` rate drops to 0, `order-worker` pods healthy.

```bash
# 1. Check worker logs
kubectl logs -l app=order-worker -n order-platform --tail=50

# 2. Check SQS queue depth
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages

# 3. Check circuit breaker state in metrics
curl http://worker-pod:8081/actuator/prometheus | grep circuit

# 4. Check if messages are in DLQ
aws sqs get-queue-attributes \
  --queue-url $DLQ_URL \
  --attribute-names ApproximateNumberOfMessages
```

**Common causes:** circuit breaker open (downstream down), worker pods can't reach SQS (IAM/network), DB connection exhausted.

### Scenario B: High latency on POST /orders

**Symptoms:** `orders_creation_duration_seconds{quantile="0.99"}` > 2s, error rate up.

```bash
# 1. Check DB connection pool
curl http://api-pod:8081/actuator/prometheus | grep hikaricp_connections

# 2. Check if SQS publish is timing out (correlate with SQS metrics)
kubectl logs -l app=order-api -n order-platform | grep "Failed to publish"

# 3. Check pod CPU/memory
kubectl top pods -n order-platform

# 4. Check HPA is not at maxReplicas
kubectl describe hpa order-api-hpa -n order-platform
```

### Scenario C: Elevated DLQ depth

**Symptoms:** CloudWatch alarm fires, DLQ depth > 0.

```bash
# 1. Inspect DLQ messages
aws sqs receive-message \
  --queue-url $DLQ_URL \
  --max-number-of-messages 1 | jq .

# 2. Find the correlationId in the message attributes, grep logs
kubectl logs -l app=order-worker | grep "correlationId-from-message"

# 3. Determine if it's a bug (permanent) or transient
# If permanent: fix the bug, redeploy, then replay
# If transient: check if downstream is recovered, then replay

# 4. Replay after fix
aws sqs start-message-move-task \
  --source-arn $DLQ_ARN \
  --destination-arn $QUEUE_ARN \
  --max-number-of-messages-per-second 5
```

---

## Interview Mode

**Question:** *"How do you monitor your services in production?"*

**90-second answer:**
> "Three layers. Logs, metrics, and correlation.
>
> For logs: structured JSON via Logback, with every line carrying a `correlationId`. In a multi-service flow, that single ID lets me reconstruct the entire lifecycle of one order across `order-api` and `order-worker` from the log aggregation system.
>
> For metrics: Micrometer with Prometheus. I emit custom counters for business events — orders created, orders completed, orders failed — and timers for latency with P50/P95/P99 percentiles. Kubernetes annotations on pods enable auto-discovery by Prometheus without per-service configuration. Grafana dashboards show the business metrics alongside JVM and DB pool metrics.
>
> The metrics I alert on: DLQ depth above 0 (immediate page), order processing failure rate above 1% (warning), P99 creation latency above 2 seconds (warning), circuit breaker in OPEN state (page). The log-based alert: any ERROR log pattern in a 5-minute window.
>
> I intentionally kept distributed tracing out of scope for this system — the correlationId approach gives 80% of the debugging value with zero infrastructure. For a system with 10+ services, OpenTelemetry + Jaeger would be the upgrade."

---

*Module 7 complete. Move to [Module 8 — Senior Communication & Interview Readiness →](../08-senior-communication/README.md)*
