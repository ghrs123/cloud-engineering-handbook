# 7.2 — Custom Metrics with Micrometer

> **Capstone connection:** Default JVM metrics tell you if the heap is full. Business metrics tell you if orders are being processed. You need both. This chapter adds `orders.created.total` and `orders.creation.duration` to `order-api` and equivalent counters to `order-worker`.

---

## The Problem With Default Metrics

Spring Boot auto-configures dozens of metrics out of the box: JVM heap, GC pauses, HTTP request counts, HikariCP pool usage. These are useful for infrastructure health.

But they cannot answer the business questions:

- *Is the order creation rate dropping?* — not in HTTP metrics (what if retries inflate the count?)
- *How long does the full create-and-publish operation take?* — HTTP metrics include only the controller; not the SQS publish
- *How many idempotent duplicate requests are we getting?* — not tracked anywhere

Custom business metrics close this gap. With Micrometer, adding a counter or timer is 4 lines of code.

---

## Micrometer Concepts

Micrometer is the metrics facade built into Spring Boot. It mirrors SLF4J for metrics: your code calls Micrometer, and Micrometer delegates to whichever registry is on the classpath (Prometheus, CloudWatch, Datadog, etc.).

**Three metric types you will use:**

| Type | What it counts | Example |
|------|---------------|---------|
| `Counter` | Cumulative total, never decreases | Total orders created |
| `Timer` | Duration and count, with percentiles | Order creation end-to-end latency |
| `Gauge` | Point-in-time value, can go up or down | Active SQS messages in flight |

**Tags:** Every metric can have tags (labels in Prometheus terminology). Tags let you slice data:
```
orders.created.total{service="order-api", env="prod"}
orders.created.total{service="order-api", env="staging"}
```

**Cardinality warning:** Tags create separate time series. `{orderId="ord-4421"}` would create one series per order — millions of series. Tags must be low-cardinality (a small fixed set of values). ✅ `{service="order-api"}` ❌ `{orderId="..."}`.

---

## Registering Metrics: `@PostConstruct` vs `@Bean`

Two approaches:

**`@PostConstruct` (preferred for service-level metrics):**
```java
@PostConstruct
void initMetrics() {
    ordersCreatedCounter = Counter.builder("orders.created.total")
        .description("Orders successfully created")
        .tag("service", "order-api")
        .register(meterRegistry);
}
```

**`@Bean` in a configuration class (preferred for infrastructure metrics):**
```java
@Bean
public Counter dlqMessagesCounter(MeterRegistry registry) {
    return Counter.builder("orders.dlq.total")
        .description("Messages sent to DLQ")
        .register(registry);
}
```

Use `@PostConstruct` when the metric belongs to a specific service class. Use `@Bean` for metrics shared across the application or tied to infrastructure.

---

## Implementing Business Metrics in `order-api`

```java
// service/OrderService.java
@Service
@RequiredArgsConstructor
@Slf4j
public class OrderService {

    private final OrderRepository orderRepository;
    private final IdempotencyService idempotencyService;
    private final OrderEventPublisher eventPublisher;
    private final MeterRegistry meterRegistry;

    private Counter ordersCreatedCounter;
    private Counter ordersDuplicateCounter;
    private Timer orderCreationTimer;

    @PostConstruct
    void initMetrics() {
        ordersCreatedCounter = Counter.builder("orders.created.total")
            .description("Orders successfully created and published")
            .tag("service", "order-api")
            .register(meterRegistry);

        ordersDuplicateCounter = Counter.builder("orders.duplicate.total")
            .description("Requests rejected due to duplicate idempotency key")
            .register(meterRegistry);

        // Timer auto-records count, sum, and percentiles
        orderCreationTimer = Timer.builder("orders.creation.duration")
            .description("End-to-end order creation time including SQS publish")
            .publishPercentiles(0.5, 0.95, 0.99)   // p50, p95, p99
            .register(meterRegistry);
    }

    @Transactional
    public CreateOrderResponse createOrder(CreateOrderRequest request, String idempotencyKey) {
        return orderCreationTimer.record(() ->
            idempotencyService.executeIfNew(
                idempotencyKey,
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

**`Timer.record(Supplier<T>)`** — wraps the entire operation and records duration automatically, including the exception path.

---

## Implementing Business Metrics in `order-worker`

```java
// processor/OrderProcessor.java
@Component
@RequiredArgsConstructor
@Slf4j
public class OrderProcessor {

