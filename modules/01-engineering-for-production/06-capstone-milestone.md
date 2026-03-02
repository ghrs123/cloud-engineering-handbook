# 1.6 — Capstone Milestone M1

> **Deliverable:** A runnable `order-api` Spring Boot service. `POST /orders` accepts, validates, persists, and returns `202 Accepted`. `GET /orders/{id}` returns current order state. Actuator health probes return `UP`. All logs are structured with `correlationId`.

---

## Verification Checklist

Before moving to Module 2, every item below must pass.

- [ ] `./mvnw clean verify` passes with no test failures
- [ ] `./mvnw spring-boot:run` starts with `SPRING_PROFILES_ACTIVE=dev`
- [ ] `POST /orders` with valid payload returns `202 Accepted` with `orderId`
- [ ] `POST /orders` without `Idempotency-Key` header returns `400 Bad Request` with `code: "MISSING_HEADER"`
- [ ] `POST /orders` with invalid payload returns `400 Bad Request` with `code: "VALIDATION_ERROR"` and populated `errors` array
- [ ] `GET /orders/{valid-id}` returns `200 OK` with order data
- [ ] `GET /orders/{nonexistent-id}` returns `404 Not Found` with `code: "ORDER_NOT_FOUND"`
- [ ] `GET /actuator/health/readiness` returns `200 {"status":"UP"}`
- [ ] `GET /actuator/health/liveness` returns `200 {"status":"UP"}`
- [ ] Response headers include `X-Correlation-Id` on every response
- [ ] Application log output includes `correlationId` field in every log line
- [ ] No JPA entity appears in any controller response (verified by reviewing return types)

---

## `pom.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.3.2</version>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>order-api</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <name>order-api</name>

    <properties>
        <java.version>21</java.version>
    </properties>

    <dependencies>
        <!-- Web -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>

        <!-- Data -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>

        <!-- Validation -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>

        <!-- Actuator -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-actuator</artifactId>
        </dependency>
        <dependency>
            <groupId>io.micrometer</groupId>
            <artifactId>micrometer-registry-prometheus</artifactId>
        </dependency>

        <!-- Structured logging -->
        <dependency>
            <groupId>net.logstash.logback</groupId>
            <artifactId>logstash-logback-encoder</artifactId>
            <version>7.4</version>
        </dependency>

        <!-- API documentation -->
        <dependency>
            <groupId>org.springdoc</groupId>
            <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
            <version>2.5.0</version>
        </dependency>

        <!-- Utilities -->
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>

        <!-- Test -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>com.h2database</groupId>
            <artifactId>h2</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <excludes>
                        <exclude>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                        </exclude>
                    </excludes>
                </configuration>
            </plugin>
        </plugins>
    </build>

</project>
```

---

## Complete `OrderController`

```java
// api/controller/OrderController.java
@RestController
@RequestMapping("/orders")
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Orders", description = "Order management endpoints")
public class OrderController {

    private final OrderService orderService;

    @PostMapping
    @Operation(summary = "Create a new order",
        description = "Returns 202 Accepted immediately. Processing happens asynchronously.")
    @ApiResponse(responseCode = "202", description = "Order accepted for processing")
    @ApiResponse(responseCode = "400", description = "Validation error or missing Idempotency-Key")
    public ResponseEntity<CreateOrderResponse> createOrder(
            @RequestBody @Valid CreateOrderRequest request,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @RequestHeader("X-API-Key") String apiKey) {

        CreateOrderResponse response = orderService.createOrder(request, idempotencyKey);
        return ResponseEntity.accepted().body(response);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get order by ID")
    @ApiResponse(responseCode = "200", description = "Order found")
    @ApiResponse(responseCode = "404", description = "Order not found")
    public ResponseEntity<OrderResponse> getOrder(
            @PathVariable UUID id,
            @RequestHeader("X-API-Key") String apiKey) {

        OrderResponse response = orderService.getOrder(id);
        return ResponseEntity.ok(response);
    }
}
```

---

## Complete `OrderService`

```java
// service/OrderService.java
@Service
@RequiredArgsConstructor
@Slf4j
public class OrderService {

    private final OrderRepository orderRepository;
    private final IdempotencyService idempotencyService;

