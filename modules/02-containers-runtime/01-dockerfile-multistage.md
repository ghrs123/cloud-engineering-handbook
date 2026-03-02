# 2.1 — Multi-Stage Dockerfile

> **Capstone connection:** The `order-api` and `order-worker` Dockerfiles you write here are the ones that will be built by GitHub Actions (Module 8) and referenced in Kubernetes manifests (Module 3). Get the layering right now.

---

## Why Single-Stage Builds Are Wrong for Production

The naive Dockerfile:

```dockerfile
FROM eclipse-temurin:21-jdk
COPY . /app
WORKDIR /app
RUN ./mvnw package -DskipTests
CMD ["java", "-jar", "target/order-api.jar"]
```

This ships your entire build environment into production:
- Maven binary and local repository (~500MB)
- JDK (compiler, `javac`, tools) instead of JRE
- Source code
- `target/` directory with intermediate class files

The resulting image is typically 900MB–1.5GB. Every `docker pull` in CI/CD, every Kubernetes node, every developer pulls this unnecessarily.

**The correct approach: multi-stage builds.**

---

## Multi-Stage Build — Concepts

Docker multi-stage builds allow multiple `FROM` instructions in one Dockerfile. Each stage produces a filesystem. You can selectively copy artifacts from one stage to another. Only the last stage becomes the final image.

```
Stage 1 (builder): Full JDK + Maven → compile → produce JAR
Stage 2 (runtime): Minimal JRE → copy JAR only → this is the image
```

The builder stage never appears in the final image. Only the JAR is copied.

---

## Production Dockerfile for Spring Boot (Layered JAR)

Spring Boot 2.3+ supports **layered JARs**, which split the application into layers ordered by change frequency:

```
dependencies/           ← changes least often (only when pom.xml changes)
spring-boot-loader/     ← changes with Spring Boot version upgrades
snapshot-dependencies/  ← SNAPSHOT deps (dev only)
application/            ← changes on every code commit
```

Docker caches layers. If only `application/` changes (the common case), Docker reuses the `dependencies/` layer cache. A 200MB dependencies layer is downloaded once and cached — only the ~5MB application layer is re-pulled on each deploy.

```dockerfile
# ─── Stage 1: Build ───────────────────────────────────────────────────
FROM eclipse-temurin:21-jdk-alpine AS builder

WORKDIR /workspace

# Copy dependency descriptors first — Docker caches this layer
# Only invalidated when pom.xml changes, not on every code change
COPY pom.xml .
COPY .mvn/ .mvn/
COPY mvnw .

# Download dependencies (cached as a separate layer)
RUN ./mvnw dependency:go-offline -B

# Now copy source — this layer changes on every commit
COPY src/ src/

# Build the layered JAR
RUN ./mvnw package -DskipTests -B && \
    java -Djarmode=layertools -jar target/*.jar extract --destination /workspace/extracted

# ─── Stage 2: Runtime ─────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-alpine AS runtime

# Security: do not run as root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

WORKDIR /app

# Copy layers in order of change frequency (least → most)
# This maximizes Docker cache utilization
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/dependencies/ ./
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/spring-boot-loader/ ./
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/snapshot-dependencies/ ./
COPY --from=builder --chown=appuser:appgroup /workspace/extracted/application/ ./

# Document the exposed port (informational only — does not publish it)
EXPOSE 8080
EXPOSE 8081

# JVM configuration — see Chapter 2.2 for full explanation
ENV JAVA_TOOL_OPTIONS="\
    -XX:+UseContainerSupport \
    -XX:MaxRAMPercentage=75.0 \
    -XX:+ExitOnOutOfMemoryError \
    -Djava.security.egd=file:/dev/./urandom"

# Health check — Kubernetes uses its own probes, but this works for plain Docker
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:8081/actuator/health/readiness || exit 1

# Use exec form (not shell form) — critical for signal handling (see Chapter 2.3)
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

---

## Why `eclipse-temurin:21-jre-alpine` and Not `openjdk`

| Base image | Size | Notes |
|---|---|---|
| `openjdk:21` | ~450MB | Deprecated, no longer updated |
| `eclipse-temurin:21-jdk` | ~400MB | Full JDK, not needed for runtime |
| `eclipse-temurin:21-jre` | ~280MB | JRE only, Debian base |
| `eclipse-temurin:21-jre-alpine` | ~180MB | JRE + Alpine Linux (musl libc) |
| `eclipse-temurin:21-jre-alpine` + layers | ~185–220MB final | ✅ Target |

**Alpine caveat:** Alpine uses `musl` libc instead of `glibc`. This can cause issues with native libraries. For Spring Boot REST services with no JNI dependencies, Alpine is safe. If you use libraries with native bindings (some crypto, some observability agents), use the Debian slim variant instead.

**Do not use `latest` tags in production.** Pin the full version: `eclipse-temurin:21.0.3_9-jre-alpine`. Unpinned tags change silently and break reproducibility.

---

## Layer Caching Strategy — The Numbers

Typical Spring Boot service with ~150 dependencies:

| Layer | Size | Change frequency |
|---|---|---|
| `dependencies/` | ~120MB | Only on `pom.xml` change |
| `spring-boot-loader/` | ~300KB | Only on Spring Boot upgrade |
| `snapshot-dependencies/` | 0 in prod | Dev only |
| `application/` | ~5MB | Every code commit |

On a typical feature development day (10 commits), Docker only re-transfers the `application/` layer (5MB × 10 = 50MB). Without layering, it would re-transfer the full 125MB JAR every time.

---

## `.dockerignore`

Prevent unnecessary files from being sent to the Docker build context:

```
# .dockerignore
target/
.git/
.github/
*.md
.mvn/wrapper/maven-wrapper.jar  # downloaded fresh in build
.idea/
*.iml
node_modules/
```

Without `.dockerignore`, `COPY . .` sends `target/` (potentially containing a 200MB JAR from a previous local build) into the build context, slowing down every build unnecessarily.

---

## Common Mistakes

**Using `CMD` with shell form for the entrypoint.**

```dockerfile
# Wrong — shell form
CMD java org.springframework.boot.loader.launch.JarLauncher

