# 4.1 — SQS Fundamentals

> **Capstone connection:** The queue behavior you configure here — visibility timeout, redrive policy, long polling — directly determines whether your `order-worker` processes messages exactly once, retries correctly, and sends permanent failures to the DLQ.

---

## What SQS Guarantees (and What It Doesn't)

SQS Standard queues provide:

- **At-least-once delivery:** every message is delivered at least once. It may be delivered more than once (rare, but possible under high load or when a consumer crashes after receiving but before deleting).
- **Best-effort ordering:** messages are generally delivered in the order they were sent, but this is not guaranteed.
- **Durable storage:** messages are stored redundantly across multiple AZs. A message will not be lost unless the queue itself is deleted.

SQS does **not** provide:

- **Exactly-once processing:** your consumer must be idempotent. Two workers may receive the same message simultaneously.
- **Strict ordering:** use FIFO queues if order matters (with throughput trade-off).
- **Push delivery:** SQS is poll-based. Your consumer asks for messages. Messages don't call your consumer.

**Implication for `order-worker`:** processing must be idempotent. If the worker receives the same `OrderCreatedEvent` twice, the second processing should be a no-op (order already `COMPLETED` → skip). This is handled by checking the current order status before processing.

---

## Core Concepts

### Visibility Timeout

When a consumer receives a message, SQS makes it invisible to all other consumers for the **visibility timeout** duration. This is not deletion — the message still exists.

```
Consumer receives message → message becomes invisible (30s timeout)
Consumer processes successfully → Consumer calls DeleteMessage → message is gone
Consumer crashes during processing → visibility timeout expires → message becomes visible again → another consumer can receive it
```

**Configure it to be longer than your maximum processing time + buffer:**

```
visibility timeout = max processing time × 1.5
```

If `order-worker` takes up to 10 seconds to process, set `VisibilityTimeout: 30`. If a message takes 25 seconds (slow downstream), the worker must call `ChangeMessageVisibility` to extend the timeout before it expires, or the message will be re-processed.

```java
// Extend visibility if processing takes longer than expected
sqsClient.changeMessageVisibility(ChangeMessageVisibilityRequest.builder()
    .queueUrl(queueUrl)
    .receiptHandle(message.receiptHandle())
    .visibilityTimeout(60)    // extend by 60 more seconds
    .build());
```

### Long Polling

SQS supports two polling modes:

| Mode | Behavior | Cost |
|---|---|---|
| Short polling | Returns immediately, even if empty (returns subset of servers) | More API calls |
| Long polling | Waits up to 20s for a message to arrive | Fewer empty responses, lower cost |