    @Transactional
    public CreateOrderResponse createOrder(CreateOrderRequest request, String idempotencyKey) {
        return idempotencyService.executeIfNew(idempotencyKey, () -> {
            List<OrderItem> items = request.items().stream()
                .map(i -> OrderItem.of(i.sku(), i.qty()))
                .toList();

            Order order = Order.create(request.customerId(), items, request.totalAmount());
            orderRepository.save(order);

            String correlationId = MDC.get("correlationId");
            MDC.put("orderId", order.getId().toString());

            log.info("Order created: customerId={} totalAmount={} itemCount={}",
                order.getCustomerId(), order.getTotalAmount(), items.size());

            // Event publishing added in Module 4
            return CreateOrderResponse.from(order, correlationId);
        });
    }

    @Transactional(readOnly = true)
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

---

## Complete `IdempotencyService`

```java
// service/IdempotencyService.java
@Service
@RequiredArgsConstructor
@Slf4j
public class IdempotencyService {

    private final IdempotencyKeyRepository idempotencyKeyRepository;
    private final ObjectMapper objectMapper;

    @Transactional
    public <T> T executeIfNew(String key, Supplier<T> operation) {
        return idempotencyKeyRepository.findById(key)
            .map(record -> {
                log.debug("Returning cached response for idempotency key: {}", key);
                return objectMapper.convertValue(record.getResponse(), (Class<T>) Object.class);
            })
            .orElseGet(() -> {
                T result = operation.get();
                idempotencyKeyRepository.save(
                    IdempotencyKey.of(key, objectMapper.valueToTree(result))
                );
                return result;
            });
    }
}
```

---

## `IdempotencyKey` Entity

```java
// domain/IdempotencyKey.java
@Entity
@Table(name = "idempotency_keys")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IdempotencyKey {

    @Id
    private String key;

    @Column(nullable = false, columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private JsonNode response;

    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    public static IdempotencyKey of(String key, JsonNode response) {
        IdempotencyKey ik = new IdempotencyKey();
        ik.key = key;
        ik.response = response;
        ik.createdAt = Instant.now();
        return ik;
    }
}
```

---

## Database Schema (Flyway)

Add Flyway to `pom.xml`:
```xml
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-core</artifactId>
</dependency>
<dependency>
    <groupId>org.flywaydb</groupId>
    <artifactId>flyway-database-postgresql</artifactId>
</dependency>
```

```sql
-- src/main/resources/db/migration/V1__create_orders.sql
CREATE TABLE orders (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  VARCHAR(255) NOT NULL,
    status       VARCHAR(50)  NOT NULL,
    total_amount NUMERIC(10,2) NOT NULL,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id  UUID NOT NULL REFERENCES orders(id),
    sku       VARCHAR(255) NOT NULL,
    qty       INTEGER NOT NULL CHECK (qty > 0)
);

CREATE TABLE idempotency_keys (
    key        VARCHAR(255) PRIMARY KEY,
    response   JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
```

---

## Quick Smoke Test

```bash
# Start dependencies (postgres only for M1)
docker run -d \
  -e POSTGRES_DB=orderdb \
  -e POSTGRES_USER=orderuser \
  -e POSTGRES_PASSWORD=orderpass \
  -p 5432:5432 \
  postgres:16-alpine

# Start the service
SPRING_PROFILES_ACTIVE=dev ./mvnw spring-boot:run

# Create an order
IKEY=$(uuidgen)
curl -s -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IKEY" \
  -H "X-API-Key: dev-secret-key" \
  -d '{
    "customerId": "cust-test-1",
    "items": [{"sku": "PROD-001", "qty": 2}],
    "totalAmount": 59.90
  }' | jq .
# Expected: {"orderId":"...","status":"PENDING","correlationId":"req-..."}

# Get order status
ORDER_ID="<orderId from above>"
curl -s http://localhost:8080/orders/$ORDER_ID \
  -H "X-API-Key: dev-secret-key" | jq .
# Expected: full order object with status PENDING

# Test idempotency — same key, same response
curl -s -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IKEY" \
  -H "X-API-Key: dev-secret-key" \
  -d '{"customerId":"cust-test-1","items":[{"sku":"PROD-001","qty":2}],"totalAmount":59.90}' | jq .
# Expected: same orderId as before

# Health checks
curl -s http://localhost:8081/actuator/health/readiness | jq .
curl -s http://localhost:8081/actuator/health/liveness  | jq .
```

---

## What's Missing Until Module 4

The `order-worker` service is not implemented yet. Orders will stay in `PENDING` status. That is correct — Module 4 adds the event publishing and the worker.

The `SqsHealthIndicator` will fail unless you start LocalStack. Disable it for now:
```yaml
# application-dev.yml
management:
  health:
    sqs:
      enabled: false
```

---

*Module 1 complete. Move to [Module 2 — Containers & Runtime →](../02-containers-runtime/README.md)*
