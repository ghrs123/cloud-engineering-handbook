# 1.1 — Clean Architecture in Spring Boot

> **Capstone connection:** The `order-api` package structure you define here is the one that every other module builds on. Getting it right now saves you from painful refactors later.

---

## The Problem With "It Works"

Most Spring Boot tutorials end at "it works." The controller calls the repository, data comes back, test passes, ship it.

Production engineering starts a different question: *who changes this code in 6 months, under time pressure, and does not break something unexpected?*

Clean architecture in a Spring Boot microservice is not about implementing hexagonal architecture or following Clean Architecture by Robert Martin to the letter. It is about three practical rules:

1. **Each layer has one job.** Controllers handle HTTP. Services handle business logic. Repositories handle persistence.
2. **Dependencies flow inward.** The controller knows about the service. The service does not know about the controller. The domain knows about nothing.
3. **You can test each layer in isolation.** If you cannot unit test a service without spinning up a web server, the layers are wrong.

---

## The Layer Model

For a Spring Boot microservice at this scale, four layers are sufficient:

```
┌─────────────────────────────────────────┐
│  API Layer (api/)                        │
│  @RestController, DTOs, @ExceptionHandler│
│  Knows about: Service layer              │
│  Does not know: JPA entities, DB schema  │
├─────────────────────────────────────────┤
│  Service Layer (service/)                │
│  @Service, business logic, transactions  │
│  Knows about: Domain, Repository layer   │
│  Does not know: HTTP, request/response   │
├─────────────────────────────────────────┤
│  Domain Layer (domain/)                  │
│  @Entity, enums, domain events           │
│  Knows about: Nothing (pure Java)        │
├─────────────────────────────────────────┤
│  Repository Layer (repository/)          │
│  JpaRepository interfaces, queries       │
│  Knows about: Domain layer               │
└─────────────────────────────────────────┘
```

### What belongs in each layer

**`api/`**
- `@RestController` classes
- Request DTOs (`CreateOrderRequest`, `UpdateOrderRequest`)
- Response DTOs (`OrderResponse`, `CreateOrderResponse`)
- `@ControllerAdvice` / `@ExceptionHandler`
- API-level validation annotations

**`service/`**
- `@Service` classes with business logic
- Transaction management (`@Transactional`)
- Idempotency logic
- Event publishing orchestration
- Domain validation that depends on state (not just format)

**`domain/`**
- `@Entity` classes
- `@Embeddable` value objects
- Enums (`OrderStatus`, `ItemStatus`)
- Domain events (`OrderCreatedEvent`)
- No Spring annotations except JPA/persistence

**`repository/`**
- `JpaRepository` or `CrudRepository` interfaces
- Custom `@Query` annotations
- Spring Data projections

**`messaging/` (added in Module 4)**
- SQS publisher
- SQS message types

**`config/`**
- Spring `@Configuration` classes
- Security config
- AWS client beans
- Any `@Bean` definitions

**`common/`**
- Cross-cutting concerns: filters, interceptors
- `CorrelationIdFilter`
- Utility classes used across layers

---

## Package Structure for `order-api`

```
src/main/java/com/example/orderapi/
├── OrderApiApplication.java
├── api/
│   ├── controller/
│   │   └── OrderController.java
│   ├── dto/
│   │   ├── request/
│   │   │   └── CreateOrderRequest.java
│   │   └── response/
│   │       ├── CreateOrderResponse.java
│   │       └── OrderResponse.java
│   └── exception/
│       ├── GlobalExceptionHandler.java
│       └── ErrorResponse.java
├── service/
│   ├── OrderService.java
│   └── IdempotencyService.java
├── domain/
│   ├── Order.java
│   ├── OrderItem.java
│   ├── OrderStatus.java
│   └── event/
│       └── OrderCreatedEvent.java
├── repository/
│   ├── OrderRepository.java
│   └── IdempotencyKeyRepository.java
├── messaging/            ← added in Module 4
│   └── OrderEventPublisher.java
├── config/
│   └── SecurityConfig.java
└── common/
    └── filter/
        └── CorrelationIdFilter.java
```

---

## The Dependency Rule in Practice

### ✅ Correct

```java
// Controller knows about service — correct direction
@RestController
public class OrderController {
    private final OrderService orderService;  // ← points inward

    @PostMapping("/orders")
    public ResponseEntity<CreateOrderResponse> createOrder(
            @RequestBody @Valid CreateOrderRequest request,
            @RequestHeader("Idempotency-Key") String idempotencyKey) {
        CreateOrderResponse response = orderService.createOrder(request, idempotencyKey);
        return ResponseEntity.accepted().body(response);
    }
}
```

```java
// Service knows about domain and repository — correct
@Service
public class OrderService {
    private final OrderRepository orderRepository;   // ← points inward
    private final IdempotencyService idempotencyService;

    @Transactional
    public CreateOrderResponse createOrder(CreateOrderRequest request, String idempotencyKey) {
        return idempotencyService.executeIfNew(idempotencyKey, () -> {
            Order order = Order.create(request.customerId(), request.items(), request.totalAmount());
            orderRepository.save(order);
            // eventPublisher.publish(...) — added in Module 4
            return CreateOrderResponse.from(order);
        });
    }
}
```

### ❌ Wrong — anti-patterns that break production systems

**Anti-pattern 1: Returning JPA entity from controller**

```java
// DO NOT do this
@GetMapping("/orders/{id}")
public Order getOrder(@PathVariable UUID id) {  // ← returning @Entity directly
    return orderRepository.findById(id).orElseThrow();
}
```

