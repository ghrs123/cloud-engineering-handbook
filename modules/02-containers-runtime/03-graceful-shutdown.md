# 2.3 — Graceful Shutdown

> **Capstone connection:** Every rolling deployment in Module 3 terminates old pods. Without graceful shutdown, those terminations cause 500 errors for users mid-request. With it, the pod drains cleanly and users never see the deploy.

---

## The Problem Without Graceful Shutdown

Without graceful shutdown, a Kubernetes rolling update works like this:

```
1. Kubernetes sends SIGTERM to old Pod
2. JVM receives SIGTERM → exits immediately (default behavior)
3. In-flight HTTP requests → connection reset → HTTP 500 to users
4. New Pod starts serving
```

Step 3 is the problem. If your service processes 100 requests/second and each takes ~50ms, at any given moment there are ~5 in-flight requests. Every rolling update terminates those 5 requests abruptly.

With graceful shutdown:

```
1. Kubernetes sends SIGTERM to old Pod
2. Spring Boot sets readiness to OUT_OF_SERVICE (no new traffic)
3. Load balancer stops routing new requests to this Pod
4. Spring Boot waits for in-flight requests to complete (up to timeout)
5. JVM exits cleanly
6. New Pod takes all traffic
```

Zero dropped requests.

---

## The Signal Chain: SIGTERM Path in Docker

Understanding who receives SIGTERM and when is essential to implementing this correctly.

**Shell form ENTRYPOINT (wrong):**
```
docker stop → SIGTERM → /bin/sh → (may or may not forward to Java) → timeout → SIGKILL
```

**Exec form ENTRYPOINT (correct):**
```
docker stop → SIGTERM → java (PID 1) → Spring Boot graceful shutdown → JVM exits
```

The JVM must be PID 1 (or PID 1 must explicitly forward signals). With exec form, Docker sends SIGTERM directly to the JVM. Spring Boot registers a JVM shutdown hook on `SignalHandler` and initiates graceful shutdown.

```dockerfile
# Wrong — /bin/sh is PID 1, java is a child process
ENTRYPOINT java org.springframework.boot.loader.launch.JarLauncher

# Correct — java is PID 1
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

---

## Spring Boot Graceful Shutdown Configuration

```yaml
# application.yml
server:
  shutdown: graceful        # Key setting — enables the graceful shutdown mechanism

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s   # Max time to wait for in-flight requests
```

When `shutdown: graceful` is set:

1. Spring Boot's `SmartLifecycle` components receive a stop signal
2. The embedded Tomcat stops accepting new connections
3. Spring Boot waits up to `timeout-per-shutdown-phase` for current requests to complete
4. If a request doesn't complete within the timeout, it is terminated
5. Spring beans are destroyed (connection pools closed, etc.)
6. JVM exits

**What timeout to set:** choose a value slightly higher than your worst-case request duration. If your API has a 10-second timeout for downstream calls, set `timeout-per-shutdown-phase: 15s`. Do not set it arbitrarily large — it controls the maximum delay of a rolling deployment.

---

## Kubernetes `terminationGracePeriodSeconds`

Kubernetes has its own timeout for pod termination:

```yaml
spec:
  terminationGracePeriodSeconds: 60   # Default is 30s