    private final OrderRepository orderRepository;
    private final MeterRegistry meterRegistry;

    private Counter ordersCompletedCounter;
    private Counter ordersFailedCounter;
    private Timer processingDurationTimer;

    @PostConstruct
    void initMetrics() {
        ordersCompletedCounter = Counter.builder("orders.processing.completed")
            .description("Orders processed successfully by the worker")
            .register(meterRegistry);

        ordersFailedCounter = Counter.builder("orders.processing.failed")
            .description("Orders that failed permanently (sent to DLQ)")
            .register(meterRegistry);

        processingDurationTimer = Timer.builder("orders.processing.duration")
            .description("Time from message receive to order status update")
            .publishPercentiles(0.5, 0.95, 0.99)
            .register(meterRegistry);
    }

    public void process(OrderCreatedEvent event) {
        processingDurationTimer.record(() -> {
            try {
                doProcess(event);
                ordersCompletedCounter.increment();
            } catch (PermanentProcessingException ex) {
                ordersFailedCounter.increment();
                log.error("Permanent failure for orderId={}", event.orderId(), ex);
                throw ex;   // let caller handle DLQ routing
            }
        });
    }

    private void doProcess(OrderCreatedEvent event) {
        Order order = orderRepository.findById(event.orderId())
            .orElseThrow(() -> new OrderNotFoundException(event.orderId()));

        if (order.getStatus() != OrderStatus.PENDING) {
            log.info("Skipping already-processed order: orderId={} status={}",
                event.orderId(), order.getStatus());
            return;   // idempotent — worker crashed and redelivered
        }

        order.transitionTo(OrderStatus.PROCESSING);
        orderRepository.save(order);

        inventoryCheck(order);
        paymentAuthorization(order);

        order.transitionTo(OrderStatus.COMPLETED);
        orderRepository.save(order);
        log.info("Order completed: orderId={}", order.getId());
    }
}
```

---

## Reading Your Metrics

With `management.endpoints.web.exposure.include=health,info,metrics,prometheus` in `application.yml`:

```bash
# List all registered metric names
curl http://localhost:8081/actuator/metrics

# Inspect a specific metric
curl http://localhost:8081/actuator/metrics/orders.created.total
```

Response:
```json
{
  "name": "orders.created.total",
  "description": "Orders successfully created and published",
  "measurements": [
    { "statistic": "COUNT", "value": 142.0 }
  ],
  "availableTags": [
    { "tag": "service", "values": ["order-api"] }
  ]
}
```

---

## Common Mistakes

**Incrementing counter before the operation succeeds:**

❌
```java
ordersCreatedCounter.increment();
orderRepository.save(order);  // if this throws, counter is wrong
eventPublisher.publish(order);
```

✅ Increment only after all operations succeed. Inside `Timer.record()` the counter increments at the end of the lambda.

**Using Timer for things that are not durations:**

❌ Using a Timer to count events
✅ Use Counter for counting, Timer for latency

**High-cardinality tags:**

❌ `.tag("orderId", order.getId().toString())` — millions of time series
✅ `.tag("service", "order-api")` — a handful of values

**Not publishing percentiles:**

❌ `Timer.builder("orders.creation.duration").register(registry)` — only gives count and total; you cannot compute P99
✅ `.publishPercentiles(0.5, 0.95, 0.99)` — pre-computes percentiles in-process (works without Prometheus histograms)

**Note:** `.publishPercentiles()` is client-side. For accurate percentiles across multiple pod instances, use `.publishPercentileHistogram(true)` and compute with `histogram_quantile()` in Prometheus. For this course, client-side is sufficient.

---

## Exercise 7.2

Add the following to `order-api`:

1. A `Counter` named `orders.validation.failed` that increments when `@Valid` throws `MethodArgumentNotValidException` in the global exception handler
2. A `Gauge` named `orders.idempotency.cache.size` that reflects the current count of active idempotency records in the database

Write a test (using `SimpleMeterRegistry`) that verifies:
- `orders.validation.failed` increments when `createOrder` is called with an invalid request
- The gauge reflects the actual count from a mock repository

### Answer

**Global exception handler addition:**
```java
// api/GlobalExceptionHandler.java (addition)
@RestControllerAdvice
public class GlobalExceptionHandler {