Why this breaks: Jackson serializes the entire entity including lazy-loaded collections (triggering N+1 queries), Hibernate proxy objects that may fail outside a transaction, and internal fields you never intended to expose (audit fields, internal state). When you add a `password` field to `Order` later, it is automatically exposed.

**Anti-pattern 2: Business logic in controllers**

```java
// DO NOT do this
@PostMapping("/orders")
public ResponseEntity<?> createOrder(@RequestBody CreateOrderRequest request) {
    // ← business logic directly in controller
    if (request.items().isEmpty()) {
        return ResponseEntity.badRequest().body("No items");
    }
    Order order = new Order();
    order.setStatus(OrderStatus.PENDING);
    order.setCustomerId(request.customerId());
    orderRepository.save(order);
    return ResponseEntity.accepted().body(order.getId());
}
```

Why this breaks: you cannot test this logic without a MockMvc test. You cannot reuse this logic in a batch processing context. You cannot extend it without touching HTTP concerns.

**Anti-pattern 3: `@Transactional` on controllers**

```java
// DO NOT do this
@Transactional  // ← on controller
@PostMapping("/orders")
public ResponseEntity<?> createOrder(...) { ... }
```

Why this breaks: the transaction scope is wider than needed, includes HTTP serialization time, and creates subtle bugs when a serialization error triggers a rollback. Transactions belong on service methods.

---

## Common Mistakes

**"I'll refactor the layers later."**  
You won't. Every module that follows writes code that depends on this structure. A flat structure (everything in one package) takes 20 minutes to refactor and feels fine — until you have 40 classes and the controller is importing `@Entity` objects and it's 3am.

**Over-layering for a microservice.**  
You don't need `application/`, `infrastructure/`, `ports/`, `adapters/`. That's hexagonal architecture, appropriate for complex domains. For a focused microservice with one bounded context, four layers is the right trade-off between structure and overhead.

**Putting `@Transactional` on every method "just in case."**  
Transaction scope matters. A method with `@Transactional` that reads from the DB and then calls an external API holds the DB connection open during the external call. Be deliberate.

---

## Exercise 1.1

**Task:** Create the `order-api` project structure.

1. Generate a Spring Boot project with these dependencies:
   - `spring-boot-starter-web`
   - `spring-boot-starter-data-jpa`
   - `spring-boot-starter-validation`
   - `spring-boot-starter-actuator`
   - `springdoc-openapi-starter-webmvc-ui`
   - `postgresql` (runtime)
   - `lombok` (optional but used in examples)

2. Create the package structure shown above (empty classes are fine at this stage).

3. Implement the `Order` entity and `OrderStatus` enum (see answer below).

4. Implement `OrderController` with just the method signatures (no logic yet) and verify it compiles.

**Answer:**

```java
// domain/OrderStatus.java
public enum OrderStatus {
    PENDING, PROCESSING, COMPLETED, FAILED
}
```

```java
// domain/Order.java
@Entity
@Table(name = "orders")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Order {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String customerId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private OrderStatus status;

    @Column(nullable = false, precision = 10, scale = 2)
    private BigDecimal totalAmount;

    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant updatedAt;

    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id")
    private List<OrderItem> items = new ArrayList<>();

    // Factory method — the only way to create an Order
    // This enforces that every Order starts as PENDING
    public static Order create(String customerId, List<OrderItem> items, BigDecimal totalAmount) {
        Order order = new Order();
        order.customerId = customerId;
        order.items = new ArrayList<>(items);
        order.totalAmount = totalAmount;
        order.status = OrderStatus.PENDING;
        order.createdAt = Instant.now();
        order.updatedAt = Instant.now();
        return order;
    }

    // State transition methods — controlled, not arbitrary setters
    public void markProcessing() {
        validateTransition(OrderStatus.PENDING, OrderStatus.PROCESSING);
        this.status = OrderStatus.PROCESSING;
        this.updatedAt = Instant.now();
    }

    public void markCompleted() {
        validateTransition(OrderStatus.PROCESSING, OrderStatus.COMPLETED);
        this.status = OrderStatus.COMPLETED;
        this.updatedAt = Instant.now();
    }

    public void markFailed() {
        if (this.status != OrderStatus.PROCESSING) {
            throw new IllegalStateException(
                "Cannot transition to FAILED from " + this.status);
        }
        this.status = OrderStatus.FAILED;
        this.updatedAt = Instant.now();
    }

    private void validateTransition(OrderStatus from, OrderStatus to) {
        if (this.status != from) {
            throw new IllegalStateException(
                "Cannot transition from " + this.status + " to " + to);
        }
    }
}
```

Note the state transition methods instead of setters. This ensures the state machine is enforced at the domain level — `order.setStatus(OrderStatus.COMPLETED)` is not possible; `order.markCompleted()` is. This design makes invalid state transitions a compile-time or runtime error, not a silent bug.

---

## Interview Mode

**Question:** *"How do you structure a Spring Boot microservice?"*

**60-second answer:**
> "I use four layers: API, Service, Domain, and Repository. The API layer handles HTTP concerns — controllers, request/response DTOs, exception handlers. The Service layer contains business logic and is the only place for `@Transactional`. The Domain layer contains JPA entities and enums with no Spring dependencies. The Repository layer is Spring Data interfaces.
>
> The key rule is that dependencies always point inward — controllers know about services, services know about the domain, the domain knows about nothing. I enforce this by never returning JPA entities from controllers; I always map to response DTOs. This prevents accidental exposure of internal fields and avoids lazy-loading exceptions at the serialization boundary.
>
> For a focused microservice, this structure is enough. I avoid over-layering with ports and adapters unless the domain complexity justifies it."

---

*Next: [Chapter 1.2 — DTO vs Entity Separation →](./02-dto-entity-separation.md)*
