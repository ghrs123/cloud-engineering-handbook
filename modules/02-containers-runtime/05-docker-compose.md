# 2.5 — Docker Compose for Local Dev

> **Capstone connection:** The `docker-compose.yml` you write here is the single command that brings up the entire capstone stack locally. Anyone who clones the repo runs `docker-compose up` and has a working system within 60 seconds.

---

## Design Goals for a Development Compose File

A good `docker-compose.yml` for local development satisfies:

1. **One command to start everything:** `docker-compose up -d`
2. **Deterministic startup:** services start in the right order (health-check controlled)
3. **No credentials in the file:** use environment variables with defaults
4. **Support for "infra-only" mode:** developers running the app locally still need postgres + localstack
5. **Fast iteration:** code changes don't require rebuilding images (volume mounts for local dev)
6. **Clean teardown:** `docker-compose down -v` leaves no orphaned state

---

## Environment Variable Strategy

Never hardcode credentials in `docker-compose.yml`. Use:

1. `.env` file (gitignored) — local dev values
2. Environment variable defaults in compose (`${VAR:-default}`)
3. Real secrets via environment injection in CI/CD

```bash
# .env (add to .gitignore!)
POSTGRES_PASSWORD=orderpass
APP_API_KEY=dev-secret-key
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

```yaml
# docker-compose.yml
environment:
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-orderpass}   # default if not in .env
```

---

## Two Modes: Full Stack vs Infra Only

Developers often want to run the Spring Boot app locally (with hot reload, debugger) but need postgres and localstack running in Docker. Support this with profiles:

```bash
# Mode 1: Full stack (everything in Docker)
docker-compose up -d

# Mode 2: Infrastructure only (developer runs apps locally)
docker-compose up -d postgres localstack

# Mode 3: With explicit profile
docker-compose --profile infra up -d
```

In `docker-compose.yml`, add `profiles` to the application services:

```yaml
order-api:
  profiles: ["full", "api"]   # Only started with these profiles, or with no profile
  # ...
```

When running `docker-compose up -d` with no profile, all services without a `profiles` key start. Add `profiles` to the app services to keep them out of infra-only mode.

---

## Volume Strategy

```yaml
volumes:
  postgres-data:    # Named volume — survives container restarts, not container removal
  localstack-data:  # Localstack state (queues persist between restarts)
```

**Named volumes vs bind mounts:**

| | Named volume | Bind mount |
|---|---|---|
| Data persistence | Survives `docker-compose down`, lost on `down -v` | Lives on host filesystem |
| Performance | Better on Mac (managed by Docker) | Slower on Mac (filesystem sync) |
| Use for | Database data, stateful service data | Source code, config files |

For developer source code hot-reload (optional):
```yaml
order-api:
  volumes:
    - ./services/order-api/target:/app/target   # Mount compiled output for hot reload
```

---

## Complete `docker-compose.yml` with All Patterns

```yaml
version: '3.9'

networks:
  order-net:
    driver: bridge

volumes:
  postgres-data:
  localstack-data:

# ─── Common environment for AWS/LocalStack ──────────────────────
x-aws-env: &aws-env
  AWS_ENDPOINT_OVERRIDE: http://localstack:4566
  AWS_REGION: us-east-1
  AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:-test}
  AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:-test}
  SQS_ORDER_QUEUE_URL: http://localstack:4566/000000000000/order-created-queue
  SQS_ORDER_DLQ_URL: http://localstack:4566/000000000000/order-created-dlq

# ─── Common environment for database ────────────────────────────
x-db-env: &db-env
  SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/orderdb
  SPRING_DATASOURCE_USERNAME: orderuser
  SPRING_DATASOURCE_PASSWORD: ${POSTGRES_PASSWORD:-orderpass}

