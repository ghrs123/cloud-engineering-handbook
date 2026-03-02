# Module 2 — Containers & Runtime

> **Theme:** The JVM was not designed to run inside a container. Docker was not designed for Java. This module teaches you where they conflict and exactly how to resolve it — so your `order-api` image is production-grade: small, fast, safe, and well-behaved under pressure.

---

## What This Module Builds

**Milestone M2:** A production Docker image for `order-api` and `order-worker`, with a `docker-compose.yml` that starts the full local dev stack (postgres + localstack + both services) and passes all health probes within 30 seconds.

By the end of this module you will have:

- A multi-stage Dockerfile that produces an image under 300MB
- JVM flags configured correctly for container resource limits
- Graceful shutdown that completes in-flight requests on SIGTERM
- Readiness and liveness probes working inside the container
- `docker-compose.yml` with proper dependency ordering and health checks
- A clear mental model of what happens between `docker run` and "ready"

---

## Chapters

| # | Title | What you learn |
|---|---|---|
| [2.1](./01-dockerfile-multistage.md) | Multi-Stage Dockerfile | Why single-stage builds are wrong, layering strategy, image size |
| [2.2](./02-jvm-in-containers.md) | JVM in Containers | cgroup awareness, heap sizing, GC selection, OOMKilled diagnosis |
| [2.3](./03-graceful-shutdown.md) | Graceful Shutdown | SIGTERM handling, preStop hooks, in-flight request completion |
| [2.4](./04-health-probes-docker.md) | Health Probes in Docker | HEALTHCHECK instruction, probe timing, startup vs readiness |
| [2.5](./05-docker-compose.md) | Docker Compose for Local Dev | Dependency ordering, volume strategy, env var management |
| [2.6](./06-capstone-milestone.md) | Capstone Milestone M2 | Full Dockerfiles, compose file, verification script |

---

## Key Principle

> A container is not a VM. It is a process with resource limits. Your JVM must know those limits — and respect them.

---

*Start with [Chapter 2.1 — Multi-Stage Dockerfile →](./01-dockerfile-multistage.md)*
