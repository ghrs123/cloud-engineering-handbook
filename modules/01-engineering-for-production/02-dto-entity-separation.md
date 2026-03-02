# 1.2 — DTO vs Entity Separation

> **Capstone connection:** Every request and response in `order-api` uses dedicated DTOs. The `Order` entity never leaves the service layer.

---

## Why This Is Not Obvious

When you are building a small service and the response looks exactly like the entity, mapping feels like ceremony. `Order` has `id`, `customerId`, `status`, `totalAmount`. `OrderResponse` has `id`, `customerId`, `status`, `totalAmount`. Why not just return the entity?

Three production reasons:

**1. Your entity will diverge from your API contract.**  
You'll add audit fields (`createdBy`, `modifiedBy`), internal tracking fields (`processingAttempts`, `lastErrorMessage`), relationships that load lazily. Every one of these becomes an accidental API field if you return the entity directly.

**2. JPA entities are not safe to serialize outside a transaction.**  
Lazy-loaded collections throw `LazyInitializationException` when Jackson tries to serialize them after the transaction closes. You fix it with `@JsonIgnore` or `FetchType.EAGER` — and now you've coupled your serialization strategy to your persistence strategy.

**3. Your API contract should change independently of your schema.**  
Renaming a database column should not change your API. Changing your API field name should not require a database migration. DTOs are the decoupling boundary.

---

## The DTO Types You Need

For `order-api`, you need three categories:

**Request DTOs** — what the client sends
```
CreateOrderRequest    → POST /orders body
```

**Response DTOs** — what the API returns
```
CreateOrderResponse   → POST /orders response (minimal: orderId + status + correlationId)
OrderResponse         → GET /orders/{id} response (full order data)
ErrorResponse         → all error responses (standardized structure)
```

**Internal/messaging DTOs** — added in Module 4
```
OrderCreatedEvent     → published to SQS
```

---

## Implementation

### Request DTO — Use Java Records + Bean Validation

```java
// api/dto/request/CreateOrderRequest.java
public record CreateOrderRequest(

    @NotBlank(message = "customerId is required")
    String customerId,

    @NotEmpty(message = "items cannot be empty")
    @Valid
    List<OrderItemRequest> items,

    @NotNull(message = "totalAmount is required")
    @Positive(message = "totalAmount must be positive")
    @Digits(integer = 10, fraction = 2, message = "totalAmount has invalid format")
    BigDecimal totalAmount

) {}
```

```java
// api/dto/request/OrderItemRequest.java
public record OrderItemRequest(

    @NotBlank(message = "sku is required")
    String sku,

    @Min(value = 1, message = "qty must be at least 1")
    int qty

) {}
```

Why records? Immutable by default, `equals`/`hashCode`/`toString` generated, constructor-based (works seamlessly with `@Valid` on nested objects), concise.

### Response DTOs — Explicit, versioned-friendly

```java
// api/dto/response/CreateOrderResponse.java
public record CreateOrderResponse(
    UUID orderId,
    String status,
    String correlationId
) {
    // Static factory — mapping lives here, not in the service
    public static CreateOrderResponse from(Order order, String correlationId) {
        return new CreateOrderResponse(
            order.getId(),
            order.getStatus().name(),
            correlationId
        );
    }
}
```

```java
// api/dto/response/OrderResponse.java
public record OrderResponse(
    UUID orderId,
    String customerId,
    String status,
    BigDecimal totalAmount,
    List<OrderItemResponse> items,
    Instant createdAt,
    Instant updatedAt
) {
    public static OrderResponse from(Order order) {
        return new OrderResponse(
            order.getId(),
            order.getCustomerId(),
            order.getStatus().name(),
            order.getTotalAmount(),
            order.getItems().stream()
                .map(OrderItemResponse::from)
                .toList(),
            order.getCreatedAt(),
            order.getUpdatedAt()
        );
    }
}
```

```java
// api/dto/response/OrderItemResponse.java
public record OrderItemResponse(String sku, int qty) {
    public static OrderItemResponse from(OrderItem item) {
        return new OrderItemResponse(item.getSku(), item.getQty());
    }
}
```

### Where Does Mapping Happen?

