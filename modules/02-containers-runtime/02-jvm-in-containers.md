# 2.2 — JVM in Containers

> **Capstone connection:** The JVM flags in your Dockerfile and Kubernetes manifests directly determine whether `order-api` runs stably under load — or gets OOMKilled by the container runtime at the worst possible moment.

---

## The Core Problem: JVM Was Designed for Bare Metal

Before Java 8u191 (2018), the JVM read system memory and CPU from the host, not the container. A container with a 512MB memory limit running on a 64GB host would see 64GB and allocate a heap of ~16GB — far exceeding its limit. The kernel's OOM killer would terminate the container with no warning and no graceful shutdown.

This is the origin of countless "my pod keeps restarting randomly" incidents.

Modern JVMs (8u191+, 11+, 17+, 21) include **cgroup awareness** via `-XX:+UseContainerSupport` (enabled by default since Java 11). This flag makes the JVM read memory and CPU limits from the container's cgroup, not from the host.

**Verify your JVM sees the right limits:**

```bash
docker run --rm -m 512m eclipse-temurin:21-jre-alpine \
  java -XX:+PrintFlagsFinal -version 2>&1 | grep -i maxheapsize
# Should show roughly 384MB (75% of 512MB), not 48GB
```

---

## Heap Sizing — The Right Approach

### What NOT to do

```dockerfile
# Hardcoded heap — brittle when container limits change
ENV JAVA_TOOL_OPTIONS="-Xms512m -Xmx512m"
```

If someone changes the K8s memory limit from 1GB to 512MB and forgets to update the Dockerfile, the JVM tries to allocate 512MB heap inside a 512MB container — leaving zero space for the OS, the JVM itself, thread stacks, metaspace, and native memory. OOMKilled.

### What to do instead

```dockerfile
ENV JAVA_TOOL_OPTIONS="\
    -XX:+UseContainerSupport \
    -XX:MaxRAMPercentage=75.0 \
    -XX:InitialRAMPercentage=50.0"
```

`-XX:MaxRAMPercentage=75.0` — heap will be at most 75% of the container's memory limit. If the limit is 512MB, max heap is ~384MB. If you scale the limit to 1GB, heap scales to ~768MB automatically. No Dockerfile change needed.

`-XX:InitialRAMPercentage=50.0` — initial heap is 50% of limit. Avoids the JVM starting with a tiny heap and spending startup time growing it to the max.

### Memory budget for a Spring Boot service

For a container with 512MB memory limit:

| Component | Approximate size |
|---|---|
| Max heap (`-XX:MaxRAMPercentage=75`) | ~384MB |
| Metaspace (class metadata) | ~80–120MB |
| Thread stacks (each ~1MB) | ~50MB (50 threads) |
| Direct memory (NIO, Netty) | ~50MB |
| JVM overhead | ~30MB |
| **Total required** | ~694MB |

**This doesn't fit in 512MB.** For a Spring Boot service with a non-trivial classpath, the realistic minimum container limit is **768MB**. Use **512MB requests, 768MB limits** in Kubernetes (requests for scheduling, limits as the hard ceiling).

The lesson: do not set memory limits smaller than the full JVM memory footprint, which is heap + metaspace + thread stacks + direct + overhead. Heap is not the only consumer.

---

## OOMKilled: Diagnosis

When a pod is OOMKilled:

```bash
kubectl get pods
# STATUS: OOMKilled  or  CrashLoopBackOff

kubectl describe pod order-api-abc123
# Last State: Terminated
#   Reason: OOMKilled
#   Exit Code: 137

kubectl top pods
# Shows memory usage just before crash
```

Exit code 137 = killed by SIGKILL (signal 9), typically from the kernel OOM killer.

**First action:** check if the JVM heap limit exceeds the container limit:

```bash
# Exec into a running pod and inspect JVM flags
kubectl exec -it order-api-abc123 -- \
  java -XX:+PrintFlagsFinal -version 2>&1 | grep MaxHeapSize
```

**Second action:** check if it's a memory leak (slow growth) vs misconfiguration (immediate kill):

- Immediate OOMKill on startup → misconfigured heap (too large for container limit)
- OOMKill after hours/days → memory leak (heap or native)

---

## GC Selection for Containerized Services

Java 21 default GC: **G1GC** — suitable for most services. The trade-offs for a latency-sensitive REST API:

| GC | Latency | Throughput | Container-friendly | Recommendation |
|---|---|---|---|---|
| G1GC | Low-medium pause | High | ✅ (default since Java 9) | Default choice |
| ZGC | Sub-ms pauses | Slightly lower | ✅ (`-XX:+UseZGC`) | For p99 latency requirements |
| ParallelGC | Higher pauses | Highest | ✅ | For batch/throughput-first |
| Shenandoah | Sub-ms pauses | Medium | ✅ | Red Hat JDKs, GraalVM |

For `order-api` (REST API, target p99 < 200ms): **G1GC is sufficient**. Add ZGC only if you observe GC pause spikes in production metrics.

```dockerfile
# Explicit G1GC (already default, but good for documentation)
ENV JAVA_TOOL_OPTIONS="\
    -XX:+UseContainerSupport \
    -XX:MaxRAMPercentage=75.0 \
    -XX:+UseG1GC \
    -XX:MaxGCPauseMillis=200 \
    -XX:+ExitOnOutOfMemoryError"
```

