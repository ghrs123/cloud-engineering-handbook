# 1.5 — Spring Actuator & Health Endpoints

> **Capstone connection:** The Kubernetes manifests in Module 3 will configure `readinessProbe` and `livenessProbe` pointing to Actuator endpoints. If those endpoints are not correctly configured now, the Kubernetes deployment will fail or route traffic to an unhealthy instance.

---

## What Kubernetes Actually Needs From Your Service

Kubernetes makes two binary decisions about every Pod:

**Should this Pod receive traffic?**  
Answered by the **readiness probe**. If it returns non-200, the Pod is removed from the Service's endpoint list. No traffic is routed to it until it recovers.

**Should this Pod be restarted?**  
Answered by the **liveness probe**. If it returns non-200 repeatedly, Kubernetes kills and restarts the container.

These are different concerns and must be implemented differently. Using the same endpoint for both, or using a heavy endpoint for liveness, are common mistakes with real production consequences.

---

## Readiness vs Liveness — The Critical Distinction

| Probe | Purpose | What to check | On failure |
|---|---|---|---|
| `readinessProbe` | Is the app ready to serve traffic? | DB connectivity, queue reachable, caches warm | Remove from load balancer rotation |
| `livenessProbe` | Is the JVM alive? | Simple "is the process responding?" | Restart the container |

**The failure mode of getting this wrong:**

- If you put DB connectivity in the **liveness** probe and the DB goes down, Kubernetes restarts all your Pods. Now you have a mass restart storm during a DB outage, exactly when you need your apps to be stable. The correct behavior is to remove them from the load balancer (readiness) but keep them running.

- If you use only a simple ping for the **readiness** probe, traffic is routed to instances that cannot actually process requests (DB disconnected, queue unreachable). Users get errors.

---

## Spring Boot 2.3+ Actuator Configuration

Spring Boot 2.3 introduced separate health groups for Kubernetes probes:

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health, info, prometheus, loggers
  endpoint:
    health:
      show-details: when-authorized
      probes:
        enabled: true           # Enables /actuator/health/readiness and /actuator/health/liveness
      group:
        readiness:
          include: db, sqs      # What readiness checks (you define "sqs" below)
        liveness:
          include: ping         # Just: is the JVM responding?

  # Expose Prometheus metrics (Module 7 will configure scraping)
  metrics:
    export:
      prometheus:
        enabled: true

spring:
  application:
    name: order-api
```

With `probes.enabled: true`, Spring Boot automatically uses `ApplicationAvailability` to manage readiness/liveness state transitions (including during graceful shutdown — readiness goes DOWN before the JVM shuts down, so Kubernetes stops routing traffic before the process exits).

---

## Custom Health Indicator for SQS

The default Spring Boot health indicators cover the database (via DataSource). You need to add one for SQS:

```java
// config/health/SqsHealthIndicator.java
@Component("sqs")   // the name used in health group config above
@Slf4j
public class SqsHealthIndicator implements HealthIndicator {

    private final SqsClient sqsClient;
    private final String queueUrl;

    public SqsHealthIndicator(SqsClient sqsClient,
                               @Value("${sqs.order.queue.url}") String queueUrl) {
        this.sqsClient = sqsClient;
        this.queueUrl = queueUrl;
    }

    @Override
    public Health health() {
        try {
            // GetQueueAttributes is a lightweight call — just checks reachability
            sqsClient.getQueueAttributes(
                GetQueueAttributesRequest.builder()
                    .queueUrl(queueUrl)
                    .attributeNames(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES)
                    .build()
            );
            return Health.up()
                .withDetail("queue", queueUrl)
                .build();
        } catch (Exception ex) {
            log.warn("SQS health check failed: {}", ex.getMessage());
            return Health.down()
                .withDetail("queue", queueUrl)
                .withException(ex)
                .build();
        }
    }
}
```

**Trade-off:** calling SQS on every readiness check adds latency and can fail for transient network reasons. Consider caching the result with a short TTL (10–30 seconds) for high-frequency probes.

For local development and tests, disable the SQS health indicator:
```yaml
# application-dev.yml
management:
  health:
    sqs:
      enabled: false
```

---

## Security — Don't Expose Actuator Publicly

Actuator endpoints contain sensitive information: heap dumps, thread dumps, environment variables (including credentials if you are not careful), log levels. They must not be accessible from the public internet.

Two options:

**Option A: Different port for management (preferred for Kubernetes)**
```yaml
management:
  server:
    port: 8081     # Management on a different port than the app (8080)
