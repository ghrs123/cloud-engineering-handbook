# 4.3 — Building the `order-worker`

> **Capstone connection:** This is the full implementation of `order-worker` — the service that consumes `OrderCreatedEvent`, runs the processing steps, and transitions the order to `COMPLETED` or `FAILED`. After this chapter, the end-to-end flow works.

---

## Package Structure

```
src/main/java/com/example/orderworker/
├── OrderWorkerApplication.java
├── consumer/
│   └── OrderEventConsumer.java       ← SQS listener (from Chapter 4.2)
├── processor/
│   └── OrderProcessor.java           ← Orchestrates steps, handles transitions
├── steps/
│   ├── ProcessingStep.java           ← Interface
│   ├── InventoryCheckStep.java       ← Mocked step
│   └── PaymentAuthStep.java          ← Mocked step with simulated failure
├── service/
│   └── OrderStatusService.java       ← Updates order status in DB
├── domain/
│   ├── Order.java                    ← Same entity as order-api (shared schema)
│   ├── OrderStatus.java
│   └── OrderItem.java
├── repository/
│   └── OrderRepository.java
├── messaging/
│   └── event/
│       └── OrderCreatedEvent.java    ← Same record as order-api
└── config/
    └── AwsSqsConfig.java
```

---

## `OrderProcessor` — The Core

```java
// processor/OrderProcessor.java
@Service
@RequiredArgsConstructor
@Slf4j
public class OrderProcessor {

    private final OrderStatusService orderStatusService;
    private final List<ProcessingStep> steps;   // Spring injects all ProcessingStep beans

    public void process(OrderCreatedEvent event) {
        UUID orderId = event.orderId();

        // ── Guard: idempotency check ─────────────────────────────
        // If we receive a duplicate event, the order is already PROCESSING or beyond.
        // Skip to avoid double-processing.
        Order order = orderStatusService.findById(orderId)
            .orElseThrow(() -> {
                log.error("Order not found in DB: orderId={} — event may be orphaned", orderId);
                throw new IllegalStateException("Order not found: " + orderId);
            });

        if (order.getStatus() != OrderStatus.PENDING) {
            log.warn("Order already processed or in unexpected state: orderId={} status={}",
                orderId, order.getStatus());
            // Return normally so the message is deleted (not retried)
            return;
        }

        // ── Transition to PROCESSING ─────────────────────────────
        orderStatusService.markProcessing(orderId);
        log.info("Order processing started: orderId={}", orderId);

        // ── Execute steps ────────────────────────────────────────
        try {
            for (ProcessingStep step : steps) {
                log.info("Executing step: orderId={} step={}", orderId, step.name());
                step.execute(event);
                log.info("Step completed: orderId={} step={}", orderId, step.name());
            }

            // ── All steps succeeded ──────────────────────────────
            orderStatusService.markCompleted(orderId);
            log.info("Order processing completed: orderId={}", orderId);

        } catch (TransientProcessingException ex) {
            // Transient failure — rethrow so @SqsListener does NOT delete the message
            // SQS will retry after visibility timeout
            log.warn("Transient failure processing order: orderId={} reason={}",
                orderId, ex.getMessage());
            // Reset to PENDING so retry can pick it up cleanly
            orderStatusService.markPending(orderId);
            throw ex;    // ← propagates to consumer, message not deleted, SQS retries

        } catch (Exception ex) {
            // Permanent failure — mark FAILED, let message go to DLQ
            log.error("Permanent failure processing order: orderId={}", orderId, ex);
            orderStatusService.markFailed(orderId);
            // Return normally — message is deleted from main queue
            // After maxReceiveCount retries it went to DLQ (handled by redrive policy)
        }
    }
}
```

### Why separate `TransientProcessingException` from general `Exception`?

| Exception type | Behavior | Reason |
|---|---|---|
| `TransientProcessingException` | Rethrow → message stays → SQS retries | Downstream temporarily unavailable, DB timeout, network blip |
| `Exception` (permanent) | Swallow → message deleted | Bug in processing logic, invalid data — retrying won't help |

The caller (`@SqsListener` with `ON_SUCCESS`) deletes the message only when the method returns normally. If you always rethrow, every failure is retried until it hits DLQ. If you always swallow, permanent failures are silently lost. The distinction is deliberate.

---

## `ProcessingStep` Interface

```java
// steps/ProcessingStep.java
public interface ProcessingStep {
    String name();
    void execute(OrderCreatedEvent event) throws TransientProcessingException;
}
```

