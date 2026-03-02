# 7.4 — Health & Readiness Probes

> **Capstone connection:** Kubernetes won't route traffic to a pod until its readiness probe passes. If the pod can't reach the database or SQS, it should be removed from rotation — not killed and restarted. This chapter implements a production-grade readiness probe for `order-api` that checks both PostgreSQL and SQS connectivity.

---

## The Problem With a Simple HTTP Check

Many teams configure readiness probes as:
```yaml
readinessProbe:
  httpGet:
    path: /actuator/health
    port: 8081
```

This passes as soon as the JVM starts. It says nothing about whether the database is connected, whether the SQS queue is reachable, or whether the application has finished warming up.

**The consequence:** Kubernetes routes traffic to a pod that will fail every request because the database connection pool hasn't established connections yet. Clients see errors during pod startup.

---

## Liveness vs Readiness: The Operational Difference

| | Readiness | Liveness |
|--|-----------|----------|
| **Question** | Is this pod ready to receive traffic? | Is this JVM alive? |
| **Failure action** | Remove pod from Service endpoints | Kill and restart the container |
| **Use for** | DB slow, SQS unreachable, warming up | Deadlock, OOM, hung process |
| **Check content** | DB connection, queue reachability | JVM responding (shallow check) |

**The critical rule:** Never put database or external service checks in liveness. If the database goes down, liveness fails → Kubernetes restarts all pods simultaneously → restart storm during a DB outage — the worst time. The JVM is alive even if the DB is down. Liveness should only verify the JVM is responding.

```
Readiness failing → pod removed from load balancer rotation → no new traffic
Liveness failing  → pod killed and restarted → brief downtime for that pod
```

---

## Spring Boot Actuator Health Groups

Spring Boot 2.3+ supports separate probes mapped to Kubernetes concepts:

```yaml
management:
  health:
    livenessstate:
      enabled: true
    readinessstate:
      enabled: true
  endpoint:
    health:
      probes:
        enabled: true
      group:
        readiness:
          include: readinessState, db, sqs
        liveness:
          include: livenessState
```

This creates:
- `/actuator/health/liveness` — checks only JVM liveness state
- `/actuator/health/readiness` — checks readiness state + `db` (auto-configured) + `sqs` (custom)

The `db` indicator is auto-configured by Spring Data — it verifies a JDBC connection is obtainable from HikariCP. The `sqs` indicator needs to be implemented.

---

## Implementing `SqsHealthIndicator`

The SQS health check needs to be:
1. **Cheap:** not making an SQS call on every probe (probes run every 10s in K8s)
2. **Non-blocking:** a slow SQS response shouldn't hold the probe thread indefinitely
3. **Stable:** a brief SQS hiccup shouldn't repeatedly flip readiness and cause traffic storms

The solution: cache the result for 15 seconds.

```java
// config/health/SqsHealthIndicator.java
@Component("sqs")
@ConditionalOnProperty(
    name = "management.health.sqs.enabled",
    havingValue = "true",
    matchIfMissing = true
)
@Slf4j
public class SqsHealthIndicator implements HealthIndicator {

    private final SqsClient sqsClient;
    private final String queueUrl;

    private volatile Health cachedHealth = Health.unknown().build();
    private volatile Instant lastCheck = Instant.EPOCH;
    private static final Duration CACHE_TTL = Duration.ofSeconds(15);

    public SqsHealthIndicator(SqsClient sqsClient,
                               @Value("${app.sqs.order-queue-url}") String queueUrl) {
        this.sqsClient = sqsClient;
        this.queueUrl = queueUrl;
    }

    @Override
    public Health health() {
        if (Duration.between(lastCheck, Instant.now()).compareTo(CACHE_TTL) > 0) {
            cachedHealth = checkSqs();
            lastCheck = Instant.now();
        }
        return cachedHealth;
    }

    private Health checkSqs() {
        try {
            sqsClient.getQueueAttributes(
                GetQueueAttributesRequest.builder()
                    .queueUrl(queueUrl)
                    .attributeNames(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES)
                    .build()
            );
            return Health.up()
                .withDetail("queue", "reachable")
                .withDetail("url", queueUrl)
                .build();
        } catch (Exception ex) {
            log.warn("SQS health check failed: {}", ex.getMessage());
            return Health.down()
                .withDetail("error", ex.getMessage())
                .withDetail("url", queueUrl)
                .build();
        }
    }
}
```

