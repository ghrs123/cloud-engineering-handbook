# 4.2 — Spring Boot + SQS Integration

> **Capstone connection:** This chapter implements the `OrderEventPublisher` in `order-api` and the SQS consumer base in `order-worker`. By the end, `order-api` publishes events and `order-worker` receives them.

---

## Dependencies

Add to both `order-api` and `order-worker` `pom.xml`:

```xml
<!-- Spring Cloud AWS BOM — manages versions for all spring-cloud-aws-* -->
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>io.awspring.cloud</groupId>
      <artifactId>spring-cloud-aws-dependencies</artifactId>
      <version>3.1.1</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <!-- SQS integration -->
  <dependency>
    <groupId>io.awspring.cloud</groupId>
    <artifactId>spring-cloud-aws-starter-sqs</artifactId>
  </dependency>

  <!-- JSON serialization for messages -->
  <dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
  </dependency>
  <dependency>
    <groupId>com.fasterxml.jackson.datatype</groupId>
    <artifactId>jackson-datatype-jsr310</artifactId>
  </dependency>
</dependencies>
```

---

## Configuration

```yaml
# application.yml (both services)
spring:
  cloud:
    aws:
      region:
        static: ${AWS_REGION:us-east-1}
      credentials:
        # In production: use IRSA (pod identity) — no keys needed
        # In local dev: dummy values work with LocalStack
        access-key: ${AWS_ACCESS_KEY_ID:test}
        secret-key: ${AWS_SECRET_ACCESS_KEY:test}
      sqs:
        # Only set for LocalStack — omit in production (uses real AWS endpoint)
        endpoint: ${AWS_ENDPOINT_OVERRIDE:}

sqs:
  order:
    queue-url: ${SQS_ORDER_QUEUE_URL}
    dlq-url: ${SQS_ORDER_DLQ_URL}
```

```java
// config/AwsSqsConfig.java
@Configuration
public class AwsSqsConfig {

    // spring-cloud-aws auto-configures SqsTemplate and SqsAsyncClient
    // This bean configures the ObjectMapper used for message serialization
    @Bean
    public SqsMessageConverter sqsMessageConverter(ObjectMapper objectMapper) {
        return new SqsMessagingMessageConverter(objectMapper);
    }
}
```

---

## The Event Type — Shared Contract

Define `OrderCreatedEvent` in both services (or extract to `libs/common-messaging/` for a real project). Records are ideal — immutable, serialization-friendly:

```java
// domain/event/OrderCreatedEvent.java (order-api)
// messaging/event/OrderCreatedEvent.java (order-worker — same structure)
public record OrderCreatedEvent(
    UUID orderId,
    String customerId,
    List<OrderItemEvent> items,
    BigDecimal totalAmount,
    Instant createdAt
) {
    public record OrderItemEvent(String sku, int qty) {}
}
```

**Why duplicate the record?** In a real project, extract to a shared library (`common-messaging`). For the capstone, keeping services independent is simpler. Both records must have identical field names and types for Jackson to deserialize correctly.

---

## Publisher — `order-api`

```java
// messaging/OrderEventPublisher.java
@Component
@RequiredArgsConstructor
@Slf4j
public class OrderEventPublisher {

    private final SqsTemplate sqsTemplate;

    @Value("${sqs.order.queue-url}")
    private String queueUrl;

    public void publishOrderCreated(Order order) {
        String correlationId = MDC.get("correlationId");

        OrderCreatedEvent event = new OrderCreatedEvent(
            order.getId(),
            order.getCustomerId(),
            order.getItems().stream()
                .map(i -> new OrderCreatedEvent.OrderItemEvent(i.getSku(), i.getQty()))
                .toList(),
            order.getTotalAmount(),
            order.getCreatedAt()
        );

        try {
            sqsTemplate.send(to -> to
                .queue(queueUrl)
                .payload(event)
                // Metadata as message attributes — not in the business payload
                .header("correlationId", correlationId != null ? correlationId : "unknown")
                .header("version", "1.0")
                .header("source", "order-api")
            );

            log.info("OrderCreatedEvent published: orderId={} correlationId={}",
                order.getId(), correlationId);

        } catch (Exception ex) {
            // Publishing failure should NOT fail the HTTP request.
            // The order is already saved. Log the error and let monitoring alert.
            // In production, consider the transactional outbox pattern for guaranteed delivery.
            log.error("Failed to publish OrderCreatedEvent: orderId={}", order.getId(), ex);
            // Don't rethrow — the order is persisted, the client has their 202
        }
    }
}
```

