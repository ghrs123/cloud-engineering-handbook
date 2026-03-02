# 7.1 — The Three Pillars of Observability

> **Capstone connection:** Before you can run `order-api` and `order-worker` in production, you need to answer one question: when something fails, how will you find out and what will tell you why? That is what observability solves.

---

## The Problem With "It Crashed"

Your service is down. A customer can't place an order. You `kubectl exec` into a pod and stare at logs like this:

```
2024-11-15 14:23:01 ERROR Processing failed
2024-11-15 14:23:01 ERROR NullPointerException at OrderProcessor.java:87
```

Which order? Which customer? Was it the database, the SQS message, or the payment mock? How long had it been failing before someone noticed?

Without observability, debugging production is archaeology. You dig through logs hoping to find a clue, comparing timestamps manually, and guessing at causes.

**Observability** is the property that lets you understand the internal state of a system from its external outputs. For a backend service, three types of output matter:

| Pillar | Question it answers | Tool in this course |
|--------|--------------------|--------------------|
| **Logs** | What happened, and in what sequence? | Logback + logstash-encoder |
| **Metrics** | How much, how often, how fast? | Micrometer + Prometheus |
| **Traces** | Why did this specific request take so long? | correlationId (this course) |

---

## Logs: What Happened?

Logs are the most accessible pillar. They answer *what happened* — the sequence of events that led to a state.

The difference between useful and useless logs is structure and context.

### Unstructured logs (useless at scale)

```
2024-11-15 14:23:01 INFO  Order created successfully
2024-11-15 14:23:02 ERROR Failed to process order
```

Two questions you cannot answer: *which order?* and *which request triggered this?*

### Structured logs (queryable and correlated)

```json
{
  "timestamp": "2024-11-15T14:23:01.234Z",
  "level": "INFO",
  "service": "order-api",
  "traceId": "req-7f3a91bc",
  "orderId": "ord-4421",
  "customerId": "cust-9912",
  "message": "Order created",
  "totalAmount": 149.90
}
```

Now you can filter: *show all logs for orderId=ord-4421*, or *show all ERRORs from order-worker in the last 10 minutes*, or *show me the P99 time between creation and COMPLETED by extracting timestamps for the same orderId*.

### The correlationId contract

The `correlationId` (also called `traceId` or `requestId`) is a single UUID that travels the full lifecycle of a request:

```
Client → order-api → SQS message → order-worker → DB
                      ^ same correlationId here     ^ and here
```

With this single ID, a grep across all logs reconstructs the complete sequence of events for any order.

**How it flows in this system:**

1. `order-api` receives `POST /orders` — a servlet filter generates `correlationId` and puts it in MDC
2. Every log line in that thread automatically carries `correlationId` (MDC propagation)
3. When `order-api` publishes to SQS, `correlationId` is added as a message attribute
4. `order-worker` reads the message, restores `correlationId` to its MDC
5. Every worker log line carries the same `correlationId`

A single `grep correlationId=req-7f3a91bc` across log aggregation shows the complete order lifecycle — from HTTP request to worker completion.

---

## Metrics: How Much?

Metrics answer quantitative questions over time: *how many orders per minute?*, *what is the P99 processing latency?*, *what percentage of messages are failing?*

Metrics are not for debugging individual requests. They are for detecting patterns and setting alerts.

```
Alert: DLQ depth > 0 for 5 minutes   → page the on-call engineer
Alert: P99 order creation latency > 2s → Slack warning
Alert: Error rate > 1% for 10 minutes → page the on-call engineer
```

You cannot write these alerts with logs alone. Counting ERROR lines from logs is possible but expensive and brittle. Counters and histograms are purpose-built for this.

**The metrics you need for `order-api` and `order-worker`:**

