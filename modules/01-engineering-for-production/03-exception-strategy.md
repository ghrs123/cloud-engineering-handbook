# 1.3 — Exception Handling Strategy

> **Capstone connection:** Every error from `order-api` — validation failure, resource not found, duplicate key, unexpected server error — returns a consistent `ErrorResponse` structure. No stack traces in responses.

---

## Why Exception Handling Matters More Than You Think

Bad exception handling causes two classes of problems in production:

**Client problems:** Different endpoints return different error shapes (`{"error": "not found"}` vs `{"message": "Order 123 not found"}` vs a Spring default `{"timestamp": ..., "status": 404}`). API consumers have to handle each case differently. This is a contract violation.

**Security problems:** Unhandled exceptions leak stack traces. A stack trace tells an attacker your Spring Boot version, your class names, your package structure, and sometimes your SQL queries. This is not theoretical — it is a common OWASP finding.

---

## The Error Response Contract

Define one structure. Use it everywhere. Document it in your OpenAPI spec.

```java
// api/exception/ErrorResponse.java
public record ErrorResponse(
    String code,          // Machine-readable: "ORDER_NOT_FOUND", "VALIDATION_ERROR"
    String message,       // Human-readable: "Order a1b2c3 not found"
    String correlationId, // From MDC — links error to request logs
    Instant timestamp,
    List<FieldError> errors  // For validation errors (empty list for other errors)
) {
    public record FieldError(String field, String message) {}

    // Factory for simple errors
    public static ErrorResponse of(String code, String message) {
        return new ErrorResponse(
            code,
            message,
            MDC.get("correlationId"),
            Instant.now(),
            List.of()
        );
    }

    // Factory for validation errors
    public static ErrorResponse validation(List<FieldError> errors) {
        return new ErrorResponse(
            "VALIDATION_ERROR",
            "Request validation failed",
            MDC.get("correlationId"),
            Instant.now(),
            errors
        );
    }
}
```

Key decisions:
- `code` is machine-readable: clients can `switch` on it
- `correlationId` in the error response means a client can provide it when reporting a bug — you find the full trace immediately
- `errors` list is always present (empty for non-validation errors) — clients don't need null checks

---

## Domain Exceptions

Define exceptions that express business concepts, not technical ones:

```java
// service/exception/OrderNotFoundException.java
public class OrderNotFoundException extends RuntimeException {
    private final UUID orderId;

    public OrderNotFoundException(UUID orderId) {
        super("Order not found: " + orderId);
        this.orderId = orderId;
    }

    public UUID getOrderId() { return orderId; }
}
```

```java
// service/exception/DuplicateOrderException.java
public class DuplicateOrderException extends RuntimeException {
    private final String idempotencyKey;

    public DuplicateOrderException(String idempotencyKey) {
        super("Order already exists for idempotency key: " + idempotencyKey);
        this.idempotencyKey = idempotencyKey;
    }
}
```

```java
// service/exception/InvalidOrderStateException.java
public class InvalidOrderStateException extends RuntimeException {
    public InvalidOrderStateException(String message) {
        super(message);
    }
}
```

These exceptions are thrown by the service layer and caught by the global handler. The controller never needs `try/catch`.

---

## The Global Exception Handler

One class, `@ControllerAdvice`, maps every exception type to an HTTP response:

```java
// api/exception/GlobalExceptionHandler.java
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    // ── Domain exceptions ────────────────────────────────────────
    @ExceptionHandler(OrderNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleOrderNotFound(OrderNotFoundException ex) {
        log.warn("Order not found: orderId={}", ex.getOrderId());
        return ResponseEntity
            .status(HttpStatus.NOT_FOUND)
            .body(ErrorResponse.of("ORDER_NOT_FOUND", ex.getMessage()));
    }

    @ExceptionHandler(DuplicateOrderException.class)
    public ResponseEntity<ErrorResponse> handleDuplicate(DuplicateOrderException ex) {
        // Note: this is NOT a 409. The idempotency contract says:
        // same key = same response = 200 OK with original data.
        // If we get here, it means idempotency service itself failed.
        log.error("Unexpected duplicate order: {}", ex.getMessage());
        return ResponseEntity
            .status(HttpStatus.CONFLICT)
            .body(ErrorResponse.of("DUPLICATE_ORDER", ex.getMessage()));
    }

    @ExceptionHandler(InvalidOrderStateException.class)
    public ResponseEntity<ErrorResponse> handleInvalidState(InvalidOrderStateException ex) {
        log.warn("Invalid order state transition: {}", ex.getMessage());
        return ResponseEntity
            .status(HttpStatus.UNPROCESSABLE_ENTITY)
            .body(ErrorResponse.of("INVALID_STATE_TRANSITION", ex.getMessage()));
    }

    // ── Validation exceptions ─────────────────────────────────────
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException ex) {
        List<ErrorResponse.FieldError> fieldErrors = ex.getBindingResult()
            .getFieldErrors()
            .stream()
            .map(fe -> new ErrorResponse.FieldError(
                fe.getField(),
                fe.getDefaultMessage()))
            .toList();

        log.debug("Validation failed: {}", fieldErrors);
        return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .body(ErrorResponse.validation(fieldErrors));
    }

    @ExceptionHandler(MissingRequestHeaderException.class)
    public ResponseEntity<ErrorResponse> handleMissingHeader(MissingRequestHeaderException ex) {
        log.debug("Missing required header: {}", ex.getHeaderName());
        return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .body(ErrorResponse.of(
                "MISSING_HEADER",
                "Required header is missing: " + ex.getHeaderName()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleUnreadableBody(HttpMessageNotReadableException ex) {
        log.debug("Unreadable request body: {}", ex.getMessage());
        return ResponseEntity
            .status(HttpStatus.BAD_REQUEST)
            .body(ErrorResponse.of("INVALID_REQUEST_BODY", "Request body is malformed or missing"));
    }

    // ── Catch-all — never expose internals ───────────────────────
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception ex) {
        // Log the full exception internally
        log.error("Unexpected error: correlationId={}", MDC.get("correlationId"), ex);
        // But return a generic message to the client — no stack trace, no internal detail
        return ResponseEntity
            .status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(ErrorResponse.of("INTERNAL_ERROR",
                "An unexpected error occurred. Use correlationId to trace this issue."));
    }
}
```