Two valid options: inside the DTO (static factory, shown above) or inside the service. The tradeoff:

| Option | Pros | Cons |
|---|---|---|
| Static factory on DTO | DTO owns its own construction, service stays clean | DTO now knows about domain entity |
| Mapper in service | Service controls the mapping, DTO is pure data | Service method bodies grow |
| Dedicated mapper class | Clean separation | More classes for simple mappings |

**Recommendation for this scale:** static factory on the response DTO. It is readable, co-located with the type it produces, and the DTO → entity direction is acceptable (DTO depends on domain, not the other way around).

**Do not use:** MapStruct for this scale unless you have 20+ fields to map. The annotation processing adds build complexity without simplifying code at small-to-medium field counts.

---

## Common Mistakes

**Returning `Optional<T>` from the controller.**  
Controllers should return `ResponseEntity<T>`. Resolve `Optional` in the service layer and throw a domain exception if empty. The controller maps exceptions to HTTP status codes via `@ExceptionHandler`.

```java
// Wrong
@GetMapping("/orders/{id}")
public Optional<OrderResponse> getOrder(@PathVariable UUID id) {
    return orderRepository.findById(id).map(OrderResponse::from);
}

// Correct
@GetMapping("/orders/{id}")
public ResponseEntity<OrderResponse> getOrder(@PathVariable UUID id) {
    OrderResponse response = orderService.getOrder(id);  // throws OrderNotFoundException if absent
    return ResponseEntity.ok(response);
}
```

**Using `@JsonIgnore` on entity fields.**  
This is a symptom, not a solution. You're working around a serialization boundary problem by patching the entity. The fix is a response DTO.

**One DTO for all operations.**  
`OrderDto` used for create, update, and response leads to validation annotations that only apply to some operations, nullable fields that are required in some contexts, and confusion for API consumers. Use distinct types per operation.

---

## Exercise 1.2

**Task:** Implement the full DTO layer for `order-api`.

1. Implement `CreateOrderRequest` with validation annotations
2. Implement `CreateOrderResponse` with a static factory method
3. Implement `OrderResponse` mapping from the `Order` entity
4. Write a unit test that verifies `OrderResponse.from(order)` maps all fields correctly (no Spring context needed)

**Answer — Unit test:**

```java
class OrderResponseTest {

    @Test
    void from_shouldMapAllFields() {
        // Arrange
        Order order = Order.create(
            "cust-123",
            List.of(new OrderItem("SKU-001", 2)),
            new BigDecimal("99.90")
        );

        // Act
        OrderResponse response = OrderResponse.from(order);

        // Assert
        assertThat(response.customerId()).isEqualTo("cust-123");
        assertThat(response.status()).isEqualTo("PENDING");
        assertThat(response.totalAmount()).isEqualByComparingTo("99.90");
        assertThat(response.items()).hasSize(1);
        assertThat(response.items().get(0).sku()).isEqualTo("SKU-001");
        assertThat(response.items().get(0).qty()).isEqualTo(2);
        assertThat(response.orderId()).isNotNull();
        assertThat(response.createdAt()).isNotNull();
    }
}
```

This test has no `@SpringBootTest`, no MockMvc, no database. It runs in milliseconds. This is what testable layering enables.

---

## Interview Mode

**Question:** *"Why not just return the JPA entity directly from your REST endpoint?"*

**60-second answer:**
> "There are three concrete reasons I always use separate response DTOs.
>
> First, JPA entities have lazy-loaded relationships. Jackson will try to serialize them after the transaction closes, which throws `LazyInitializationException`. You either load everything eagerly — creating N+1 query problems — or you add `@JsonIgnore` everywhere, which couples your serialization to your persistence model.
>
> Second, entities grow fields over time: audit columns, internal tracking state, soft-delete flags. Every new internal field becomes an accidental API field if you return the entity directly.
>
> Third, your API contract and your schema should evolve independently. If you rename a database column you shouldn't have to change your API. DTOs are that decoupling layer.
>
> The cost is some mapping code. I keep it minimal with static factory methods on the DTO — `OrderResponse.from(order)` — so the mapping is co-located with the type it produces."

---

*Next: [Chapter 1.3 — Exception Handling Strategy →](./03-exception-strategy.md)*