```java
// steps/InventoryCheckStep.java
@Component
@Slf4j
public class InventoryCheckStep implements ProcessingStep {

    @Override
    public String name() { return "inventory-check"; }

    @Override
    public void execute(OrderCreatedEvent event) {
        log.debug("Checking inventory for {} items", event.items().size());
        // Mock: always succeeds for the capstone
        // In production: call inventory service or check a DB table
        simulateWork(50);  // 50ms
    }

    private void simulateWork(long ms) {
        try { Thread.sleep(ms); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
```

```java
// steps/PaymentAuthStep.java
@Component
@Slf4j
public class PaymentAuthStep implements ProcessingStep {

    // Simulates a 20% chance of transient failure — for testing retry behavior
    private static final double TRANSIENT_FAILURE_RATE = 0.0;  // Set to 0.2 to enable

    @Override
    public String name() { return "payment-authorization"; }

    @Override
    public void execute(OrderCreatedEvent event) throws TransientProcessingException {
        log.debug("Authorizing payment: totalAmount={}", event.totalAmount());

        if (Math.random() < TRANSIENT_FAILURE_RATE) {
            throw new TransientProcessingException(
                "Payment gateway temporarily unavailable");
        }

        simulateWork(100);  // 100ms
        log.debug("Payment authorized: orderId={}", event.orderId());
    }

    private void simulateWork(long ms) {
        try { Thread.sleep(ms); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
```

```java
// steps/TransientProcessingException.java
public class TransientProcessingException extends RuntimeException {
    public TransientProcessingException(String message) {
        super(message);
    }
    public TransientProcessingException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

---

## `OrderStatusService`

```java
// service/OrderStatusService.java
@Service
@RequiredArgsConstructor
@Slf4j
public class OrderStatusService {

    private final OrderRepository orderRepository;

    @Transactional(readOnly = true)
    public Optional<Order> findById(UUID orderId) {
        return orderRepository.findById(orderId);
    }

    @Transactional
    public void markProcessing(UUID orderId) {
        orderRepository.findById(orderId).ifPresent(order -> {
            order.markProcessing();
            orderRepository.save(order);
        });
    }

    @Transactional
    public void markCompleted(UUID orderId) {
        orderRepository.findById(orderId).ifPresent(order -> {
            order.markCompleted();
            orderRepository.save(order);
            log.info("Order marked COMPLETED: orderId={}", orderId);
        });
    }

    @Transactional
    public void markFailed(UUID orderId) {
        orderRepository.findById(orderId).ifPresent(order -> {
            order.markFailed();
            orderRepository.save(order);
            log.warn("Order marked FAILED: orderId={}", orderId);
        });
    }

