# 2.4 — Health Probes in Docker

> **Capstone connection:** The `docker-compose.yml` in Milestone M2 uses health checks to ensure `order-api` and `order-worker` only receive traffic after postgres and localstack are fully ready. Without this, services crash on startup because the DB isn't ready.

---

## Docker HEALTHCHECK vs Kubernetes Probes

These are different mechanisms with different scopes:

| | Docker HEALTHCHECK | Kubernetes readinessProbe / livenessProbe |
|---|---|---|
| Scope | Single container | Pod managed by K8s |
| Used by | `docker-compose` `depends_on` conditions, `docker ps` | K8s scheduler, Service endpoints |
| Format | Shell command in Dockerfile | HTTP, TCP, or exec |
| Effect | Sets container status (healthy/unhealthy) | Controls traffic routing and pod restarts |

For Kubernetes production, use K8s probes (configured in Deployment YAML, Module 3). For local development with `docker-compose`, use `HEALTHCHECK` in the Dockerfile and `depends_on: condition: service_healthy` in `docker-compose.yml`.

---

## HEALTHCHECK in Dockerfile

```dockerfile
# Lightweight check using wget (available in Alpine)
# --quiet: no output on success
# -O-: output to stdout (discarded)
# --spider: just check URL, don't download body
HEALTHCHECK \
    --interval=10s \
    --timeout=5s \
    --start-period=30s \
    --retries=3 \
    CMD wget -qO- http://localhost:8081/actuator/health/readiness || exit 1
```

Parameter explanation:

| Parameter | Value | Meaning |
|---|---|---|
| `--interval` | 10s | Run health check every 10 seconds |
| `--timeout` | 5s | Health check must complete within 5 seconds |
| `--start-period` | 30s | Grace period after container start before failures count |
| `--retries` | 3 | 3 consecutive failures → container marked unhealthy |

**Why `--start-period: 30s`?** Spring Boot startup time is typically 10–20 seconds. Without a start period, Docker marks the container unhealthy during normal startup, causing docker-compose to consider dependent services to have failed.

**Why `wget` and not `curl`?** Alpine Linux includes `wget` by default but not `curl`. Using `curl` requires installing it explicitly (adds ~2MB to image). For a simple GET health check, `wget` is sufficient and already available.

If your image is Debian-based (not Alpine), `curl` is available:
```dockerfile
HEALTHCHECK CMD curl -f http://localhost:8081/actuator/health/readiness || exit 1
```

---

## Startup Timing Reality Check

Understanding actual startup times prevents misconfigurations:

```
T=0:   Docker starts container
T=1:   JVM starts
T=3:   Spring context begins loading
T=8:   DataSource connected, connection pool initialized
T=12:  Flyway migrations run
T=15:  All beans initialized
T=16:  Tomcat started, accepting connections
T=17:  First HEALTHCHECK runs → readiness UP
```

For this sequence, `--start-period: 30s` is conservative and safe. Production services with more dependencies or slower databases may need longer.

Kubernetes equivalent in `deployment.yaml`:
```yaml
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8081
  initialDelaySeconds: 20    # Start checking at T=20
  periodSeconds: 10
  failureThreshold: 3        # 3 failures = unhealthy (T=20 + 3×10 = T=50 max wait)
```

---

## The `depends_on` / `condition: service_healthy` Pattern

Without health check conditions in docker-compose:

```yaml
# Without condition — services start in parallel, ordering not guaranteed
order-api:
  depends_on:
    - postgres
    - localstack
```

Postgres takes 5 seconds to initialize. `order-api` starts, tries to connect to postgres at T=2, fails, crashes. Docker restarts it. Eventually it starts after postgres is ready. Fragile, slow, and noisy in logs.

With health check conditions:

```yaml
order-api:
  depends_on:
    postgres:
      condition: service_healthy      # Wait until postgres HEALTHCHECK passes
    localstack:
      condition: service_healthy      # Wait until localstack HEALTHCHECK passes
```

`order-api` does not start until both postgres and localstack report healthy. Clean startup, no retries, deterministic.

**This requires** that postgres and localstack define their own `HEALTHCHECK` (or `healthcheck` in compose). PostgreSQL's official image includes a built-in health check you can reference:

```yaml
postgres:
  image: postgres:16-alpine
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
    interval: 5s
    timeout: 5s
    retries: 10
    start_period: 10s
```

