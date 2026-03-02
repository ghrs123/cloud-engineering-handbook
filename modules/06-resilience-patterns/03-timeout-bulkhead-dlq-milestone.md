# 6.3 — Timeout & Bulkhead

---

## `@TimeLimiter` — Prevent Hung Calls

Without a timeout, a slow downstream call holds a thread indefinitely. With 10 concurrent workers and each waiting 5 minutes for a payment gateway response, all 10 worker threads are blocked and the service stops processing.

```yaml
resilience4j:
  time-limiter:
    instances:
      payment-gateway:
        timeout-duration: 3s      # Fail fast after 3 seconds
        cancel-running-future: true
```

```java
@TimeLimiter(name = "payment-gateway")
@CircuitBreaker(name = "payment-gateway", fallbackMethod = "circuitOpenFallback")
@Retry(name = "order-processing", fallbackMethod = "paymentAuthFallback")
public CompletableFuture<Void> execute(OrderCreatedEvent event) {
    return CompletableFuture.runAsync(() -> callPaymentGateway(event));
}
```

`@TimeLimiter` requires the method to return `CompletableFuture`. After `timeout-duration`, the future is cancelled and a `TimeoutException` is thrown — which triggers the `@Retry` mechanism if configured.

**Trade-off:** a 3-second timeout means slow-but-valid responses are rejected. Set the timeout at your P99 latency + buffer, not at P50. Monitor actual latency before setting a tight timeout.

---

## Bulkhead — Isolate Thread Pools

Without bulkhead, a slow step monopolises the entire SQS listener thread pool, starving other processing:

```yaml
resilience4j:
  bulkhead:
    instances:
      payment-gateway:
        max-concurrent-calls: 5    # At most 5 concurrent payment calls
        max-wait-duration: 0ms     # Fail immediately if all slots taken
```

```java
@Bulkhead(name = "payment-gateway", type = Bulkhead.Type.SEMAPHORE)
public void execute(OrderCreatedEvent event) {
    callPaymentGateway(event);
}
```

If all 5 bulkhead slots are occupied, `BulkheadFullException` is thrown immediately — allowing other steps and other orders to continue processing unaffected.

---

# 6.4 — DLQ Patterns

## When Messages Go to the DLQ

SQS moves messages to the DLQ when `receiveCount > maxReceiveCount` (3 in the capstone). This happens when:

1. `@SqsListener` throws an exception (message not deleted, re-queued)
2. Visibility timeout expires before the message is deleted (processing took too long)
3. Message deserialization fails (malformed JSON — permanent, will always fail)

## What to Do With DLQ Messages

| Scenario | Action |
|---|---|
| Bug in processing code (now fixed) | Replay: move messages back to main queue |
| Malformed message (bad producer) | Inspect, discard, alert producer |
| Downstream permanently unavailable | Wait for restoration, then replay |
| Poison message (causes crash every time) | Inspect manually, discard |

### DLQ Replay

```bash
# Move messages from DLQ back to main queue (AWS Console or CLI)
aws sqs start-message-move-task \
  --source-arn arn:aws:sqs:us-east-1:123456789:order-created-dlq \
  --destination-arn arn:aws:sqs:us-east-1:123456789:order-created-queue \
  --max-number-of-messages-per-second 5  # Throttle replay to avoid overwhelming worker
```

### Alert on DLQ Depth

```hcl
# Terraform CloudWatch alarm
resource "aws_cloudwatch_metric_alarm" "dlq_depth" {
  alarm_name          = "${var.environment}-order-dlq-depth"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0    # Alert immediately when any message appears in DLQ

  dimensions = {
    QueueName = aws_sqs_queue.order_dlq.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  alarm_description = "Messages in order DLQ require investigation"
}
```

---

# 6.5 — Capstone Milestone M6

## Verification Checklist

- [ ] `order-worker` starts cleanly with Resilience4j dependencies
- [ ] Setting `TRANSIENT_FAILURE_RATE = 0.5` shows retry attempts in logs
- [ ] Logs show retry events: `Retry attempt: name=order-processing attempt=1`
- [ ] After 3 retries exhausted, fallback is called and order is marked `FAILED`
- [ ] Circuit breaker state transition logged on repeated failures: `state change: CLOSED → OPEN`
- [ ] All resilience config is in `application.yml`, not hardcoded in Java
- [ ] `@TimeLimiter` times out a simulated 10-second call within 3 seconds
- [ ] Unit tests cover: retry triggers on transient exception, fallback called after exhaustion, circuit open rejection

## Full Resilience Config Reference

```yaml
# application.yml — order-worker complete resilience config
resilience4j:
  retry:
    instances:
      order-processing:
        max-attempts: 3
        wait-duration: 1s
        enable-exponential-backoff: true
        exponential-backoff-multiplier: 2
        exponential-max-wait-duration: 10s
        randomized-wait-factor: 0.3
        retry-exceptions:
          - com.example.orderworker.steps.TransientProcessingException
          - java.net.SocketTimeoutException
        ignore-exceptions:
          - com.example.orderworker.steps.PermanentProcessingException

  circuit-breaker:
    instances:
      payment-gateway:
        sliding-window-type: COUNT_BASED
        sliding-window-size: 10
        failure-rate-threshold: 50
        minimum-number-of-calls: 5
        wait-duration-in-open-state: 30s
        permitted-number-of-calls-in-half-open-state: 3
        record-exceptions:
          - com.example.orderworker.steps.TransientProcessingException

  time-limiter:
    instances:
      payment-gateway:
        timeout-duration: 3s
        cancel-running-future: true
```

## Interview Mode: The Full Resilience Story

**Question:** *"How does your order-worker handle failures in processing steps?"*

**2-minute answer (senior level):**
> "There are three layers of resilience in `order-worker`.
>
> First, `@Retry` with exponential backoff and jitter. For transient failures — timeouts, temporary service unavailability — the step is retried up to 3 times with increasing wait durations. Jitter prevents synchronized retries across all worker pods. After 3 attempts, the fallback is called which throws a permanent exception — the order is marked FAILED and the message is deleted cleanly.
>
> Second, `@CircuitBreaker` wraps the retry. If more than 50% of the last 10 calls to the payment gateway fail, the circuit opens and all subsequent calls are rejected immediately without retrying. The open-circuit fallback throws a transient exception, so SQS retries the message after the visibility timeout — by which point the circuit may have recovered to half-open. This prevents hammering a failing downstream service.
>
> Third, `@TimeLimiter` ensures no processing step hangs indefinitely. If the payment gateway doesn't respond within 3 seconds, the call is cancelled and treated as a transient failure, feeding into the retry and circuit breaker logic.
>
> At the SQS level, `acknowledgementMode: ON_SUCCESS` means the message is only deleted after successful processing. Exceptions propagate to `@SqsListener`, which leaves the message in the queue. After `maxReceiveCount` retries at the SQS level, it goes to the DLQ. We alert immediately on any DLQ depth above 0.
>
> All configuration — max attempts, thresholds, timeouts — is in `application.yml` and injected via ConfigMap in Kubernetes. No behaviour is hardcoded."

---

*Module 6 complete. Move to [Module 7 — Observability & Operability →](../07-observability/README.md)*