Critical points:
- `log.warn` for expected business errors (not found, validation) — these are not alerts
- `log.error` for unexpected exceptions — these should trigger alerts in production
- The catch-all logs the full exception (for your own diagnostics) but never returns it to the client
- `correlationId` is in every error response — clients can include it in bug reports

---

## HTTP Status Codes — The Right Mapping

| Situation | Status | Code field |
|---|---|---|
| Resource not found | 404 | `ORDER_NOT_FOUND` |
| Validation failure | 400 | `VALIDATION_ERROR` |
| Missing required header | 400 | `MISSING_HEADER` |
| Malformed JSON body | 400 | `INVALID_REQUEST_BODY` |
| Invalid state transition | 422 | `INVALID_STATE_TRANSITION` |
| Unexpected server error | 500 | `INTERNAL_ERROR` |
| Downstream service unavailable | 503 | `SERVICE_UNAVAILABLE` |

**Why 422 (Unprocessable Entity) instead of 400 for state transitions?**  
400 means the request is syntactically wrong. 422 means the request is syntactically valid but semantically wrong given the current state. "Try to complete an already-FAILED order" is a valid JSON request — it just doesn't make business sense in the current context.

---

## Common Mistakes

**Using `ResponseStatusException` everywhere.**  
`throw new ResponseStatusException(HttpStatus.NOT_FOUND, "not found")` is convenient but loses the structured error contract. The response is a Spring default shape, not your `ErrorResponse`. Use domain exceptions + global handler.

**Catching and re-throwing as `RuntimeException`.**  
```java
try {
    orderRepository.save(order);
} catch (Exception e) {
    throw new RuntimeException(e);  // ← loses type information, harder to handle
}
```
Only catch exceptions you can meaningfully handle. Let the rest propagate to the global handler.

**Logging at ERROR level for 404s.**  
A 404 is not an error — it is a normal client outcome. Log it at WARN or DEBUG. Reserve ERROR for situations that require human attention (unexpected exceptions, data inconsistency, downstream failures).

---

## Exercise 1.3

**Task:** Implement the full exception handling for `order-api`.

1. Implement `ErrorResponse`, `OrderNotFoundException`, and `GlobalExceptionHandler` as shown above.
2. Add a `@ExceptionHandler` for `HttpRequestMethodNotAllowedException` that returns 405 with code `METHOD_NOT_ALLOWED`.
3. Write a `@WebMvcTest` that verifies `POST /orders` with an empty body returns 400 with `code: "INVALID_REQUEST_BODY"`.

**Answer — WebMvcTest:**

```java
@WebMvcTest(OrderController.class)
class OrderControllerTest {

    @Autowired
    MockMvc mockMvc;

    @MockBean
    OrderService orderService;

    @Test
    void createOrder_withEmptyBody_returns400() throws Exception {
        mockMvc.perform(post("/orders")
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .header("X-API-Key", "test-key")
                .contentType(MediaType.APPLICATION_JSON)
                .content(""))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("INVALID_REQUEST_BODY"))
            .andExpect(jsonPath("$.correlationId").exists());
    }

    @Test
    void createOrder_withInvalidPayload_returns400WithFieldErrors() throws Exception {
        mockMvc.perform(post("/orders")
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .header("X-API-Key", "test-key")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                      "customerId": "",
                      "items": [],
                      "totalAmount": -1
                    }
                    """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
            .andExpect(jsonPath("$.errors").isArray())
            .andExpect(jsonPath("$.errors.length()").value(greaterThan(0)));
    }
}
```

---

## Interview Mode

**Question:** *"How do you handle errors in your REST API?"*

**60-second answer:**
> "I use a global `@ControllerAdvice` with `@ExceptionHandler` methods — one handler per exception type, all returning the same `ErrorResponse` structure with a machine-readable `code`, a human-readable `message`, and a `correlationId` so the client can trace the issue in logs.
>
> Domain exceptions like `OrderNotFoundException` are thrown from the service layer and never caught in controllers. The global handler catches them and maps them to HTTP status codes. The catch-all handler logs the full exception internally but never exposes stack traces in the response — that's both a usability and security concern.
>
> I'm deliberate about log levels: 404s and validation errors are WARN at most, because they're expected client behavior. Unexpected exceptions are ERROR because they need human attention."

---

*Next: [Chapter 1.4 — Logging Strategy →](./04-logging-strategy.md)*