**Key design decision — should a publish failure fail the HTTP request?**

If you throw an exception, the transaction rolls back and the order is not saved. The client gets a 500 even though nothing is actually wrong with their order data.

If you swallow the exception (as above), the order is saved but the worker never processes it. The order stays in `PENDING` forever.

**Production solution:** the **Transactional Outbox Pattern**. Instead of publishing directly to SQS, write to an `outbox` table in the same transaction as the order insert. A separate process reads the outbox and publishes to SQS. Guaranteed delivery without distributed transactions. Documented in the appendix — not required for this capstone.

For the capstone: swallow the exception, log at ERROR, and add a monitoring alert on the error log pattern.

---

## Wire the Publisher into `OrderService`

```java
// service/OrderService.java — updated
@Service
@RequiredArgsConstructor
@Slf4j
public class OrderService {

    private final OrderRepository orderRepository;
    private final IdempotencyService idempotencyService;
    private final OrderEventPublisher eventPublisher;    // ← added

    @Transactional
    public CreateOrderResponse createOrder(CreateOrderRequest request, String idempotencyKey) {
        return idempotencyService.executeIfNew(idempotencyKey, () -> {
            List<OrderItem> items = request.items().stream()
                .map(i -> OrderItem.of(i.sku(), i.qty()))
                .toList();

            Order order = Order.create(request.customerId(), items, request.totalAmount());
            orderRepository.save(order);

            MDC.put("orderId", order.getId().toString());
            log.info("Order created: customerId={} totalAmount={} itemCount={}",
                order.getCustomerId(), order.getTotalAmount(), items.size());

            // Publish AFTER the transaction commits
            // Note: with @Transactional, this runs within the transaction.
            // For guaranteed delivery, use TransactionSynchronization or Outbox pattern.
            eventPublisher.publishOrderCreated(order);

            return CreateOrderResponse.from(order, MDC.get("correlationId"));
        });
    }
}
```

**Important nuance:** calling `publishOrderCreated` inside `@Transactional` means if the SQS call fails and you throw, the transaction (and order insert) rolls back. Since we're swallowing the exception, the order is committed regardless. This is the "best effort" delivery approach.

---

## Consumer — `order-worker`

`spring-cloud-aws` provides `@SqsListener` — a Spring annotation that manages polling, threading, and message deletion automatically:

```java
// consumer/OrderEventConsumer.java
@Component
@RequiredArgsConstructor
@Slf4j
public class OrderEventConsumer {

    private final OrderProcessor orderProcessor;

    @SqsListener(value = "${sqs.order.queue-url}",
                 acknowledgementMode = SqsListenerAcknowledgementMode.ON_SUCCESS)
    public void onOrderCreated(
            @Payload OrderCreatedEvent event,
            @Header("correlationId") String correlationId) {

        // Restore correlationId to MDC for this processing thread
        MDC.put("correlationId", correlationId);
        MDC.put("orderId", event.orderId().toString());

        try {
            log.info("Received OrderCreatedEvent: orderId={}", event.orderId());
            orderProcessor.process(event);
            // ON_SUCCESS mode: message is automatically deleted after this method returns normally
        } catch (Exception ex) {
            // Let exception propagate — ON_SUCCESS mode will NOT delete the message
            // SQS will make it visible again after visibility timeout → automatic retry
            log.error("Failed to process OrderCreatedEvent: orderId={}", event.orderId(), ex);
            throw ex;
        } finally {
            MDC.clear();
        }
    }
}
```

### `acknowledgementMode` — The Critical Setting