| Metric | Type | Alert threshold |
|--------|------|----------------|
| `orders.created.total` | Counter | Rate drops to 0 (create rate alert) |
| `orders.creation.duration` | Timer (histogram) | P99 > 2s |
| `orders.processing.completed` | Counter | Rate drops unexpectedly |
| `orders.processing.failed` | Counter | Any failure rate > 1% |
| `orders.duplicate.total` | Counter | Sudden spike (client retry storm) |
| `hikaricp_connections_active` | Gauge (auto) | Near pool max |
| `resilience4j_circuitbreaker_state` | Gauge (auto) | Value = 1 (OPEN) |

---

## Traces: Why Was It Slow?

Distributed tracing answers *which path did this request take and how long did each step take?* It is most useful when you have multiple services and complex call graphs.

For this course: the `correlationId` approach gives you 80% of the debugging value with zero additional infrastructure. When `order-api` is slow, you can find the correlationId from the slow request, grep the logs, and see which step was slow — SQS publish, DB write, or validation.

Full distributed tracing (OpenTelemetry + Jaeger or AWS X-Ray) adds automatic span creation, visualisation of the call tree, and microsecond timing per step. It is the right investment when:
- You have 5+ services
- You need to trace across async boundaries automatically
- You need to visualise which downstream dependency caused latency

For this course, skip it. The correlationId approach is sufficient, easier to implement, and teaches the concept.

---

## What You Need to Know vs What You Don't

**You need to know:**
- How to add structured JSON logging with Logback and logstash-encoder
- How to propagate correlationId from HTTP through SQS to the worker
- How to add custom Micrometer counters and timers
- What Prometheus format looks like and how to expose it
- The difference between logs (debugging), metrics (alerting), and traces (performance)

**You don't need to know (for this course):**
- OpenTelemetry SDK integration
- Jaeger/Zipkin distributed tracing setup
- Grafana Tempo or AWS X-Ray
- Log aggregation platform setup (ELK, Loki, CloudWatch) — you just need to emit the right format

---

## Common Mistakes

**Logging at the wrong level:**

❌ `log.error("Order created: {}", orderId)` — ERROR for a success event wastes alert budget
✅ `log.info(...)` for business events, `log.error(...)` only for unexpected failures

**Logging exceptions without the stack trace:**

❌ `log.error("Processing failed: {}", ex.getMessage())`
✅ `log.error("Processing failed for orderId={}", orderId, ex)` — pass the exception as last arg

**Missing correlationId in async context:**

❌ Starting a thread pool task without copying MDC — the new thread has no correlationId
✅ Use `MDC.getCopyOfContextMap()` and `MDC.setContextMap(...)` when submitting to `@Async` or `CompletableFuture`

**Logging sensitive data:**

❌ `log.info("Payment card: {}", cardNumber)` — PII in logs is a GDPR violation
✅ Log only non-sensitive identifiers (orderId, customerId UUID) — never payment data, emails, or addresses

**Over-logging at INFO:**

❌ `log.info("Entering createOrder method")` — noise that hides signal
✅ One INFO per business event, DEBUG for implementation details that should be off by default in production

---

## Exercise 7.1

The `order-api` service from Module 1 uses plain log messages. Add a servlet filter that:
1. Generates a `correlationId` (UUID) on every request if the `X-Correlation-Id` header is absent, or reads it from the header if present
2. Stores it in MDC as `correlationId`
3. Adds it to the response as `X-Correlation-Id`
4. Clears MDC after the response is sent

Then update `logback-spring.xml` to emit structured JSON with `correlationId` in every log line.

Write a `@WebMvcTest` that asserts:
- The response header `X-Correlation-Id` is present
- It is a valid UUID

### Answer

**Dependency (`pom.xml`):**
```xml
<dependency>
    <groupId>net.logstash.logback</groupId>
    <artifactId>logstash-logback-encoder</artifactId>
    <version>7.4</version>
</dependency>
```

