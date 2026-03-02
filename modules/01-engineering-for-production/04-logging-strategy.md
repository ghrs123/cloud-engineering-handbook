# 1.4 — Logging Strategy

> **Capstone connection:** Every log line from `order-api` will carry a `correlationId`. When `order-worker` processes the same order in Module 4, it will carry the same ID. This makes the entire order lifecycle traceable with a single grep.

---

## What Logs Are For

Logs serve one purpose in production: **helping an on-call engineer understand what happened and why**.

Everything else — vanity logs, debug logs left in, info logs that restate what the method name already says — is noise that makes finding the signal harder.

Three questions to ask before adding a log line:
1. Would this help me debug a production incident?
2. Is this information not available elsewhere (metrics, database)?
3. Am I logging at the right level?

---

## Log Levels — The Production Contract

| Level | When to use | Example |
|---|---|---|
| `ERROR` | Unexpected failures requiring human attention | Uncaught exception, data inconsistency, downstream permanently unavailable |
| `WARN` | Expected failures or degraded behavior | Order not found, retry attempt, circuit breaker opening |
| `INFO` | Significant business events | Order created, order completed, service started |
| `DEBUG` | Developer diagnostics (disabled in prod) | Entering method, SQL parameters, intermediate state |
| `TRACE` | Deep diagnostics (never in prod) | Every field, every iteration |

**Production log level:** INFO. DEBUG logs should not appear in production unless you're actively debugging an incident (can be enabled per-package without restart via Spring Boot Actuator's `/actuator/loggers` endpoint).

---

## Structured Logging

Plain text logs:
```
2024-01-15 10:30:01 INFO  Order a1b2c3 created for customer cust-123
```

Structured JSON logs:
```json
{"timestamp":"2024-01-15T10:30:01.123Z","level":"INFO","service":"order-api","correlationId":"req-a1b2c3","orderId":"a1b2c3d4","customerId":"cust-123","message":"Order created"}
```

Why structured matters: log aggregation systems (CloudWatch, ELK, Loki) can filter, aggregate, and alert on structured fields. `grep correlationId="req-a1b2c3"` works on plain text. But `SELECT * FROM logs WHERE orderId = 'a1b2c3d4' AND level = 'ERROR'` requires structure.

### Logback configuration for structured JSON

```xml
<!-- src/main/resources/logback-spring.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<configuration>

  <springProperty scope="context" name="appName" source="spring.application.name" defaultValue="order-api"/>

  <!-- Console appender — used in dev and Kubernetes (logs go to stdout, collected by cluster) -->
  <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LogstashEncoder">
      <customFields>{"service":"${appName}"}</customFields>
      <!-- Include MDC fields automatically (correlationId, traceId, etc.) -->
      <includeMdcKeyNames>correlationId,traceId,orderId</includeMdcKeyNames>
      <timeZone>UTC</timeZone>
    </encoder>
  </appender>

  <!-- Dev profile: readable plain text -->
  <springProfile name="dev,local">
    <appender name="PLAIN" class="ch.qos.logback.core.ConsoleAppender">
      <encoder>
        <pattern>%d{HH:mm:ss.SSS} [%level] [%X{correlationId:-no-corr}] %logger{36} - %msg%n</pattern>
      </encoder>
    </appender>
    <root level="DEBUG">
      <appender-ref ref="PLAIN"/>
    </root>
  </springProfile>

  <!-- All other profiles: structured JSON -->
  <springProfile name="!dev &amp; !local">
    <root level="INFO">
      <appender-ref ref="CONSOLE"/>
    </root>
    <!-- Reduce noise from Spring internals -->
    <logger name="org.springframework" level="WARN"/>
    <logger name="org.hibernate" level="WARN"/>
    <logger name="com.zaxxer.hikari" level="WARN"/>
  </springProfile>

</configuration>
```