    @Transactional
    public void markPending(UUID orderId) {
        // Reset to PENDING for retry (only valid from PROCESSING)
        orderRepository.findById(orderId).ifPresent(order -> {
            if (order.getStatus() == OrderStatus.PROCESSING) {
                // Direct status reset for retry path — bypass normal state machine
                order.resetToPending();
                orderRepository.save(order);
            }
        });
    }
}
```

---

## `order-worker` `application.yml`

```yaml
# application.yml
spring:
  application:
    name: order-worker
  datasource:
    url: ${SPRING_DATASOURCE_URL:jdbc:postgresql://localhost:5432/orderdb}
    username: ${SPRING_DATASOURCE_USERNAME:orderuser}
    password: ${SPRING_DATASOURCE_PASSWORD:orderpass}
    hikari:
      maximum-pool-size: 10
      minimum-idle: 2
  jpa:
    hibernate:
      ddl-auto: validate
    open-in-view: false
  cloud:
    aws:
      region:
        static: ${AWS_REGION:us-east-1}
      credentials:
        access-key: ${AWS_ACCESS_KEY_ID:test}
        secret-key: ${AWS_SECRET_ACCESS_KEY:test}
      sqs:
        endpoint: ${AWS_ENDPOINT_OVERRIDE:}

server:
  port: ${SERVER_PORT:8081}      # Different port from order-api
  shutdown: graceful

management:
  server:
    port: ${MANAGEMENT_SERVER_PORT:8081}
  endpoints:
    web:
      exposure:
        include: health, prometheus
  endpoint:
    health:
      probes:
        enabled: true

sqs:
  order:
    queue-url: ${SQS_ORDER_QUEUE_URL}
    dlq-url: ${SQS_ORDER_DLQ_URL}

spring.lifecycle.timeout-per-shutdown-phase: 30s
```

---

## `order-worker` `pom.xml` (key dependencies)

```xml
<dependencies>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <!-- Web needed for Actuator HTTP endpoints even though worker is not a server -->
  </dependency>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-jpa</artifactId>
  </dependency>
  <dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
    <scope>runtime</scope>
  </dependency>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
  </dependency>
  <dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
  </dependency>
  <dependency>
    <groupId>io.awspring.cloud</groupId>
    <artifactId>spring-cloud-aws-starter-sqs</artifactId>
  </dependency>
  <dependency>
    <groupId>net.logstash.logback</groupId>
    <artifactId>logstash-logback-encoder</artifactId>
    <version>7.4</version>
  </dependency>
  <dependency>
    <groupId>org.projectlombok</groupId>
    <artifactId>lombok</artifactId>
    <optional>true</optional>
  </dependency>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
  </dependency>
</dependencies>
```

---

## Key Test: `OrderProcessorTest`

```java
@ExtendWith(MockitoExtension.class)
class OrderProcessorTest {

    @Mock OrderStatusService orderStatusService;
    @Mock InventoryCheckStep inventoryStep;
    @Mock PaymentAuthStep paymentStep;

    @InjectMocks OrderProcessor processor;

    private final UUID orderId = UUID.randomUUID();
    private OrderCreatedEvent event;
    private Order pendingOrder;

    @BeforeEach
    void setUp() {
        event = new OrderCreatedEvent(orderId, "cust-1",
            List.of(new OrderCreatedEvent.OrderItemEvent("X", 1)),
            BigDecimal.TEN, Instant.now());

        pendingOrder = Order.create("cust-1",
            List.of(OrderItem.of("X", 1)), BigDecimal.TEN);

        when(inventoryStep.name()).thenReturn("inventory-check");
        when(paymentStep.name()).thenReturn("payment-authorization");
        when(orderStatusService.findById(orderId)).thenReturn(Optional.of(pendingOrder));
    }

    @Test
    void process_happyPath_marksCompleted() throws Exception {
        processor.process(event);

        verify(orderStatusService).markProcessing(orderId);
        verify(inventoryStep).execute(event);
        verify(paymentStep).execute(event);
        verify(orderStatusService).markCompleted(orderId);
        verify(orderStatusService, never()).markFailed(orderId);
    }

    @Test
    void process_transientFailure_rethrowsAndResetsStatus() throws Exception {
        doThrow(new TransientProcessingException("timeout"))
            .when(paymentStep).execute(event);

        assertThatThrownBy(() -> processor.process(event))
            .isInstanceOf(TransientProcessingException.class);

        verify(orderStatusService).markProcessing(orderId);
        verify(orderStatusService).markPending(orderId);   // reset for retry
        verify(orderStatusService, never()).markCompleted(orderId);
        verify(orderStatusService, never()).markFailed(orderId);
    }

    @Test
    void process_permanentFailure_marksFailed() throws Exception {
        doThrow(new RuntimeException("data error"))
            .when(inventoryStep).execute(event);

        // Should NOT throw — permanent failure is handled, message gets deleted
        assertThatNoException().isThrownBy(() -> processor.process(event));

        verify(orderStatusService).markFailed(orderId);
        verify(orderStatusService, never()).markCompleted(orderId);
    }

    @Test
    void process_duplicateEvent_skipsProcessing() {
        // Simulate order already COMPLETED (duplicate event)
        Order completedOrder = Order.create("cust-1",
            List.of(OrderItem.of("X", 1)), BigDecimal.TEN);
        completedOrder.markProcessing();
        completedOrder.markCompleted();

        when(orderStatusService.findById(orderId)).thenReturn(Optional.of(completedOrder));

        processor.process(event);

        verify(orderStatusService, never()).markProcessing(orderId);
        verify(inventoryStep, never()).execute(any());
    }
}
```

These four tests cover the complete processing state machine without needing a database or SQS connection. They run in milliseconds.

---

## Interview Mode

**Question:** *"What happens if your order-worker crashes while processing an order?"*

**90-second answer:**
> "The SQS visibility timeout handles this. When `order-worker` receives a message, SQS makes it invisible for 30 seconds. If the worker crashes before calling delete, the visibility timeout expires and SQS makes the message visible again. Another worker instance picks it up and retries.
>
> The worker handles this with an idempotency check at the start: it reads the current order status from the database. If the order is already `PROCESSING` or `COMPLETED` — meaning a previous attempt partially or fully executed — it handles accordingly. If it's still `PENDING`, it proceeds normally. If it's `PROCESSING`, it means we crashed mid-way, so we reset to `PENDING` and retry the full processing.
>
> For transient failures — downstream service temporarily unavailable — I throw the exception so `@SqsListener` doesn't delete the message. SQS retries automatically. After 3 failures (our `maxReceiveCount`), SQS moves the message to the DLQ. We alert on DLQ depth, investigate, and replay after fixing the issue."

---

*Next: [Chapter 4.4 — RDS & Database Patterns →](./04-rds-patterns.md)*