# Correct — exec form
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Shell form wraps the command in `/bin/sh -c "..."`. The JVM becomes a child of `sh`, not PID 1. When Docker sends SIGTERM (on `docker stop`), `sh` may not forward it to the JVM, causing the container to wait the full `--stop-timeout` before being killed. Exec form makes the JVM PID 1 and receives signals directly.

**Copying source before dependencies in the builder.**

```dockerfile
# Wrong — source changes invalidate the dependency download cache
COPY . .
RUN ./mvnw dependency:go-offline

# Correct — copy descriptors, download deps, then copy source
COPY pom.xml .
RUN ./mvnw dependency:go-offline
COPY src/ src/
```

**Running as root.**
Not running as root is required in OpenShift (which enforces non-root by default with arbitrary UIDs) and is a security best practice everywhere.

---

## Exercise 2.1

**Task:** Build and measure the `order-api` image.

1. Create the multi-stage Dockerfile above for `order-api`.
2. Create `.dockerignore`.
3. Run `docker build -t order-api:m2 .` from `services/order-api/`.
4. Check image size: `docker images order-api:m2`.
5. Inspect the layers: `docker history order-api:m2`.
6. Make a code change (add a comment), rebuild, and observe which layers are cached vs rebuilt.

**Answer — expected output:**

```bash
$ docker images order-api:m2
REPOSITORY   TAG   IMAGE ID       CREATED         SIZE
order-api    m2    abc123def456   2 minutes ago   215MB

$ docker history order-api:m2
IMAGE          CREATED         SIZE      COMMENT
abc123def456   2 min ago       5.2MB     application layer (your code)
...            2 min ago       312KB     spring-boot-loader
...            2 min ago       121MB     dependencies
...            10 min ago      181MB     eclipse-temurin:21-jre-alpine base
```

After a code-only change:
```bash
$ docker build -t order-api:m2 .
Step 1/12 : FROM eclipse-temurin:21-jdk-alpine AS builder
 ---> Using cache       ← cached
...
Step 9/12 : COPY --from=builder .../dependencies/ ./
 ---> Using cache       ← cached (pom.xml unchanged)
Step 12/12 : COPY --from=builder .../application/ ./
 ---> NOT cached        ← only this layer rebuilt
Successfully built in 12s   (vs 4min on first build)
```

---

## Interview Mode

**Question:** *"How do you build a Docker image for a Spring Boot application?"*

**90-second answer:**
> "I use a multi-stage build with layered JARs. The first stage uses the full JDK and Maven to compile and package the application, then extracts the JAR into four layers using Spring Boot's layertools: dependencies, spring-boot-loader, snapshot-dependencies, and application code.
>
> The second stage uses only the JRE, not the JDK — that alone cuts the base image size by roughly 200MB. It copies the layers in order from least to most frequently changed. Dependencies are cached by Docker as long as `pom.xml` doesn't change, so on a typical feature commit only the ~5MB application layer is rebuilt and re-pushed.
>
> I always use exec form for ENTRYPOINT so the JVM is PID 1 and receives SIGTERM directly for graceful shutdown. And I never run as root — I create a dedicated user in the Dockerfile, which is required for OpenShift compatibility and is a basic security practice."

---

*Next: [Chapter 2.2 — JVM in Containers →](./02-jvm-in-containers.md)*