Add the logstash encoder dependency:
```xml
<dependency>
    <groupId>net.logstash.logback</groupId>
    <artifactId>logstash-logback-encoder</artifactId>
    <version>7.4</version>
</dependency>
```

---

## The CorrelationId Filter

This is the most important piece of observability infrastructure you will add in this module. Every request gets a `correlationId`. Every log line in that request's thread carries it automatically via MDC.

```java
// common/filter/CorrelationIdFilter.java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
@Slf4j
public class CorrelationIdFilter implements Filter {

    public static final String CORRELATION_ID_HEADER = "X-Correlation-Id";
    public static final String MDC_KEY = "correlationId";

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        // Use client-provided ID or generate one
        String correlationId = request.getHeader(CORRELATION_ID_HEADER);
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = generateCorrelationId();
        }

        // Put in MDC — all subsequent log calls in this thread include it automatically
        MDC.put(MDC_KEY, correlationId);

        // Echo back in response header — client can see it, use it for support requests
        response.setHeader(CORRELATION_ID_HEADER, correlationId);

        try {
            chain.doFilter(req, res);
        } finally {
            // CRITICAL: always clear MDC, even on exception
            // Threads are reused (thread pool) — stale MDC from previous request is a bug
            MDC.remove(MDC_KEY);
        }
    }

    private String generateCorrelationId() {
        // Short format for readability in logs: "req-a1b2c3d4"
        return "req-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }
}
```

**Why `@Order(Ordered.HIGHEST_PRECEDENCE)`?** The correlation ID must be set before any other filter or interceptor runs, so it is available in all log calls including Spring Security, exception handlers, and your own filters.

**Why the `finally` block?** Servlet containers reuse threads. If you set MDC in thread A's request and don't clear it, the next request on thread A will have the wrong `correlationId`. This causes confusing logs where two different orders share an ID.

---

## What to Log at Each Layer

### Controller — minimal

```java
@RestController
@Slf4j
public class OrderController {

    @PostMapping("/orders")
    public ResponseEntity<CreateOrderResponse> createOrder(
            @RequestBody @Valid CreateOrderRequest request,
            @RequestHeader("Idempotency-Key") String idempotencyKey) {

        // Don't log here — the service will log the business event
        // The CorrelationIdFilter already logged the incoming request (if enabled)
        CreateOrderResponse response = orderService.createOrder(request, idempotencyKey);
        return ResponseEntity.accepted().body(response);
    }
}
```

### Service — business events

```java
@Service
@Slf4j
public class OrderService {

    @Transactional
    public CreateOrderResponse createOrder(CreateOrderRequest request, String idempotencyKey) {
        return idempotencyService.executeIfNew(idempotencyKey, () -> {
            Order order = Order.create(request.customerId(), request.items(), request.totalAmount());
            orderRepository.save(order);

            // Log the business event — this is what matters
            log.info("Order created: orderId={} customerId={} totalAmount={}",
                order.getId(), order.getCustomerId(), order.getTotalAmount());

            // Add orderId to MDC for remaining log calls in this request
            MDC.put("orderId", order.getId().toString());

            return CreateOrderResponse.from(order, MDC.get("correlationId"));
        });
    }

    public OrderResponse getOrder(UUID orderId) {
        return orderRepository.findById(orderId)
            .map(OrderResponse::from)
            .orElseThrow(() -> {
                log.warn("Order not found: orderId={}", orderId);
                return new OrderNotFoundException(orderId);
            });
    }
}
```

### What NOT to log

```java
// DO NOT log this — it restates the method name
log.info("Entering createOrder method");

// DO NOT log this — PII, never log customer personal data
log.info("Order for customer email: {}", request.email());

// DO NOT log this — security sensitive
log.debug("API key used: {}", apiKey);

// DO NOT log this in production — too verbose, use metrics instead
log.debug("DB query executed in {}ms", elapsed);
```

---

## Logging and Async Contexts