```
In Kubernetes, the service only exposes port 8080. Pods can reach 8081 directly (for probes) but it is never exposed via the Service or Ingress.

**Option B: Restrict via Spring Security**
```java
@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health/**").permitAll()
                .requestMatchers("/actuator/**").hasRole("ACTUATOR_ADMIN")
                .requestMatchers("/orders/**").authenticated()
            )
            .addFilterBefore(apiKeyFilter(), UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
```

For this capstone, Option A is used: management on port 8081, app on 8080.

---

## Graceful Shutdown Integration

Spring Boot's graceful shutdown (`server.shutdown=graceful`) integrates with Actuator probes automatically:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s   # Wait up to 30s for in-flight requests to complete
```

**Shutdown sequence:**
1. Kubernetes sends SIGTERM
2. `preStop` hook runs (sleep 5s — gives load balancer time to drain)
3. Spring sets readiness to `OUT_OF_SERVICE` → Pod is removed from Service endpoints
4. Spring waits up to 30s for in-flight requests to complete
5. Spring closes connections, stops accepting new requests
6. JVM exits

If you do not configure this, the Pod can be killed while handling a request, causing 500 errors for that request's client.

---

## The Full `application.yml` for Module 1

```yaml
spring:
  application:
    name: order-api
  datasource:
    url: ${SPRING_DATASOURCE_URL:jdbc:postgresql://localhost:5432/orderdb}
    username: ${SPRING_DATASOURCE_USERNAME:orderuser}
    password: ${SPRING_DATASOURCE_PASSWORD:orderpass}
    hikari:
      maximum-pool-size: 10
      minimum-idle: 2
      connection-timeout: 5000
      idle-timeout: 300000
  jpa:
    hibernate:
      ddl-auto: validate          # Never auto-create in prod; use Flyway/Liquibase
    show-sql: false
    open-in-view: false           # CRITICAL: disable OSIV to prevent lazy loading outside transactions
  lifecycle:
    timeout-per-shutdown-phase: 30s

server:
  port: 8080
  shutdown: graceful

management:
  server:
    port: 8081
  endpoints:
    web:
      exposure:
        include: health, info, prometheus, loggers
  endpoint:
    health:
      probes:
        enabled: true
      group:
        readiness:
          include: db, sqs
        liveness:
          include: ping
  metrics:
    tags:
      application: ${spring.application.name}
      environment: ${APP_ENVIRONMENT:local}
```

**Why `open-in-view: false`?**  
The Open Session in View pattern keeps a Hibernate session open for the entire HTTP request, including during JSON serialization. This hides lazy-loading bugs in development (they work because the session is still open) that explode in production (transaction has closed). Disabling it forces you to fetch everything you need within a transaction.

---

## Common Mistakes

**Checking external dependencies in the liveness probe.**  
If the database goes down, liveness fails → Kubernetes restarts all pods → you now have a mass restart during a DB outage. Liveness should only verify the JVM is responsive.

**Not configuring graceful shutdown.**  
Without it, a rolling update terminates pods while they're handling requests. Every deploy causes some percentage of in-flight requests to fail.

**Not securing the Actuator.**  
`/actuator/env` lists all environment variables. If your service has `SPRING_DATASOURCE_PASSWORD` in the environment (it does), this endpoint exposes it. Use a management port, a security rule, or both.

---

## Exercise 1.5

**Task:** Configure Actuator for production readiness.

1. Configure `application.yml` with separate management port 8081, readiness + liveness probes, and Prometheus enabled.
2. Implement `SqsHealthIndicator` (you can mock the SQS call for now).
3. Configure `server.shutdown=graceful` with a 30-second timeout.
4. Write a test that verifies `/actuator/health/readiness` returns 200 and `/actuator/health/liveness` returns 200.

**Answer:**

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"management.server.port=0"})   // random port for test
@AutoConfigureTestDatabase
class ActuatorHealthTest {

    @LocalServerPort
    int managementPort;

    @Autowired
    TestRestTemplate restTemplate;

    @Test
    void readinessProbe_returnsUp() {
        // Note: management port is different from app port
        ResponseEntity<String> response = restTemplate.getForEntity(
            "http://localhost:" + managementPort + "/actuator/health/readiness",
            String.class
        );
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).contains("\"status\":\"UP\"");
    }

    @Test
    void livenessProbe_returnsUp() {
        ResponseEntity<String> response = restTemplate.getForEntity(
            "http://localhost:" + managementPort + "/actuator/health/liveness",
            String.class
        );
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }
}
```

---

## Interview Mode

**Question:** *"What's the difference between a readiness probe and a liveness probe in Kubernetes?"*

**60-second answer:**
> "They answer different questions. The readiness probe asks: is this Pod ready to receive traffic right now? If it fails, Kubernetes removes the Pod from the load balancer rotation but does not restart it. The liveness probe asks: is the JVM itself alive? If it fails repeatedly, Kubernetes restarts the container.
>
> The critical mistake is putting dependency checks in the liveness probe. If the database goes down and your liveness probe checks the database, Kubernetes will restart all your pods during a database outage — the worst possible time for a restart storm.
>
> In Spring Boot 2.3+, I use separate health groups. Readiness checks the database and any queues the service depends on. Liveness uses just the built-in `ping` indicator — it only verifies the JVM is responding.
>
> I also configure graceful shutdown so that when a Pod receives SIGTERM, it stops accepting new requests, finishes in-flight ones, and then exits cleanly. Without this, rolling updates cause dropped requests."

---

*Next: [Chapter 1.6 — Capstone Milestone M1 →](./06-capstone-milestone.md)*
