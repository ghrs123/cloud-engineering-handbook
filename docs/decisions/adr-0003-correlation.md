# ADR-0003 — CorrelationId Propagation Strategy

**Status:** Accepted  
**Date:** 2024-01  

---

## Context

When an order request arrives at `order-api`, gets published to SQS, and is then consumed by `order-worker`, the logs from all three phases should be correlatable with a single identifier. Without this, debugging a production issue requires correlating logs by timestamp — brittle and slow.

---

## Decision

Use a **`correlationId`** propagated as:
1. HTTP request header: `X-Correlation-Id` (or generated if absent)
2. SQS message attribute: `correlationId`
3. SLF4J MDC (Mapped Diagnostic Context) in every log statement

---

## Implementation

### Step 1 — Servlet filter in `order-api`

```java
@Component
@Order(1)
public class CorrelationIdFilter implements Filter {

    private static final String HEADER = "X-Correlation-Id";
    private static final String MDC_KEY = "correlationId";

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) req;
        String correlationId = request.getHeader(HEADER);
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = "req-" + UUID.randomUUID().toString().substring(0, 8);
        }
        MDC.put(MDC_KEY, correlationId);
        ((HttpServletResponse) res).setHeader(HEADER, correlationId);
        try {
            chain.doFilter(req, res);
        } finally {
            MDC.remove(MDC_KEY);
        }
    }
}
```

### Step 2 — SQS message attribute when publishing

```java
public void publish(OrderCreatedEvent event) {
    String correlationId = MDC.get("correlationId");
    
    SendMessageRequest request = SendMessageRequest.builder()
        .queueUrl(queueUrl)
        .messageBody(objectMapper.writeValueAsString(event))
        .messageAttributes(Map.of(
            "correlationId", MessageAttributeValue.builder()
                .dataType("String")
                .stringValue(correlationId != null ? correlationId : "unknown")
                .build()
        ))
        .build();
    
    sqsClient.sendMessage(request);
}
```

### Step 3 — MDC restoration in `order-worker`

```java
public void processMessage(Message message) {
    String correlationId = message.messageAttributes()
        .getOrDefault("correlationId", MessageAttributeValue.builder()
            .stringValue("unknown").build())
        .stringValue();
    
    MDC.put("correlationId", correlationId);
    try {
        orderProcessor.process(parseEvent(message));
    } finally {
        MDC.remove("correlationId");
    }
}
```

### Step 4 — Logback/Log4j2 pattern

```xml
<!-- logback-spring.xml -->
<pattern>{"timestamp":"%d{ISO8601}","level":"%level","service":"order-api","correlationId":"%X{correlationId:-none}","thread":"%thread","logger":"%logger{36}","message":"%message"}%n</pattern>
```

---

## What This Achieves

Given any `orderId` or `correlationId`, you can run:

```bash
# Find all logs for a given correlationId across both services
grep '"correlationId":"req-a1b2c3"' /var/log/order-api/*.log /var/log/order-worker/*.log

# Or in a log aggregation system (ELK, CloudWatch Logs Insights, Loki):
# filter correlationId = "req-a1b2c3"
```

This gives you the full lifecycle of one order across all services in chronological order — without any tracing infrastructure.

---

## What This Is NOT

This is **not** distributed tracing (OpenTelemetry, Jaeger, Zipkin). Those systems automatically instrument all HTTP calls, DB queries, and produce visual flame graphs.

This is a **lightweight manual approach** that provides 80% of the debugging value with 5% of the infrastructure overhead. For a system at this scale, it is the right trade-off.

If you upgrade to full distributed tracing later:
1. Add `micrometer-tracing-bridge-otel` and `opentelemetry-exporter-otlp`
2. Spring Boot 3.x auto-configures `traceId` and `spanId` in MDC
3. The `correlationId` approach continues to work alongside it

---

## Consequences

**Positive:**
- Zero infrastructure overhead — no tracing backend required
- Works with any log aggregation system
- Trivial to implement and understand
- Debuggable in development with just `grep`

**Negative:**
- No visual trace visualization (waterfall charts, span timings)
- Manual — engineers must remember to propagate when adding new service calls
- MDC is thread-local — async tasks (CompletableFuture, virtual threads) must explicitly propagate context
