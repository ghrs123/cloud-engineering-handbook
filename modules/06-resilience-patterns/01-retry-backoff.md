# 6.1 — Retry with Exponential Backoff

---

## Dependencies

```xml
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-spring-boot3</artifactId>
    <version>2.2.0</version>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-aop</artifactId>
</dependency>
```

**AOP is required.** Resilience4j annotations work via Spring AOP proxies. Without `spring-boot-starter-aop`, `@Retry` and `@CircuitBreaker` silently do nothing.

---

## Configuration in `application.yml`

```yaml
resilience4j:
  retry:
    instances:
      order-processing:
        max-attempts: 3
        wait-duration: 1s
        enable-exponential-backoff: true
        exponential-backoff-multiplier: 2
        exponential-max-wait-duration: 10s
        randomized-wait-factor: 0.3        # Jitter: ±30% of wait duration
        retry-exceptions:
          - com.example.orderworker.steps.TransientProcessingException
          - java.net.SocketTimeoutException
          - org.springframework.dao.TransientDataAccessException
        ignore-exceptions:
          - com.example.orderworker.steps.PermanentProcessingException
          - java.lang.IllegalArgumentException
```

**How backoff with jitter works:**
```
Attempt 1: fails → wait 1s ± 0.3s  (0.7s – 1.3s)
Attempt 2: fails → wait 2s ± 0.6s  (1.4s – 2.6s)
Attempt 3: fails → wait 4s ± 1.2s  (2.8s – 5.2s)
Attempt 4: fails → MaxRetriesExceeded exception
```

**Why jitter matters:** without it, 20 worker pods all failing simultaneously all retry at exactly `T+1s`, `T+2s`, `T+4s` — creating synchronized load spikes on the recovering downstream service. Jitter spreads retries across a time window, reducing thundering herd.

---

## Applying `@Retry` to Processing Steps

Replace the manual `TransientProcessingException` throwing with a declarative annotation:

```java
// steps/PaymentAuthStep.java
@Component
@Slf4j
public class PaymentAuthStep implements ProcessingStep {

    @Override
    public String name() { return "payment-authorization"; }

    @Override
    @Retry(name = "order-processing", fallbackMethod = "paymentAuthFallback")
    public void execute(OrderCreatedEvent event) {
        log.debug("Authorizing payment: orderId={}", event.orderId());
        callPaymentGateway(event);  // May throw TransientProcessingException
    }

    // Called after all retry attempts are exhausted
    private void paymentAuthFallback(OrderCreatedEvent event, Exception ex) {
        log.error("Payment authorization failed after all retries: orderId={} reason={}",
            event.orderId(), ex.getMessage());
        // Rethrow as permanent failure — caller (OrderProcessor) will mark FAILED
        throw new PermanentProcessingException(
            "Payment gateway permanently unavailable after retries", ex);
    }

    private void callPaymentGateway(OrderCreatedEvent event) {
        // Simulates a call to an external payment service
        // In production: RestTemplate/WebClient call here
        simulateWork(100);
    }
}
```

```java
// OrderProcessor.java — simplified now that retry is declarative
@Service
@RequiredArgsConstructor
@Slf4j
public class OrderProcessor {

    private final OrderStatusService orderStatusService;
    private final List<ProcessingStep> steps;

    public void process(OrderCreatedEvent event) {
        UUID orderId = event.orderId();

        Order order = orderStatusService.findById(orderId)
            .orElseThrow(() -> new IllegalStateException("Order not found: " + orderId));

        if (order.getStatus() != OrderStatus.PENDING) {
            log.warn("Skipping duplicate event: orderId={} status={}", orderId, order.getStatus());
            return;
        }

        orderStatusService.markProcessing(orderId);

        try {
            for (ProcessingStep step : steps) {
                log.info("Executing step: orderId={} step={}", orderId, step.name());
                step.execute(event);
            }
            orderStatusService.markCompleted(orderId);
            log.info("Order completed: orderId={}", orderId);

        } catch (PermanentProcessingException ex) {
            log.error("Permanent failure: orderId={}", orderId, ex);
            orderStatusService.markFailed(orderId);
            // Don't rethrow — message is deleted, order is FAILED

        } catch (Exception ex) {
            // Unexpected exception — let SQS retry
            log.error("Unexpected error: orderId={}", orderId, ex);
            orderStatusService.markPending(orderId);
            throw ex;
        }
    }
}
```

---

## Observing Retry Events

Resilience4j publishes events you can log:

```java
// config/ResilienceConfig.java
@Configuration
@Slf4j
public class ResilienceConfig {

    @Bean
    public RetryRegistry retryRegistry(RetryConfigRegistry configRegistry) {
        RetryRegistry registry = RetryRegistry.ofDefaults();

        registry.getEventPublisher().onEntryAdded(event -> {
            event.getAddedEntry()
                 .getEventPublisher()
                 .onRetry(e -> log.warn(
                     "Retry attempt: name={} attempt={} lastException={}",
                     e.getName(), e.getNumberOfRetryAttempts(),
                     e.getLastThrowable().getMessage()))
                 .onError(e -> log.error(
                     "All retries exhausted: name={} attempts={}",
                     e.getName(), e.getNumberOfRetryAttempts()))
                 .onSuccess(e -> {
                     if (e.getNumberOfRetryAttempts() > 0) {
                         log.info("Succeeded after {} retries: name={}",
                             e.getNumberOfRetryAttempts(), e.getName());
                     }
                 });
        });

        return registry;
    }
}
```

---

## Exercise 6.1

**Task:** Verify retry behaviour with logs.

1. Set `TRANSIENT_FAILURE_RATE = 0.7` in `PaymentAuthStep` (70% failure rate)
2. Start `order-worker` and create several orders
3. Observe logs showing:
```
WARN  Retry attempt: name=order-processing attempt=1 lastException=Payment gateway temporarily unavailable
WARN  Retry attempt: name=order-processing attempt=2 lastException=Payment gateway temporarily unavailable
INFO  Succeeded after 2 retries: name=order-processing
```
4. Verify some orders still reach `COMPLETED` despite failures

---

## Interview Mode

**Question:** *"How do you implement retry with backoff in your services?"*

**60-second answer:**
> "I use Resilience4j's `@Retry` annotation with exponential backoff configuration. The key settings are `max-attempts`, `wait-duration` as the base, `exponential-backoff-multiplier`, and critically `randomized-wait-factor` for jitter. Without jitter, all instances retry in lockstep and create synchronized load spikes on the recovering service.
>
> I distinguish between transient and permanent exceptions in the configuration. Transient exceptions — socket timeouts, DB connection errors — trigger retry. Permanent exceptions — invalid data, authorization failures — are in `ignore-exceptions` and are not retried because retrying won't fix them.
>
> After all retries are exhausted, the `fallbackMethod` is called. For the payment step, the fallback throws a `PermanentProcessingException` which tells the processor to mark the order `FAILED`. The SQS message is then deleted cleanly — no DLQ involvement for retried-and-exhausted flows."

---

*Next: [Chapter 6.2 — Circuit Breaker →](./02-circuit-breaker.md)*
