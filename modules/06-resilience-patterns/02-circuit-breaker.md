# 6.2 — Circuit Breaker

> The circuit breaker prevents your service from hammering a failing downstream system — and from wasting resources on calls that are certain to fail.

---

## The Three States

```
CLOSED (normal) ──→ failure threshold exceeded ──→ OPEN (reject all calls)
                                                          │
                                                    wait duration
                                                          │
                                                          ↓
                                                   HALF-OPEN (probe)
                                                          │
                                          ┌──────────────┴─────────────┐
                                     probe succeeds              probe fails
                                          │                            │
                                          ↓                            ↓
                                       CLOSED                        OPEN
```

| State | Behaviour |
|---|---|
| `CLOSED` | Normal operation. Calls pass through. Failures counted in sliding window. |
| `OPEN` | All calls rejected immediately with `CallNotPermittedException`. No waiting. |
| `HALF-OPEN` | Limited calls allowed (probe). If they succeed → CLOSED. If they fail → OPEN again. |

**Why this matters:** when a downstream service is down, retrying every message wastes CPU, holds DB connections, and may cascade the failure. The circuit breaker short-circuits: after N failures, it stops calling the downstream for a period, lets it recover, then tests cautiously.

---

## Configuration

```yaml
resilience4j:
  circuit-breaker:
    instances:
      payment-gateway:
        # Sliding window: count-based or time-based
        sliding-window-type: COUNT_BASED
        sliding-window-size: 10           # Evaluate last 10 calls

        # Open when 50%+ of the last 10 calls fail
        failure-rate-threshold: 50

        # Minimum calls before circuit can open (avoid opening on first failure)
        minimum-number-of-calls: 5

        # Time in OPEN state before trying HALF-OPEN
        wait-duration-in-open-state: 30s

        # Number of probe calls in HALF-OPEN
        permitted-number-of-calls-in-half-open-state: 3

        # Exceptions that count as failures (default: all exceptions)
        record-exceptions:
          - com.example.orderworker.steps.TransientProcessingException
          - java.net.SocketTimeoutException

        # Exceptions that do NOT count as failures
        ignore-exceptions:
          - com.example.orderworker.steps.PermanentProcessingException
```

---

## Applying `@CircuitBreaker`

Combine with `@Retry` — retry first, then circuit breaker decides whether to allow the call:

```java
// steps/PaymentAuthStep.java
@Component
@Slf4j
public class PaymentAuthStep implements ProcessingStep {

    @Override
    @Retry(name = "order-processing", fallbackMethod = "paymentAuthFallback")
    @CircuitBreaker(name = "payment-gateway", fallbackMethod = "circuitOpenFallback")
    public void execute(OrderCreatedEvent event) {
        callPaymentGateway(event);
    }

    // Called when circuit is OPEN (no retries attempted)
    private void circuitOpenFallback(OrderCreatedEvent event, CallNotPermittedException ex) {
        log.warn("Circuit OPEN — payment gateway unavailable: orderId={}", event.orderId());
        // Throw transient so SQS retries the message later, when circuit may recover
        throw new TransientProcessingException("Payment gateway circuit is OPEN");
    }

    // Called when all retries exhausted (circuit was CLOSED but calls keep failing)
    private void paymentAuthFallback(OrderCreatedEvent event, Exception ex) {
        log.error("Payment auth failed after retries: orderId={}", event.orderId());
        throw new PermanentProcessingException("Payment permanently failed", ex);
    }
}
```

**Order of execution with both annotations:**
1. `@CircuitBreaker` checks if circuit is OPEN → if yes, calls `circuitOpenFallback` immediately
2. If CLOSED or HALF-OPEN, passes call through to `@Retry`
3. `@Retry` attempts the call, retries on transient failure
4. If retries exhausted, calls `paymentAuthFallback`

---

## Monitoring Circuit Breaker State

```java
// In ResilienceConfig, add circuit breaker event listener
circuitBreakerRegistry.getAllCircuitBreakers().forEach(cb ->
    cb.getEventPublisher()
      .onStateTransition(event -> log.warn(
          "CircuitBreaker state change: name={} from={} to={}",
          event.getCircuitBreakerName(),
          event.getStateTransition().getFromState(),
          event.getStateTransition().getToState()))
      .onCallNotPermitted(event -> log.warn(
          "Call rejected — circuit OPEN: name={}",
          event.getCircuitBreakerName()))
);
```

Resilience4j also exports metrics via Micrometer. In Module 7, these are scraped by Prometheus:
```
resilience4j_circuitbreaker_state{name="payment-gateway"} 1.0
# 0=CLOSED, 1=OPEN, 2=HALF_OPEN
```

---

## Interview Mode

**Question:** *"Explain circuit breaker states and when you'd use one."*

**90-second answer:**
> "A circuit breaker has three states. Closed is normal — calls pass through and failures are counted. When failures exceed a threshold — say 50% of the last 10 calls — it transitions to Open. In the Open state, all calls are rejected immediately without attempting the downstream call. After a wait duration, say 30 seconds, it transitions to Half-Open and allows a small number of probe calls. If those succeed, it closes again. If they fail, it reopens.
>
> The value is twofold. First, it prevents cascading failures: if the payment gateway is down, open circuits mean your worker pods don't waste threads and connections queuing failed calls. Second, it gives the downstream service time to recover without being hammered by retry traffic.
>
> In `order-worker`, I pair it with `@Retry`. The circuit breaker is the outer layer — if it's open, no retries are attempted at all. If it's closed, the retry mechanism handles transient failures. The fallback for an open circuit throws a transient exception so SQS retries the message after the visibility timeout, by which point the circuit may have recovered."

---

*Next: [Chapter 6.3 — Timeout & Bulkhead →](./03-timeout-bulkhead.md)*