| Mode | Message deleted when | Use when |
|---|---|---|
| `ON_SUCCESS` | Method returns normally (no exception) | Most cases — SQS handles retry on exception |
| `MANUAL` | You call `Acknowledgement.acknowledge()` | Complex flows where you need fine-grained control |
| `ALWAYS` | Always, even on exception | When you handle retries yourself (e.g., Resilience4j) |

**Use `ON_SUCCESS`** for `order-worker`. If processing throws an exception, the message is not deleted → visibility timeout expires → SQS makes it visible again → another consumer (or the same one) retries. After `maxReceiveCount` retries, SQS moves it to the DLQ automatically.

---

## SQS Listener Configuration

Control concurrency, batch size, and polling behavior:

```java
// config/AwsSqsConfig.java
@Configuration
public class AwsSqsConfig {

    @Bean
    public SqsListenerConfigurer sqsListenerConfigurer() {
        return registrar -> registrar.configure(factory -> factory
            .configure(options -> options
                .maxConcurrentMessages(10)    // Up to 10 messages processed simultaneously
                .maxMessagesPerPoll(10)       // Receive up to 10 per SQS API call (batch)
                .pollTimeout(Duration.ofSeconds(20))  // Long polling
            )
        );
    }
}
```

**`maxConcurrentMessages: 10` and `maxMessagesPerPoll: 10`** means one SQS API call fetches 10 messages, and all 10 are processed concurrently in a thread pool. With 2 replicas of `order-worker`, that's up to 20 concurrent order processings.

**Trade-off:** higher concurrency = higher database connection pool load. If each worker opens a DB connection during processing, 20 concurrent processings = 20 connections per pod. With 2 pods = 40 connections. Ensure HikariCP's `maximum-pool-size` is set accordingly.

---

## Exercise 4.2

**Task:** Verify the publisher-consumer pipeline with LocalStack.

```bash
# Start LocalStack (if not using docker-compose)
docker run -d -p 4566:4566 -e SERVICES=sqs localstack/localstack:3

# Create queues
./capstone/docker/localstack-init.sh

# Start order-api (dev profile)
SPRING_PROFILES_ACTIVE=dev \
AWS_ENDPOINT_OVERRIDE=http://localhost:4566 \
./mvnw spring-boot:run -pl services/order-api

# Start order-worker (dev profile) in another terminal
SPRING_PROFILES_ACTIVE=dev \
AWS_ENDPOINT_OVERRIDE=http://localhost:4566 \
./mvnw spring-boot:run -pl services/order-worker

# Create an order
curl -s -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "X-API-Key: dev-secret-key" \
  -d '{"customerId":"cust-1","items":[{"sku":"X","qty":1}],"totalAmount":10.00}'

# Check order status (should eventually be COMPLETED)
ORDER_ID="<id from above>"
sleep 3 && curl -s http://localhost:8080/orders/$ORDER_ID \
  -H "X-API-Key: dev-secret-key" | jq .status
```

**Expected:** `"COMPLETED"` within a few seconds.

**Verify in LocalStack:**
```bash
# Queue should be empty after successful processing
aws --endpoint-url=http://localhost:4566 --region us-east-1 \
  sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/order-created-queue \
  --attribute-names ApproximateNumberOfMessages
# Expected: "ApproximateNumberOfMessages": "0"
```

---

## Interview Mode

**Question:** *"How does your order-worker consume messages from SQS?"*

**90-second answer:**
> "I use Spring Cloud AWS's `@SqsListener` annotation. It manages the polling loop, threading, and message lifecycle. I set `acknowledgementMode: ON_SUCCESS` — the message is only deleted after the handler method returns normally. If it throws, the message stays in the queue and SQS makes it visible again after the visibility timeout expires. That's the automatic retry mechanism.
>
> The listener is configured with long polling — 20-second wait time — and a batch size of 10. One SQS API call receives up to 10 messages, and they're processed concurrently in a thread pool. This is more efficient than polling for one message at a time.
>
> I propagate the `correlationId` from the SQS message attribute to the MDC at the start of each processing. That way, every log line during processing carries the same correlation ID that was set when the original HTTP request created the order in `order-api`. You can trace the full lifecycle across both services from a single ID."

---

*Next: [Chapter 4.3 — Building the order-worker →](./03-order-worker.md)*
