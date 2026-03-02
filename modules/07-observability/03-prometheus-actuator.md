# 7.3 — Prometheus & Actuator

> **Capstone connection:** `order-api` and `order-worker` already emit metrics via Micrometer. This chapter exposes them at `/actuator/prometheus` and configures Kubernetes pod annotations so a Prometheus instance can scrape them automatically — no per-service Prometheus configuration needed.

---

## What Prometheus Is (and Is Not)

Prometheus is a time-series database with a pull-based scraping model. At a configured interval (default 15s), Prometheus makes an HTTP GET to each target's metrics endpoint and stores the result.

It is **not**:
- A log aggregation system (use Loki, ELK, CloudWatch Logs)
- A distributed tracing backend (use Jaeger, Zipkin, AWS X-Ray)
- An alerting notification system (use Alertmanager, PagerDuty, OpsGenie)

Prometheus stores metrics and evaluates alerting rules. Everything else is downstream.

**Why pull-based matters for microservices:** Each pod is an independent scrape target. If a pod is down, Prometheus records a scrape failure (its own metric). No data loss in the backend — Prometheus simply has a gap for that pod's metrics during the outage.

---

## Enabling the Prometheus Endpoint

Add the Micrometer Prometheus registry:

**`pom.xml`:**
```xml
<!-- order-api and order-worker both need this -->
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
    <!-- version managed by Spring Boot BOM -->
</dependency>
```

**`application.yml`:**
```yaml
management:
  endpoints:
    web:
      exposure:
        include: health, info, metrics, prometheus
      base-path: /actuator
  endpoint:
    health:
      show-details: when-authorized
    prometheus:
      enabled: true
  metrics:
    export:
      prometheus:
        enabled: true
    distribution:
      percentiles:
        orders.creation.duration: 0.5, 0.95, 0.99
        orders.processing.duration: 0.5, 0.95, 0.99
```

Verify:
```bash
curl http://localhost:8081/actuator/prometheus
```

Expected output (excerpt):
```
# HELP orders_created_total Orders successfully created and published
# TYPE orders_created_total counter
orders_created_total{service="order-api"} 142.0

# HELP orders_creation_duration_seconds End-to-end order creation time
# TYPE orders_creation_duration_seconds summary
orders_creation_duration_seconds{quantile="0.5"} 0.0234
orders_creation_duration_seconds{quantile="0.95"} 0.0891
orders_creation_duration_seconds{quantile="0.99"} 0.2341
orders_creation_duration_seconds_count 142.0
orders_creation_duration_seconds_sum 4.231

# HELP hikaricp_connections_active Active connections in pool
# TYPE hikaricp_connections_active gauge
hikaricp_connections_active{pool="HikariPool-1"} 2.0

# HELP resilience4j_circuitbreaker_state Circuit breaker state
# TYPE resilience4j_circuitbreaker_state gauge
resilience4j_circuitbreaker_state{name="payment-gateway"} 0.0
```

---

## Actuator Endpoint Reference

Actuator exposes operational endpoints via HTTP. The ones relevant to production:

| Endpoint | Path | Use |
|----------|------|-----|
| Health | `/actuator/health` | Load balancer and K8s probe target |
| Readiness | `/actuator/health/readiness` | K8s readiness probe |
| Liveness | `/actuator/health/liveness` | K8s liveness probe |
| Prometheus | `/actuator/prometheus` | Metrics scrape target |
| Info | `/actuator/info` | App version and build info |
| Metrics | `/actuator/metrics` | Browse metrics by name |

**Security:** Never expose `/actuator` on the public port. Two patterns:

*Pattern A — separate management port (preferred for containers):*
```yaml
management:
  server:
    port: 8081  # separate from application port 8080
```

*Pattern B — IP-based restriction via firewall or Kubernetes NetworkPolicy:*
```yaml
# Allow /actuator only from within the cluster
management:
  server:
    port: 8080  # same port, but NetworkPolicy blocks external access to /actuator
```

For Kubernetes: separate management port is cleaner. Your Ingress exposes 8080 only; the Prometheus ServiceMonitor and health probes target 8081.

---

## Kubernetes Auto-Discovery via Pod Annotations

When Prometheus is deployed with `kubernetes_sd_configs`, it discovers all pods and checks annotations. Pods annotated correctly are automatically scraped — no Prometheus configuration file changes needed.

**Add to `capstone/k8s/order-api/deployment.yaml`:**
```yaml
spec:
  template:
    metadata:
      labels:
        app: order-api
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/path: "/actuator/prometheus"
        prometheus.io/port: "8081"
```

**Same for `capstone/k8s/order-worker/deployment.yaml`:**
```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/path: "/actuator/prometheus"
  prometheus.io/port: "8081"
```

Prometheus scrapes every pod with `prometheus.io/scrape: "true"` at the configured port and path. New deployments are discovered within one scrape interval (default 15 seconds). No restart of Prometheus needed.

---

## Key PromQL Queries for the Capstone

With both services running and Prometheus scraping them, these queries give operational visibility:

```promql
# Order creation rate (per minute, smoothed over 5m)
rate(orders_created_total[5m]) * 60

# P99 creation latency
histogram_quantile(0.99,
  rate(orders_creation_duration_seconds_bucket[5m]))

# Processing success rate (0.0 to 1.0)
rate(orders_processing_completed[5m]) /
  (rate(orders_processing_completed[5m]) + rate(orders_processing_failed[5m]))

# Active DB connections — alert if near pool max (default 10)
hikaricp_connections_active{application="order-api"}

# Circuit breaker state — 0=CLOSED (healthy), 1=OPEN (failing fast)
resilience4j_circuitbreaker_state{name="payment-gateway"}
```