```

The sequence:
1. SIGTERM sent to container
2. Kubernetes waits `terminationGracePeriodSeconds`
3. If container is still running → SIGKILL (no graceful shutdown possible)

**Rule:** `terminationGracePeriodSeconds` must be greater than Spring's `timeout-per-shutdown-phase` plus the `preStop` hook duration. Otherwise Kubernetes SIGKILL interrupts Spring's graceful drain.

```
terminationGracePeriodSeconds > preStop hook (5s) + Spring timeout (30s) + buffer (10s)
→ terminationGracePeriodSeconds: 60  ✅
```

---

## The `preStop` Hook — The Missing Piece

Even with all the above, there is still a race condition:

```
T=0: SIGTERM sent to Pod
T=0: Kubernetes removes Pod from Service endpoints (eventually consistent)
T=1: Some requests still arrive at the Pod (load balancer hasn't caught up yet)
T=1: Spring starts refusing new connections (shutdown in progress)
T=1: Those late-arriving requests → connection refused → error
```

The load balancer update is eventually consistent. There is a brief window (typically 1–5 seconds) where traffic still flows to a pod that has already begun shutting down.

The fix is the `preStop` hook — a sleep before shutdown begins:

```yaml
# In Kubernetes Deployment spec:
lifecycle:
  preStop:
    exec:
      command: ["sh", "-c", "sleep 5"]
```

Revised sequence:
```
T=0: SIGTERM sent to Pod
T=0: preStop hook runs (sleep 5s)
T=0–5: Load balancer drains connections (5 seconds is enough for k8s endpoint update)
T=5: Spring Boot begins graceful shutdown (no more new requests arriving)
T=5–35: In-flight requests complete
T=35: JVM exits cleanly
```

This 5-second sleep costs 5 seconds per rolling deployment per pod. For most services, this is acceptable. It is a fundamental Kubernetes deployment pattern.

---

## Graceful Shutdown for `order-worker`

The worker doesn't handle HTTP — it processes SQS messages. Graceful shutdown for the worker means: **finish the current message before stopping**.

```java
// consumer/SqsMessageConsumer.java
@Component
@Slf4j
public class SqsMessageConsumer implements SmartLifecycle {

    private final OrderProcessor orderProcessor;
    private final SqsClient sqsClient;
    private volatile boolean running = false;
    private final AtomicBoolean processingMessage = new AtomicBoolean(false);

    @Override
    public void start() {
        running = true;
        // Start polling in a background thread
        Thread.ofVirtual().start(this::pollLoop);
        log.info("SQS consumer started");
    }

    @Override
    public void stop() {
        log.info("Stopping SQS consumer — waiting for in-flight message to complete");
        running = false;
        // Wait for the current message to finish processing
        while (processingMessage.get()) {
            try { Thread.sleep(100); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        log.info("SQS consumer stopped cleanly");
    }

    @Override
    public boolean isRunning() { return running; }

    @Override
    public int getPhase() {
        return Integer.MAX_VALUE;  // Stop last (after other beans)
    }

    private void pollLoop() {
        while (running) {
            List<Message> messages = sqsClient.receiveMessage(/* ... */).messages();
            for (Message message : messages) {
                if (!running) break;
                processingMessage.set(true);
                try {
                    orderProcessor.process(message);
                    sqsClient.deleteMessage(/* ... */);
                } catch (Exception e) {
                    log.error("Failed to process message", e);
                } finally {
                    processingMessage.set(false);
                }
            }
        }
    }
}
```

When `stop()` is called (from Spring's graceful shutdown), the consumer stops polling but waits for the current message to complete before returning. The Spring lifecycle then destroys beans and the JVM exits cleanly.

---

## Common Mistakes

**Using `server.shutdown=immediate` (default before Spring Boot 2.3).**  
The JVM shuts down as soon as SIGTERM is received, regardless of in-flight requests. Dropped requests on every deploy.

**Setting `terminationGracePeriodSeconds` shorter than `timeout-per-shutdown-phase`.**  
Kubernetes SIGKILL interrupts Spring's graceful drain. The entire timeout setting becomes useless.

**Not adding `preStop` sleep.**  
The load balancer window race condition causes dropped connections on every pod termination, even with graceful shutdown properly configured in Spring.

**Catching `InterruptedException` and ignoring it.**  
```java
try { Thread.sleep(1000); } catch (InterruptedException e) { /* ignore */ }
```
The interrupt signal is the JVM's mechanism to stop threads during shutdown. Ignoring it means threads keep running past the graceful shutdown window.

---

## Exercise 2.3

**Task:** Verify graceful shutdown works.

1. Ensure `server.shutdown=graceful` is configured.
2. Start `order-api` locally: `./mvnw spring-boot:run`.
3. Send a request that takes 3 seconds (add a `Thread.sleep(3000)` temporarily in a controller method).
4. While that request is in flight, send `kill -15 <pid>` (SIGTERM).
5. Observe: the in-flight request completes, then the server shuts down.
6. Repeat with `kill -9 <pid>` (SIGKILL) — observe the request is dropped immediately.

**Answer — expected log output with graceful shutdown:**

```
2024-01-15 10:30:00 INFO  Received SIGTERM
2024-01-15 10:30:00 INFO  Commencing graceful shutdown. Waiting for active requests to complete
2024-01-15 10:30:03 INFO  [Request completed after 3s]
2024-01-15 10:30:03 INFO  Graceful shutdown complete
2024-01-15 10:30:03 INFO  Stopping application context
```

---

## Interview Mode

**Question:** *"How do you ensure zero downtime during Kubernetes rolling deployments?"*

**90-second answer:**
> "There are three things that have to work together.
>
> First, Spring Boot graceful shutdown: `server.shutdown=graceful` with a `timeout-per-shutdown-phase`. When the pod receives SIGTERM, Spring stops accepting new requests but waits for in-flight ones to complete before the JVM exits.
>
> Second, the `preStop` lifecycle hook in the Kubernetes spec — a 5-second sleep before SIGTERM takes effect. This is necessary because the Kubernetes load balancer update is eventually consistent. Without the sleep, traffic still arrives at the pod for a few seconds after SIGTERM is sent, and those requests hit a server that's already refusing connections.
>
> Third, the Kubernetes `terminationGracePeriodSeconds` must be longer than the preStop sleep plus Spring's timeout — otherwise Kubernetes SIGKILL interrupts the drain. I set it to 60 seconds typically: 5 for preStop, 30 for Spring drain, 25 as buffer.
>
> With all three, a rolling deployment terminates old pods cleanly while new pods are fully ready, and users never see errors."

---

*Next: [Chapter 2.4 — Health Probes in Docker →](./04-health-probes-docker.md)*