`-XX:+ExitOnOutOfMemoryError` — when the JVM cannot allocate memory, it exits the JVM process immediately instead of throwing `OutOfMemoryError` to random threads (which can leave the service in a corrupt partially-functioning state). The container exits, Kubernetes restarts it, health probes prevent traffic until recovery. This is the correct production behavior.

---

## CPU Limits and JVM Thread Counts

The JVM also uses CPU limits (via cgroup) to set default thread pool sizes.

A common trap: a container with `cpu: 100m` (0.1 vCPU). The JVM reads this as approximately 1 CPU and sets its parallel GC threads and common ForkJoinPool accordingly. But your Tomcat thread pool (default 200 threads) doesn't know about this — you now have 200 threads competing for 0.1 vCPU, causing massive context switching.

**Recommendation:** set CPU requests to at least `250m` (0.25 vCPU) for a Spring Boot REST service. Set limits to `500m`–`1000m` depending on expected load. Do not use CPU limits of 100m or below for JVM services.

Configure Tomcat thread pool explicitly:
```yaml
# application.yml
server:
  tomcat:
    threads:
      max: 50          # Default 200 is too high for small containers
      min-spare: 10
    max-connections: 200
    accept-count: 100
```

---

## Full Production JVM Configuration

```dockerfile
ENV JAVA_TOOL_OPTIONS="\
    -XX:+UseContainerSupport \
    -XX:MaxRAMPercentage=75.0 \
    -XX:InitialRAMPercentage=50.0 \
    -XX:+UseG1GC \
    -XX:MaxGCPauseMillis=200 \
    -XX:+ExitOnOutOfMemoryError \
    -Djava.security.egd=file:/dev/./urandom \
    -Dfile.encoding=UTF-8"
```

`-Djava.security.egd=file:/dev/./urandom` — Spring Boot uses `SecureRandom` during startup for session tokens and CSRF protection. On some Linux environments, `/dev/random` blocks waiting for entropy — causing startup times of 30+ seconds. This flag uses the non-blocking urandom source. The security difference between `/dev/random` and `/dev/urandom` is negligible for application use cases.

---

## Common Mistakes

**Setting `-Xmx` higher than container memory limit.**
`-Xmx1g` in a container with 512MB limit → OOMKilled on first significant load. Use percentage-based sizing.

**Not setting `-XX:+ExitOnOutOfMemoryError`.**
Without it, an OOM error is thrown to a random thread. Other threads keep running. The service appears up but is partially broken. Health checks may still pass. You discover the issue when user reports start rolling in, not from monitoring.

**Ignoring metaspace.**
Metaspace (class metadata) is outside the heap. `-Xmx512m` does not limit metaspace. A class loader leak can OOMKill your container even with "plenty of heap remaining." Add `-XX:MaxMetaspaceSize=256m` if you see metaspace growth.

---

## Exercise 2.2

**Task:** Verify the JVM correctly reads container limits.

1. Build the `order-api` image with the Dockerfile from Chapter 2.1.
2. Run it with a 512MB memory limit:
   ```bash
   docker run --rm -m 512m order-api:m2 \
     java -XX:+PrintFlagsFinal -version 2>&1 | grep -E "MaxHeapSize|UseContainerSupport"
   ```
3. Verify `MaxHeapSize` is approximately `384MB` (75% of 512MB = 402,653,184 bytes ≈ 384MB).
4. Run the service and observe startup logs — confirm the JVM reports its heap range.

**Answer:**

```bash
$ docker run --rm -m 512m order-api:m2 \
    java -XX:+PrintFlagsFinal -version 2>&1 | grep -E "MaxHeapSize|UseContainerSupport"

     bool UseContainerSupport                      = true   {product}
     size_t MaxHeapSize                            = 402653184   {product}
# 402653184 bytes = 384MB ✓
```

If you see a MaxHeapSize close to your host's RAM (e.g., 12GB on a 16GB machine), UseContainerSupport is not working — check your JDK version.

---

## Interview Mode

**Question:** *"Have you ever dealt with Java services being OOMKilled in Kubernetes? How did you diagnose and fix it?"*

**90-second answer:**
> "Yes. The symptom is pods with status OOMKilled or exit code 137. The first thing I check is whether the JVM heap limit is compatible with the container memory limit. Before Java 8u191, the JVM read memory from the host, not the container — it would allocate a 16GB heap inside a 512MB container. Even with modern JVMs, if someone hardcodes `-Xmx` larger than the container limit, you get the same result.
>
> My fix is to never hardcode heap with `-Xmx`. Instead I use `-XX:+UseContainerSupport` with `-XX:MaxRAMPercentage=75` — the JVM reads its limit from the cgroup and sets the heap to 75% of that, automatically. If the K8s limit changes, the heap adjusts.
>
> The other thing I add is `-XX:+ExitOnOutOfMemoryError`. Without it, an OOM error is thrown to a random thread. Other threads keep running, health probes keep passing, but the service is partially broken. With this flag, the JVM exits, Kubernetes restarts the pod, and the issue is visible in monitoring as a restart event."

---

*Next: [Chapter 2.3 — Graceful Shutdown →](./03-graceful-shutdown.md)*