**Alerting rules (add to Prometheus `rules.yml`):**
```yaml
groups:
  - name: order-platform
    rules:
      - alert: OrderProcessingFailureRate
        expr: |
          rate(orders_processing_failed[5m]) /
          (rate(orders_processing_completed[5m]) + rate(orders_processing_failed[5m])) > 0.01
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Order processing failure rate > 1%"

      - alert: CircuitBreakerOpen
        expr: resilience4j_circuitbreaker_state{name="payment-gateway"} == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Circuit breaker open for {{ $labels.name }}"
```

---

## Common Mistakes

**Exposing all Actuator endpoints on the public port:**

❌ `management.endpoints.web.exposure.include=*` without a separate management port
✅ Separate port or restrict via NetworkPolicy

**Not setting `spring.application.name`:**

❌ All metrics have `application="unknown"` tag in Prometheus
✅ Set `spring.application.name=order-api` — Micrometer picks this up as the `application` tag automatically

**Forgetting to add the Prometheus dependency:**

❌ `/actuator/prometheus` returns 404 even with `exposure.include=prometheus`
✅ `micrometer-registry-prometheus` must be on the classpath

**Scraping the wrong port:**

❌ Prometheus annotation points to port 8080 but management port is 8081
✅ Annotation `prometheus.io/port` must match `management.server.port`

**Using Actuator metrics endpoint for performance analysis:**

❌ Calling `/actuator/metrics/orders.created.total` from application code
✅ `/actuator/metrics` is for humans browsing; Prometheus is for automated analysis and alerting

---

## Exercise 7.3

1. Add the `micrometer-registry-prometheus` dependency to `order-api`
2. Configure `application.yml` to expose `/actuator/prometheus` on port 8081
3. Add the correct Prometheus annotations to the `order-api` Kubernetes Deployment manifest
4. Write an integration test (using `@SpringBootTest(webEnvironment = RANDOM_PORT)`) that:
   - Makes one `POST /orders` request
   - Calls `/actuator/prometheus`
   - Asserts the response body contains `orders_created_total`

### Answer

**`pom.xml` addition:**
```xml
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

**`application.yml`:**
```yaml
spring:
  application:
    name: order-api

management:
  server:
    port: 8081
  endpoints:
    web:
      exposure:
        include: health, info, metrics, prometheus
  endpoint:
    health:
      show-details: when-authorized
```

**`capstone/k8s/order-api/deployment.yaml` annotation block:**
```yaml
spec:
  template:
    metadata:
      labels:
        app: order-api
        version: "1.0"
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/path: "/actuator/prometheus"
        prometheus.io/port: "8081"
```

**Integration test:**
```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class PrometheusEndpointIT {

    @LocalServerPort
    private int appPort;

    // Management port is fixed or auto-assigned — read from properties
    @Value("${management.server.port:8081}")
    private int managementPort;

    @Autowired
    private TestRestTemplate restTemplate;

    @Test
    void prometheusEndpoint_containsOrderMetrics_afterOrderCreation() {
        // Create one order so the counter is registered and incremented
        CreateOrderRequest request = new CreateOrderRequest(
            "cust-test",
            List.of(new OrderItemRequest("SKU-01", 1)),
            BigDecimal.valueOf(49.99)
        );
        restTemplate.postForEntity(
            "http://localhost:" + appPort + "/orders",
            new HttpEntity<>(request, headersWithIdempotencyKey()),
            CreateOrderResponse.class
        );

        // Scrape the metrics endpoint on the management port
        ResponseEntity<String> metrics = new TestRestTemplate()
            .getForEntity("http://localhost:" + managementPort + "/actuator/prometheus", String.class);

        assertThat(metrics.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(metrics.getBody()).contains("orders_created_total");
        assertThat(metrics.getBody()).contains("orders_creation_duration_seconds");
    }

    private HttpHeaders headersWithIdempotencyKey() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Idempotency-Key", UUID.randomUUID().toString());
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }
}
```

---

## Interview Mode

**Question:** *"How do you expose metrics from a Spring Boot service to Prometheus?"*

> "Add `micrometer-registry-prometheus` to the classpath and expose the `/actuator/prometheus` endpoint. Prometheus pulls metrics from that URL at a configured interval — typically 15 seconds.
>
> In Kubernetes, the cleanest pattern is pod annotations: annotate each pod with `prometheus.io/scrape: true`, the path, and the port. Prometheus with `kubernetes_sd_configs` discovers these automatically. No per-service Prometheus configuration, no restarts — new services are discovered within one scrape interval.
>
> I separate the management port (8081) from the application port (8080) so the Prometheus scrape traffic never competes with application traffic, and so the Ingress can expose 8080 only without accidentally leaking Actuator endpoints to the public.
>
> For the capstone the alerts that matter are: circuit breaker in OPEN state (page immediately), failure rate above 1% sustained for 10 minutes (page), and P99 above 2 seconds (warning). The metrics for these are already in Resilience4j and Micrometer auto-configuration — I just need to write the PromQL rules."

---

*Next: [7.4 — Health & Readiness Probes](./04-health-readiness-probes.md)*