---

## Diagnosing Health Check Failures

```bash
# Check container health status
docker ps
# CONTAINER ID  ...  STATUS
# abc123        ...  Up 2 minutes (healthy)
# def456        ...  Up 30 seconds (unhealthy)

# Inspect health check results (last 5 attempts)
docker inspect --format='{{json .State.Health}}' order-api | jq .

# Output:
# {
#   "Status": "unhealthy",
#   "FailingStreak": 3,
#   "Log": [
#     {
#       "ExitCode": 1,
#       "Output": "wget: can't connect to remote host (127.0.0.1): Connection refused\n"
#     }
#   ]
# }

# Stream health check events
docker events --filter event=health_status
```

Common failure reasons:
- `Connection refused` → application not yet listening on port (startup not complete, check `--start-period`)
- `curl: (22) The requested URL returned error: 503` → readiness check returning DOWN (DB not connected)
- `timeout` → application started but health endpoint is too slow (check DB connection pool)

---

## Common Mistakes

**Using `curl` in Alpine-based images without installing it.**
```dockerfile
# Fails — curl not in Alpine by default
HEALTHCHECK CMD curl -f http://localhost:8081/actuator/health || exit 1

# Fix option A: use wget (already available)
HEALTHCHECK CMD wget -qO- http://localhost:8081/actuator/health || exit 1

# Fix option B: install curl (adds to image size)
RUN apk add --no-cache curl
HEALTHCHECK CMD curl -f http://localhost:8081/actuator/health || exit 1
```

**Setting `--start-period` too short.**  
On a slow machine or with many Flyway migrations, startup can take 40+ seconds. If `--start-period` is 15s, Docker starts counting failures at T=15, and 3 failures later marks the container unhealthy before Spring Boot is ready.

**Checking `/actuator/health` (aggregate) in Kubernetes liveness.**  
The aggregate health endpoint returns DOWN if any component is down — including the database. If the database goes down, your liveness probe fails and Kubernetes restarts all pods. Use `/actuator/health/liveness` (JVM only) for liveness, and `/actuator/health/readiness` (with dependencies) for readiness.

---

## Exercise 2.4

**Task:** Verify health check behavior in docker-compose.

1. Add `HEALTHCHECK` instructions to the `order-api` and `order-worker` Dockerfiles.
2. Add `healthcheck` blocks to postgres and localstack services in `docker-compose.yml`.
3. Add `condition: service_healthy` to `order-api` and `order-worker` `depends_on`.
4. Run `docker-compose up` and observe the startup sequence in logs.
5. Run `docker ps` after all services are up and confirm all show `(healthy)`.

**Answer — expected startup log sequence:**

```
[postgres]     | database system is ready to accept connections
[postgres]     | Status: healthy ✓
[localstack]   | Ready.
[localstack]   | Status: healthy ✓
[order-api]    | Starting OrderApiApplication
[order-api]    | Started in 14.2 seconds
[order-api]    | Tomcat started on port 8080
[order-api]    | Status: healthy ✓  (at T+30s from api start)
```

Without conditions:
```
[order-api]    | Connection refused (postgres not ready)
[order-api]    | Restarting...
[order-api]    | Connection refused
[order-api]    | Restarting...
[order-api]    | Started in 14.2 seconds  (eventually)
```

---

## Interview Mode

**Question:** *"How do you handle service startup ordering in Docker Compose and Kubernetes?"*

**60-second answer:**
> "In Docker Compose, I use `depends_on` with `condition: service_healthy`. Each service defines a `healthcheck` — for postgres it's `pg_isready`, for localstack it's their health endpoint. Dependent services only start when those health checks pass. This gives deterministic startup without sleep hacks or restart loops.
>
> In Kubernetes the approach is different — K8s doesn't have a dependency ordering mechanism like Compose. Instead, you rely on the application's own retry logic and readiness probes. The Deployment won't route traffic to a pod until the readiness probe passes, so if the database isn't ready, the pod stays unready and keeps retrying its Spring datasource initialization. Spring Boot's `spring.datasource.hikari.connection-timeout` and `spring.sql.init.continue-on-error` configure how it handles this.
>
> The key insight: in K8s you design for eventual availability, not startup ordering."

---

*Next: [Chapter 2.5 — Docker Compose for Local Dev →](./05-docker-compose.md)*