**Filter:**
```java
// config/CorrelationIdFilter.java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CorrelationIdFilter extends OncePerRequestFilter {

    private static final String CORRELATION_HEADER = "X-Correlation-Id";
    private static final String MDC_KEY = "correlationId";

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String correlationId = request.getHeader(CORRELATION_HEADER);
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = "req-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        }

        MDC.put(MDC_KEY, correlationId);
        response.setHeader(CORRELATION_HEADER, correlationId);

        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY);   // always clean up — thread pool reuse
        }
    }
}
```

**`src/main/resources/logback-spring.xml`:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <springProperty scope="context" name="APP_NAME" source="spring.application.name" defaultValue="order-api"/>

    <appender name="JSON_STDOUT" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <customFields>{"service":"${APP_NAME}"}</customFields>
            <fieldNames>
                <timestamp>timestamp</timestamp>
                <message>message</message>
                <logger>logger</logger>
                <thread>thread</thread>
                <levelValue>[ignore]</levelValue>
            </fieldNames>
        </encoder>
    </appender>

    <!-- Dev profile: readable output -->
    <springProfile name="default,dev">
        <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
            <encoder>
                <pattern>%d{HH:mm:ss.SSS} %-5level [%X{correlationId}] %logger{36} - %msg%n</pattern>
            </encoder>
        </appender>
        <root level="INFO">
            <appender-ref ref="CONSOLE"/>
        </root>
    </springProfile>

    <!-- Production profile: JSON -->
    <springProfile name="prod,kubernetes">
        <root level="INFO">
            <appender-ref ref="JSON_STDOUT"/>
        </root>
    </springProfile>
</configuration>
```

**Test (`@WebMvcTest`):**
```java
// api/CorrelationIdFilterTest.java
@WebMvcTest(controllers = OrderController.class)
class CorrelationIdFilterTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private OrderService orderService;

    @Test
    void shouldAddCorrelationIdHeader_whenNotProvided() throws Exception {
        mockMvc.perform(get("/actuator/health"))
            .andExpect(status().isOk())
            .andExpect(header().exists("X-Correlation-Id"))
            .andExpect(result -> {
                String id = result.getResponse().getHeader("X-Correlation-Id");
                assertThat(id).isNotBlank();
                // our format: "req-" + 12 hex chars
                assertThat(id).matches("req-[a-f0-9]{12}");
            });
    }

    @Test
    void shouldPreserveCorrelationIdHeader_whenProvided() throws Exception {
        mockMvc.perform(get("/actuator/health")
                .header("X-Correlation-Id", "req-custom-123"))
            .andExpect(header().string("X-Correlation-Id", "req-custom-123"));
    }
}
```

**What structured JSON output looks like in production:**
```json
{
  "@timestamp": "2024-11-15T14:23:01.234Z",
  "message": "Order created: customerId=cust-9912 totalAmount=149.90",
  "logger": "com.example.orderapi.service.OrderService",
  "level": "INFO",
  "service": "order-api",
  "correlationId": "req-7f3a91bc4a2e",
  "orderId": "ord-4421"
}
```

A log aggregation system (CloudWatch Logs Insights, Loki, Elasticsearch) can now filter and aggregate on any of these fields without regex parsing.

---

## Interview Mode

**Question:** *"How do you approach observability for a backend service?"*

> "Three layers: logs, metrics, and correlation.
>
> For logs I use structured JSON — every line is a JSON object with correlationId, service name, and business context like orderId. The correlationId is generated on the HTTP request and propagated through every log line in that thread via MDC. When the event is published to SQS, the correlationId goes with it as a message attribute. The worker restores it to MDC. One ID, one grep, full picture across both services.
>
> For metrics I use Micrometer. Custom counters for business events — orders created, orders completed, orders failed — and timers with P50/P95/P99 percentiles for latency. These drive the alerts: DLQ depth above zero is an immediate page, P99 above 2 seconds is a warning.
>
> Distributed tracing with OpenTelemetry is the next step for a system with many services. For two services, the correlationId approach gives 80% of the value with zero infrastructure overhead."

---

*Next: [7.2 — Custom Metrics with Micrometer](./02-custom-metrics-micrometer.md)*