**Disable in dev (LocalStack may not be running):**
```yaml
# application-dev.yml
management:
  health:
    sqs:
      enabled: false
```

---

## Kubernetes Probe Configuration

```yaml
# capstone/k8s/order-api/deployment.yaml
spec:
  template:
    spec:
      containers:
        - name: order-api
          image: order-api:latest
          ports:
            - containerPort: 8080   # application
            - containerPort: 8081   # management

          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8081
            initialDelaySeconds: 15   # wait for Spring context + DB pool
            periodSeconds: 10
            failureThreshold: 3       # 3 consecutive failures = not ready
            successThreshold: 1

          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8081
            initialDelaySeconds: 30   # JVM must be fully started
            periodSeconds: 15
            failureThreshold: 3
            successThreshold: 1

          startupProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8081
            initialDelaySeconds: 10
            periodSeconds: 5
            failureThreshold: 30     # 30 * 5s = 150s max startup time for slow JVM
```

**`startupProbe` pattern:** The startup probe prevents liveness from triggering a restart during slow JVM startup. Once the startup probe succeeds, Kubernetes switches to the liveness probe. This is the correct pattern for JVM services which can take 10–30 seconds to start.

---

## What the Readiness Response Looks Like

```bash
curl http://localhost:8081/actuator/health/readiness | jq .
```

Healthy:
```json
{
  "status": "UP",
  "components": {
    "db": {
      "status": "UP",
      "details": { "database": "PostgreSQL", "validationQuery": "isValid()" }
    },
    "readinessState": {
      "status": "UP"
    },
    "sqs": {
      "status": "UP",
      "details": { "queue": "reachable", "url": "http://localhost:4566/000000000000/dev-order-created-queue" }
    }
  }
}
```

DB down:
```json
{
  "status": "DOWN",
  "components": {
    "db": {
      "status": "DOWN",
      "details": { "error": "Unable to acquire JDBC Connection" }
    },
    "readinessState": { "status": "UP" },
    "sqs": { "status": "UP", "details": { "queue": "reachable" } }
  }
}
```

Kubernetes receives HTTP 503 for DOWN status → removes pod from endpoints → no new traffic sent to this pod.

---

## Common Mistakes

**DB check in liveness probe:**

❌ `livenessProbe: path: /actuator/health` (which includes DB check)
✅ `livenessProbe: path: /actuator/health/liveness` (JVM only)
✅ `readinessProbe: path: /actuator/health/readiness` (includes DB and SQS)

**Setting `initialDelaySeconds` too low:**

❌ `initialDelaySeconds: 5` for a Spring Boot app — connection pool needs time to establish
✅ Start with 15–20 seconds; use `startupProbe` for slow JVM environments

**Not caching the SQS health check:**

❌ Making an SQS API call on every probe invocation (every 10s × number of pods × SQS latency)
✅ Cache result for 15 seconds — only one SQS call per 15 seconds per pod

**Returning HTTP 200 with `status: DOWN` body:**

❌ Custom health endpoint that always returns 200 regardless of health state
✅ Spring Boot returns HTTP 200 for UP and HTTP 503 for DOWN automatically — don't override this

**Missing `show-details` configuration:**

❌ `/actuator/health` returns only `{"status":"UP"}` — no details
✅ `management.endpoint.health.show-details: when-authorized` or `always` (only in internal clusters)

---

## Exercise 7.4

Implement a `DatabaseHealthIndicator` that goes beyond the default Spring Boot DB check:

1. Check whether a connection is obtainable (default behavior)
2. Also check that `SELECT 1` completes in under 500ms
3. Return `Health.degraded()` (or `Health.down()`) with detail `"responseTimeMs"` if it exceeds 500ms

Write a unit test using a mock `DataSource` that:
- Asserts `Health.up()` when the query completes in 10ms
- Asserts `Health.down()` when the query takes 600ms (simulated with `Thread.sleep`)

### Answer