**Always use long polling (`WaitTimeSeconds: 20`) in production.** Short polling can return empty responses even when messages exist (it only queries a subset of SQS's distributed storage). Long polling queries all partitions and is cheaper.

```java
ReceiveMessageRequest request = ReceiveMessageRequest.builder()
    .queueUrl(queueUrl)
    .maxNumberOfMessages(10)      // Batch: receive up to 10 at once
    .waitTimeSeconds(20)          // Long polling
    .messageAttributeNames("All") // Include all message attributes (correlationId, etc.)
    .build();
```

### Dead Letter Queue (DLQ)

When a message fails processing N times (defined by `maxReceiveCount` in the redrive policy), SQS automatically moves it to the DLQ. The main queue stops retrying.

```
maxReceiveCount: 3
→ Message received and not deleted (3 times) → moved to DLQ
```

The DLQ is a separate queue you create first. The main queue's redrive policy references it:

```json
{
  "deadLetterTargetArn": "arn:aws:sqs:us-east-1:123:order-created-dlq",
  "maxReceiveCount": 3
}
```

**DLQ messages require human or automated intervention.** They are not automatically retried. Common approaches:
1. Alarm on DLQ depth → alerts on-call engineer
2. Automated DLQ replay after fixing the bug: move messages back to the main queue
3. Dead-letter archiving: persist to S3 for later analysis

---

## Standard vs FIFO Queues

| Feature | Standard | FIFO |
|---|---|---|
| Throughput | Nearly unlimited | 3,000 msg/s with batching, 300 without |
| Ordering | Best-effort | Strict (within message group) |
| Delivery | At-least-once | Exactly-once within 5-minute deduplication window |
| Use case | High throughput, order doesn't matter | Financial transactions, order processing requiring strict sequencing |
| Price | Lower | Higher |
| Naming | `queue-name` | `queue-name.fifo` |

**For `order-created-queue`:** Standard is the right choice. Each order has a unique ID and processing is idempotent. We don't need strict ordering across all orders — we need each individual order processed correctly.

**When would you use FIFO here?** If orders for the same customer had to be processed in sequence (e.g., cancel order must wait for the create to complete). In that case, use FIFO with `MessageGroupId: customerId`. All messages for the same customer are processed in order.

---

## Message Attributes

SQS supports up to 10 custom message attributes per message. Use them for metadata that should not be in the message body:

```java
Map<String, MessageAttributeValue> attributes = Map.of(
    "correlationId", MessageAttributeValue.builder()
        .dataType("String")
        .stringValue(correlationId)
        .build(),
    "version", MessageAttributeValue.builder()
        .dataType("String")
        .stringValue("1.0")
        .build(),
    "source", MessageAttributeValue.builder()
        .dataType("String")
        .stringValue("order-api")
        .build()
);
```

**Why `correlationId` as a message attribute, not in the body?**

- The body is business payload. `correlationId` is infrastructure metadata.
- Consumers can filter on message attributes without deserializing the body (useful for routing or monitoring).
- Keeps the event schema clean — `OrderCreatedEvent` doesn't have `correlationId` as a business field.

---

## LocalStack for Local Development

LocalStack emulates AWS APIs locally. For this course, you need only SQS emulation:

```bash
# Start LocalStack (SQS only)
docker run -d \
  --name localstack \
  -p 4566:4566 \
  -e SERVICES=sqs \
  -e AWS_DEFAULT_REGION=us-east-1 \
  localstack/localstack:3

# Create queues via AWS CLI pointing to LocalStack
aws --endpoint-url=http://localhost:4566 \
    --region us-east-1 \
    sqs create-queue \
    --queue-name order-created-dlq

aws --endpoint-url=http://localhost:4566 \
    --region us-east-1 \
    sqs create-queue \
    --queue-name order-created-queue \
    --attributes '{
      "VisibilityTimeout": "30",
      "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:us-east-1:000000000000:order-created-dlq\",\"maxReceiveCount\":\"3\"}"
    }'

# List queues to confirm
aws --endpoint-url=http://localhost:4566 \
    --region us-east-1 \
    sqs list-queues

# Peek at messages (useful for debugging)
aws --endpoint-url=http://localhost:4566 \
    --region us-east-1 \
    sqs receive-message \
    --queue-url http://localhost:4566/000000000000/order-created-queue \
    --max-number-of-messages 1
```

Spring Boot configuration for LocalStack:
```yaml
# application-dev.yml
spring:
  cloud:
    aws:
      sqs:
        endpoint: http://localhost:4566
      credentials:
        access-key: test       # Any non-empty value works with LocalStack
        secret-key: test
      region:
        static: us-east-1
```

---

## Common Mistakes

**Deleting the message before processing is complete.**  
Once you delete the message, it's gone. If your service crashes after deletion but before committing the DB update, the order is stuck. Pattern: receive → process → commit DB → delete message.

```java
// WRONG order
sqsClient.deleteMessage(...);    // ← deleted before processing
orderRepository.save(order);     // ← if this fails, message is gone

// CORRECT order
orderRepository.save(order);     // ← commit first
sqsClient.deleteMessage(...);    // ← only delete after successful processing
```

**Setting visibility timeout shorter than processing time.**  
Message becomes visible again while still being processed → two workers process the same order simultaneously. Set `VisibilityTimeout` conservatively.

**Not requesting message attributes.**  
```java
// If you don't specify attributeNames, message attributes are NOT returned
ReceiveMessageRequest.builder()
    .queueUrl(queueUrl)
    .messageAttributeNames("All")  // ← required to get correlationId etc.
    .build();
```

---

## Interview Mode

**Question:** *"Explain how SQS at-least-once delivery works and how you handle it."*

**60-second answer:**
> "SQS Standard queues guarantee at-least-once delivery — every message will be delivered, but occasionally a message may be delivered more than once. This happens because SQS is a distributed system and under certain failure conditions a message that was already processed can become visible again.
>
> The solution is idempotent consumers. In `order-worker`, before processing I check the current order status. If the order is already `COMPLETED` or `FAILED`, I skip processing and delete the message. That check-then-act pattern ensures duplicate deliveries are no-ops.
>
> The visibility timeout is the mechanism SQS uses for this. When a consumer receives a message, it becomes invisible to others for the timeout duration. If the consumer successfully processes and deletes it, done. If the consumer crashes or takes too long, the timeout expires and the message becomes visible again for another consumer to pick up. This is SQS's built-in retry mechanism."

---

*Next: [Chapter 4.2 — Spring Boot + SQS Integration →](./02-spring-boot-sqs.md)*