MDC is thread-local. When you use `CompletableFuture`, `@Async`, or virtual threads, the MDC is **not automatically propagated** to the new thread.

```java
// PROBLEM: correlationId is lost in async context
CompletableFuture.runAsync(() -> {
    log.info("Processing async task");  // correlationId = null!
});

// SOLUTION: capture and restore manually
String correlationId = MDC.get("correlationId");
CompletableFuture.runAsync(() -> {
    MDC.put("correlationId", correlationId);
    try {
        log.info("Processing async task");  // correlationId is present
    } finally {
        MDC.remove("correlationId");
    }
});
```

This is relevant in Module 4 when `order-worker` uses an async SQS poller. The correlationId comes from the SQS message attribute and must be explicitly placed in MDC before processing begins.

---

## Common Mistakes

**Logging `Exception.getMessage()` without the stack trace at ERROR level.**
```java
log.error("Error: {}", ex.getMessage());  // ← you lose the stack trace
log.error("Unexpected error processing order: {}", orderId, ex);  // ← correct
```
SLF4J: the last argument to a log call, if it is a `Throwable`, is automatically treated as an exception and its stack trace is included.

**Logging at INFO in a tight loop.**  
If your SQS consumer processes 1000 messages/second and you log INFO for each, that's 1000 log lines/second. At JSON format, ~200 bytes each, that's 200KB/s of logs. Storage is not free.

**Not testing that sensitive data doesn't appear in logs.**  
Add a test that creates an order with recognizable values and asserts the log output does not contain certain fields (credit card numbers, passwords, SSNs).

---

## Exercise 1.4

**Task:** Implement structured logging for `order-api`.

1. Add the `logstash-logback-encoder` dependency.
2. Create `logback-spring.xml` with JSON format for non-dev profiles and plain text for dev.
3. Implement `CorrelationIdFilter`.
4. Add logging to `OrderService.createOrder` and `OrderService.getOrder`.
5. Write a test that verifies the `X-Correlation-Id` header is returned in responses.

**Answer — Integration test for correlationId header:**

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestDatabase
class CorrelationIdFilterTest {

    @Autowired
    TestRestTemplate restTemplate;

    @Test
    void request_withoutCorrelationId_respondsWithGeneratedId() {
        ResponseEntity<String> response = restTemplate.getForEntity("/actuator/health", String.class);

        assertThat(response.getHeaders().getFirst("X-Correlation-Id"))
            .isNotNull()
            .startsWith("req-");
    }

    @Test
    void request_withCorrelationId_echoesItBack() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Correlation-Id", "my-custom-id-123");

        ResponseEntity<String> response = restTemplate.exchange(
            "/actuator/health",
            HttpMethod.GET,
            new HttpEntity<>(headers),
            String.class
        );

        assertThat(response.getHeaders().getFirst("X-Correlation-Id"))
            .isEqualTo("my-custom-id-123");
    }
}
```

---

## Interview Mode

**Question:** *"How do you approach logging in a microservices system?"*

**90-second answer:**
> "I use structured JSON logging so log aggregation systems can filter and query on specific fields. Every service emits logs with at minimum: timestamp, level, service name, correlationId, and the message.
>
> The correlationId is the critical piece. I implement a servlet filter that reads an `X-Correlation-Id` header from the request, or generates one if absent, and puts it in the SLF4J MDC. Every log line in that request thread automatically includes it. When the service publishes a message to SQS, it includes the correlationId as a message attribute. The consumer restores it to MDC before processing. So I can trace a single order across both services with one grep.
>
> On log levels: INFO for significant business events, WARN for expected failures like not-found or validation errors, ERROR for unexpected failures that need human attention. DEBUG is off in production by default but can be enabled per-package via Actuator's loggers endpoint without a restart.
>
> What I never log: personal data, credentials, anything that appears in OWASP's sensitive data exposure category."

---

*Next: [Chapter 1.5 — Spring Actuator & Health Endpoints →](./05-actuator-health.md)*