services:

  # ── PostgreSQL ────────────────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    container_name: order-postgres
    networks: [order-net]
    environment:
      POSTGRES_DB: orderdb
      POSTGRES_USER: orderuser
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-orderpass}
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U orderuser -d orderdb"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  # ── LocalStack (SQS) ─────────────────────────────────────────
  localstack:
    image: localstack/localstack:3
    container_name: order-localstack
    networks: [order-net]
    environment:
      SERVICES: sqs
      LOCALSTACK_HOST: localstack
      DEBUG: ${LOCALSTACK_DEBUG:-0}
    ports:
      - "4566:4566"
    volumes:
      - localstack-data:/var/lib/localstack
      - ./localstack-init.sh:/etc/localstack/init/ready.d/init-sqs.sh:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4566/_localstack/health"]
      interval: 5s
      timeout: 5s
      retries: 20
      start_period: 15s

  # ── Order API ────────────────────────────────────────────────
  order-api:
    build:
      context: ../../services/order-api
      dockerfile: Dockerfile
      args:
        BUILD_VERSION: ${BUILD_VERSION:-local}
    container_name: order-api
    networks: [order-net]
    depends_on:
      postgres:
        condition: service_healthy
      localstack:
        condition: service_healthy
    environment:
      <<: [*aws-env, *db-env]
      SPRING_PROFILES_ACTIVE: docker
      APP_API_KEY: ${APP_API_KEY:-dev-secret-key}
      APP_ENVIRONMENT: local
      JAVA_TOOL_OPTIONS: >-
        -Xms128m -Xmx256m
        -XX:+UseContainerSupport
        -XX:MaxRAMPercentage=75.0
        -XX:+ExitOnOutOfMemoryError
        -Djava.security.egd=file:/dev/./urandom
    ports:
      - "8080:8080"    # App port
      - "8081:8081"    # Management/Actuator port
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8081/actuator/health/readiness"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 40s

  # ── Order Worker ──────────────────────────────────────────────
  order-worker:
    build:
      context: ../../services/order-worker
      dockerfile: Dockerfile
    container_name: order-worker
    networks: [order-net]
    depends_on:
      postgres:
        condition: service_healthy
      localstack:
        condition: service_healthy
    environment:
      <<: [*aws-env, *db-env]
      SPRING_PROFILES_ACTIVE: docker
      SERVER_PORT: 8082
      MANAGEMENT_SERVER_PORT: 8082
      APP_ENVIRONMENT: local
      JAVA_TOOL_OPTIONS: >-
        -Xms128m -Xmx256m
        -XX:+UseContainerSupport
        -XX:MaxRAMPercentage=75.0
        -XX:+ExitOnOutOfMemoryError
    ports:
      - "8082:8082"    # Worker management port (no public API)
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8082/actuator/health/readiness"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 40s
```

---

## YAML Anchors — Avoiding Repetition

The `x-aws-env` and `x-db-env` blocks use YAML anchors (`&`) and merge keys (`<<: *`):

```yaml
# Define (anchor):
x-aws-env: &aws-env
  AWS_REGION: us-east-1

# Use (alias):
environment:
  <<: *aws-env      # Merges all keys from x-aws-env
  OTHER_VAR: value  # Additional service-specific vars
```

This prevents copy-paste drift where one service has different AWS config than another.

---

## Useful Compose Commands

```bash
# Start all services in background
docker-compose up -d

# Follow logs of specific service
docker-compose logs -f order-api

# Check health status of all services
docker-compose ps

# Restart a single service (after code change)
docker-compose restart order-api

# Rebuild and restart a service (after Dockerfile change)
docker-compose up -d --build order-api

# Stop and remove containers, keep volumes
docker-compose down

# Stop and remove containers AND volumes (clean slate)
docker-compose down -v

# Run a one-off command in a service's container
docker-compose exec postgres psql -U orderuser orderdb

# Check SQS queues via LocalStack CLI
docker-compose exec localstack awslocal sqs list-queues
docker-compose exec localstack awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/order-created-queue \
  --attribute-names All
```

---

## Common Mistakes

**Not using health check conditions on `depends_on`.**  
Without `condition: service_healthy`, Compose just starts services in order without waiting for them to be ready. The application tries to connect before the DB is accepting connections.

**Exposing the management port (8081) publicly in production.**  
In compose for local dev, exposing `8081:8081` is fine. In Kubernetes, never expose the management port via the Service — it's only for internal pod-to-pod health probes and cluster monitoring scraping.

**Hardcoding credentials in the compose file.**  
Use `.env` files or environment variable defaults. Add `.env` to `.gitignore`. Never commit `APP_API_KEY: real-production-key` to git.

**Using `restart: always` without understanding consequences.**  
In development, `restart: always` makes diagnosis harder — a crashing container restarts so fast you miss the logs. Use `restart: on-failure:3` to allow inspection after repeated failures.

---

## Interview Mode

**Question:** *"How do you set up a local development environment for microservices?"*

**60-second answer:**
> "I use docker-compose with a focus on two things: correct startup ordering and separation between infrastructure and application containers.
>
> For ordering, I define `healthcheck` on every infrastructure service — postgres uses `pg_isready`, localstack uses its health API — and configure application services with `depends_on: condition: service_healthy`. The app only starts after dependencies are genuinely ready, not just running.
>
> For separation, I design the compose file so developers can run `docker-compose up -d postgres localstack` for just the infrastructure, then run the Spring Boot app locally from their IDE with hot reload and a debugger attached. This is faster for iteration than rebuilding Docker images on every code change.
>
> I also use YAML anchors for shared environment variables (AWS config, DB config) so there's one place to change them rather than duplicating across services."

---

*Next: [Chapter 2.6 — Capstone Milestone M2 →](./06-capstone-milestone.md)*