```java
// config/health/DatabaseLatencyHealthIndicator.java
@Component("dbLatency")
@Slf4j
public class DatabaseLatencyHealthIndicator implements HealthIndicator {

    private final DataSource dataSource;
    private static final long THRESHOLD_MS = 500;

    public DatabaseLatencyHealthIndicator(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public Health health() {
        long start = System.currentTimeMillis();
        try (Connection connection = dataSource.getConnection();
             PreparedStatement stmt = connection.prepareStatement("SELECT 1")) {

            stmt.executeQuery();
            long elapsed = System.currentTimeMillis() - start;

            if (elapsed > THRESHOLD_MS) {
                return Health.down()
                    .withDetail("responseTimeMs", elapsed)
                    .withDetail("threshold", THRESHOLD_MS)
                    .withDetail("reason", "Query exceeded latency threshold")
                    .build();
            }

            return Health.up()
                .withDetail("responseTimeMs", elapsed)
                .build();

        } catch (SQLException ex) {
            long elapsed = System.currentTimeMillis() - start;
            return Health.down(ex)
                .withDetail("responseTimeMs", elapsed)
                .build();
        }
    }
}
```

**Test:**
```java
class DatabaseLatencyHealthIndicatorTest {

    @Test
    void returnsUp_whenQueryIsFast() throws Exception {
        DataSource ds = mock(DataSource.class);
        Connection conn = mock(Connection.class);
        PreparedStatement stmt = mock(PreparedStatement.class);

        when(ds.getConnection()).thenReturn(conn);
        when(conn.prepareStatement("SELECT 1")).thenReturn(stmt);
        when(stmt.executeQuery()).thenReturn(mock(ResultSet.class));

        DatabaseLatencyHealthIndicator indicator = new DatabaseLatencyHealthIndicator(ds);
        Health result = indicator.health();

        assertThat(result.getStatus()).isEqualTo(Status.UP);
        assertThat((Long) result.getDetails().get("responseTimeMs")).isLessThan(500L);
    }

    @Test
    void returnsDown_whenQueryIsSlow() throws Exception {
        DataSource ds = mock(DataSource.class);
        Connection conn = mock(Connection.class);
        PreparedStatement stmt = mock(PreparedStatement.class);

        when(ds.getConnection()).thenReturn(conn);
        when(conn.prepareStatement("SELECT 1")).thenReturn(stmt);
        when(stmt.executeQuery()).thenAnswer(inv -> {
            Thread.sleep(600);   // simulate slow query
            return mock(ResultSet.class);
        });

        DatabaseLatencyHealthIndicator indicator = new DatabaseLatencyHealthIndicator(ds);
        Health result = indicator.health();

        assertThat(result.getStatus()).isEqualTo(Status.DOWN);
        assertThat((Long) result.getDetails().get("responseTimeMs")).isGreaterThan(500L);
    }
}
```

Register it in the readiness group:
```yaml
management:
  endpoint:
    health:
      group:
        readiness:
          include: readinessState, db, dbLatency, sqs
```

---

## Interview Mode

**Question:** *"What's the difference between readiness and liveness probes in Kubernetes?"*

> "They answer different questions and have different consequences on failure.
>
> Readiness asks: is this pod ready to receive traffic right now? If it fails, Kubernetes removes the pod from the Service's endpoint list — no new traffic routes to it, but the pod keeps running. This is the right behavior when the pod is temporarily unable to serve: DB is overloaded, the queue is unreachable, or the application is warming up its caches.
>
> Liveness asks: is the JVM alive? If it fails, Kubernetes kills and restarts the container. This is for detecting a truly stuck or hung process — a deadlock or OOM that left the process unresponsive.
>
> The critical mistake is checking the database in the liveness probe. If the database goes down, liveness fails, Kubernetes restarts all pods — now you have a restart storm during a DB outage, the worst possible time. Liveness should only check that the JVM itself is responding. DB and queue checks belong in readiness.
>
> I also use a startup probe. It gives the JVM 150 seconds to start before liveness kicks in. Without it, a slow cold start during a rolling update triggers liveness failure and a restart loop."

---

*Next: [7.5 — Production Runbook & Milestone M7](./05-production-runbook.md)*