    private final Counter validationFailedCounter;

    public GlobalExceptionHandler(MeterRegistry meterRegistry) {
        this.validationFailedCounter = Counter.builder("orders.validation.failed")
            .description("Requests rejected due to invalid input")
            .register(meterRegistry);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ErrorResponse handleValidation(MethodArgumentNotValidException ex) {
        validationFailedCounter.increment();
        List<FieldError> fieldErrors = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> new FieldError(fe.getField(), fe.getDefaultMessage()))
            .toList();
        return ErrorResponse.validationError(fieldErrors);
    }
}
```

**Gauge for idempotency cache size:**
```java
// service/IdempotencyService.java (addition)
public class IdempotencyService {

    private final IdempotencyRepository repository;

    public IdempotencyService(IdempotencyRepository repository, MeterRegistry meterRegistry) {
        this.repository = repository;
        // Gauge reads the live count — re-evaluated every scrape
        Gauge.builder("orders.idempotency.cache.size", repository, IdempotencyRepository::count)
            .description("Active idempotency records in the database")
            .register(meterRegistry);
    }
}
```

**Test:**
```java
class OrderMetricsTest {

    private SimpleMeterRegistry registry;
    private OrderService orderService;

    @BeforeEach
    void setUp() {
        registry = new SimpleMeterRegistry();
        // wire up with mocks ...
    }

    @Test
    void validationFailedCounter_incrementsOnInvalidRequest() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler(registry);

        // simulate validation failure
        MethodArgumentNotValidException ex = mock(MethodArgumentNotValidException.class);
        when(ex.getBindingResult()).thenReturn(mock(BindingResult.class));
        handler.handleValidation(ex);

        assertThat(registry.counter("orders.validation.failed").count()).isEqualTo(1.0);
    }

    @Test
    void idempotencyCacheGauge_reflectsRepositoryCount() {
        IdempotencyRepository repo = mock(IdempotencyRepository.class);
        when(repo.count()).thenReturn(42L);

        new IdempotencyService(repo, registry);

        assertThat(registry.get("orders.idempotency.cache.size").gauge().value()).isEqualTo(42.0);
    }
}
```

`SimpleMeterRegistry` is in-memory, requires no Prometheus or Spring context, and is ideal for unit testing metric behavior.

---

## Interview Mode

**Question:** *"How do you add custom metrics to a Spring Boot service?"*

> "Micrometer is the abstraction layer built into Spring Boot — you register metrics against a `MeterRegistry` and Micrometer delegates to whichever backend is configured. For Prometheus it's a registry that exposes a scrape endpoint; for CloudWatch it's a registry that pushes metrics asynchronously.
>
> The types I use most: Counter for business events like orders created or messages failed, and Timer for end-to-end latency with P50/P95/P99 percentiles. The key decision is tag cardinality — tags must have a small fixed set of values. If I tag by orderId I get millions of time series, which breaks Prometheus.
>
> For `order-api` I have three metrics: `orders.created.total` counter, `orders.creation.duration` timer that wraps the full create-and-publish path, and `orders.duplicate.total` for idempotency key reuse. In the worker: completed and failed counters plus processing duration. These are what drive alerts — DLQ depth above zero pages the on-call engineer immediately."

---

*Next: [7.3 — Prometheus & Actuator](./03-prometheus-actuator.md)*
