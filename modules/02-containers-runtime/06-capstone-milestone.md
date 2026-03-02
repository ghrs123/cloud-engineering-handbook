# 2.6 — Capstone Milestone M2

> **Deliverable:** Both services run in Docker containers. `docker-compose up` starts the full stack (postgres + localstack + order-api + order-worker). All health probes pass. Images are under 300MB. Graceful shutdown is configured.

---

## Verification Checklist

- [ ] `docker build -t order-api:m2 .` succeeds in `services/order-api/` — no errors
- [ ] `docker build -t order-worker:m2 .` succeeds in `services/order-worker/` — no errors
- [ ] `docker images | grep order` shows both images under 300MB
- [ ] `docker-compose up -d` from `capstone/docker/` starts all 4 services without errors
- [ ] `docker-compose ps` shows all services as `(healthy)` within 90 seconds
- [ ] `POST /orders` works via docker-compose: `curl localhost:8080/orders`
- [ ] `GET /actuator/health/readiness` returns `{"status":"UP"}` from both services
- [ ] Logs show structured JSON with `correlationId` field
- [ ] `docker-compose down && docker-compose up -d` restores state from postgres volume (orders persist)
- [ ] Sending SIGTERM to the container (`docker stop --time=60 order-api`) shows graceful shutdown in logs

---

## Final `order-api` Dockerfile

```dockerfile
# services/order-api/Dockerfile

# ─── Stage 1: Build ───────────────────────────────────────────────────
FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /workspace

# Cache dependency downloads separately from source
COPY pom.xml .
COPY .mvn/ .mvn/
COPY mvnw .
RUN ./mvnw dependency:go-offline -B -q

COPY src/ src/
RUN ./mvnw package -DskipTests -B -q && \
    java -Djarmode=layertools \
         -jar target/*.jar \
         extract --destination /workspace/extracted

# ─── Stage 2: Runtime ─────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-alpine AS runtime

# Non-root user (required for OpenShift)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
WORKDIR /app

# Copy layers in order of change frequency
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/dependencies/ ./
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/spring-boot-loader/ ./
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/snapshot-dependencies/ ./
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/application/ ./

EXPOSE 8080
EXPOSE 8081

ENV JAVA_TOOL_OPTIONS="\
    -XX:+UseContainerSupport \
    -XX:MaxRAMPercentage=75.0 \
    -XX:InitialRAMPercentage=50.0 \
    -XX:+ExitOnOutOfMemoryError \
    -Djava.security.egd=file:/dev/./urandom \
    -Dfile.encoding=UTF-8"

HEALTHCHECK \
    --interval=10s \
    --timeout=5s \
    --start-period=40s \
    --retries=3 \
    CMD wget -qO- http://localhost:8081/actuator/health/readiness || exit 1

ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

## Final `order-worker` Dockerfile

```dockerfile
# services/order-worker/Dockerfile

FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /workspace

COPY pom.xml .
COPY .mvn/ .mvn/
COPY mvnw .
RUN ./mvnw dependency:go-offline -B -q

COPY src/ src/
RUN ./mvnw package -DskipTests -B -q && \
    java -Djarmode=layertools \
         -jar target/*.jar \
         extract --destination /workspace/extracted

FROM eclipse-temurin:21-jre-alpine AS runtime

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
WORKDIR /app

COPY --from=builder --chown=appuser:appgroup /workspace/extracted/dependencies/ ./
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/spring-boot-loader/ ./
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/snapshot-dependencies/ ./
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/application/ ./

# Worker only exposes management port (no public HTTP API)
EXPOSE 8082

ENV JAVA_TOOL_OPTIONS="\
    -XX:+UseContainerSupport \
    -XX:MaxRAMPercentage=75.0 \
    -XX:InitialRAMPercentage=50.0 \
    -XX:+ExitOnOutOfMemoryError \
    -Djava.security.egd=file:/dev/./urandom"

HEALTHCHECK \
    --interval=10s \
    --timeout=5s \
    --start-period=40s \
    --retries=3 \
    CMD wget -qO- http://localhost:8082/actuator/health/readiness || exit 1

ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

---

## `.dockerignore` (both services)

```
target/
.git/
.github/
*.md
.idea/
*.iml
.mvn/wrapper/maven-wrapper.jar
```

---

## Full Smoke Test Script

```bash
#!/bin/bash
# M2 verification — run from capstone/docker/
set -e

echo "=== Building images ==="
docker build -t order-api:m2 ../../services/order-api/
docker build -t order-worker:m2 ../../services/order-worker/

echo ""
echo "=== Image sizes ==="
docker images | grep -E "order-api|order-worker"

echo ""
echo "=== Starting stack ==="
docker-compose up -d

echo ""
echo "=== Waiting for all services to be healthy (max 120s) ==="
timeout 120 bash -c '
  until docker-compose ps | grep -v "healthy" | grep -q "order"; do
    echo "Waiting for services..."
    sleep 5
  done
' || { echo "Timeout waiting for services"; docker-compose logs; exit 1; }

sleep 5  # Extra buffer

echo ""
echo "=== Health checks ==="
curl -sf http://localhost:8081/actuator/health/readiness | jq '.status'
curl -sf http://localhost:8082/actuator/health/readiness | jq '.status'

echo ""
echo "=== Create order ==="
IKEY=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)
RESPONSE=$(curl -sf -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IKEY" \
  -H "X-API-Key: dev-secret-key" \
  -d '{"customerId":"test","items":[{"sku":"SKU-001","qty":1}],"totalAmount":10.00}')
echo "$RESPONSE" | jq .
ORDER_ID=$(echo $RESPONSE | jq -r '.orderId')

echo ""
echo "=== Check SQS queue has message ==="
docker-compose exec -T localstack \
  awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/order-created-queue \
  --attribute-names ApproximateNumberOfMessages | jq .

echo ""
echo "=== Wait 3s and check order status ==="
sleep 3
curl -sf http://localhost:8080/orders/$ORDER_ID \
  -H "X-API-Key: dev-secret-key" | jq '.status'

echo ""
echo "=== M2 verification complete ==="
```

---

## Troubleshooting Common M2 Issues

**Container exits immediately on start:**
```bash
docker-compose logs order-api
# Look for: "Error creating bean with name..." or "Connection refused"
```
Usually means dependency not ready. Check `depends_on` conditions.

**`ClassNotFoundException: org.springframework.boot.loader.launch.JarLauncher`:**
Spring Boot 3.2+ changed the launcher class. Use `org.springframework.boot.loader.launch.JarLauncher` (not `org.springframework.boot.loader.JarLauncher`).

**`wget: can't connect to remote host` in HEALTHCHECK:**
Management port not configured or service using different port. Check `management.server.port` in `application.yml`.

**OOMKilled during startup:**
Container memory limit too low. Minimum 512MB for a Spring Boot service. Set in compose:
```yaml
deploy:
  resources:
    limits:
      memory: 512M
```

---

*Module 2 complete. Move to [Module 3 — Kubernetes/OpenShift for Backend Engineers →](../03-kubernetes-openshift/README.md)*
