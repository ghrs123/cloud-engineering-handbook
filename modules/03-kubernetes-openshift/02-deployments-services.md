# 3.2 — Deployments & Services

> **Capstone connection:** You already have the Deployment YAML in `/capstone/k8s/order-api/deployment.yaml` from Etapa 1. This chapter explains every field in depth so you understand what it does and why, rather than copying blindly.

---

## Deployment YAML — Field by Field

Let's read the `order-api` Deployment with full explanation of each decision:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api
  namespace: order-platform
  labels:
    app: order-api          # Used by Service selector to find these pods
    version: "1.0"          # Useful for canary routing or observability filtering
```

### `spec.replicas` and `spec.strategy`

```yaml
spec:
  replicas: 2               # Minimum desired pods — HPA can scale above this
  selector:
    matchLabels:
      app: order-api        # MUST match template.metadata.labels exactly
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1           # Allow 1 extra pod during update (so 3 temporarily)
      maxUnavailable: 0     # Never go below desired count — zero downtime
```

**Why `maxUnavailable: 0`?**  
With `replicas: 2` and `maxUnavailable: 1`, Kubernetes could terminate one old pod before the new one is ready — leaving only 1 pod serving 100% of traffic. For a service handling payment orders, that's unacceptable. With `maxUnavailable: 0`, it first adds a new pod, waits for it to pass readiness, then removes an old one. The downside: the update takes slightly longer.

**Trade-off:** if your pods take 60 seconds to start (long JVM warmup), `maxUnavailable: 0` means a rolling update of 10 pods takes ~10 minutes. With `maxUnavailable: 1` it takes ~5 minutes but you may be underprovisioned. Know your startup time before choosing.

### Container spec: resources

```yaml
        resources:
          requests:
            memory: "256Mi"   # Scheduler uses this for placement
            cpu: "250m"       # 0.25 vCPU — the guaranteed minimum
          limits:
            memory: "512Mi"   # If exceeded → OOMKilled (pod restart)
            cpu: "500m"       # If exceeded → CPU throttling (slowdown, not restart)
```

**Requests vs limits — the critical distinction:**

- `requests`: what the Scheduler uses to decide where to place the pod. The node must have at least this amount available. The pod is guaranteed this much.
- `limits`: the hard ceiling. Memory limit exceeded → container is killed (`OOMKilled`). CPU limit exceeded → container is throttled (slowed down, not killed).

**Why limits should be ~2x requests for Java:**  
The JVM requires memory beyond the heap — native memory for the JIT compiler, class metadata, thread stacks, and GC buffers. A service configured with `-Xmx256m` may actually use 350–400MB of physical memory. Setting `limits.memory` to 256Mi will cause OOMKilled even though your heap is "within budget."

Rule of thumb:
- `requests.memory` = expected baseline usage (monitor with Prometheus to calibrate)
- `limits.memory` = 1.5–2x of `-Xmx` value

### Annotations for Prometheus scraping

```yaml
    metadata:
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/path: "/actuator/prometheus"
        prometheus.io/port: "8080"
```

These annotations are read by Prometheus's `kubernetes_sd_configs` — it auto-discovers pods with `scrape: "true"` and scrapes the specified path and port. Module 7 wires this up fully.

### Probes

```yaml
        readinessProbe:
          httpGet:
            path: /actuator/health/readiness
            port: 8080
          initialDelaySeconds: 20   # Time before first probe — JVM startup
          periodSeconds: 10         # Check every 10 seconds
          failureThreshold: 3       # 3 failures → remove from Service
          successThreshold: 1       # 1 success → re-add to Service

        livenessProbe:
          httpGet:
            path: /actuator/health/liveness
            port: 8080
          initialDelaySeconds: 40   # Longer delay — don't restart during startup
          periodSeconds: 20
          failureThreshold: 3
```

**`initialDelaySeconds` tuning:** Set it to your 90th percentile startup time. Too short → probes fail during startup → pod killed before it's ready. Too long → Kubernetes doesn't know your pod is up early enough, delaying traffic routing.

For a Spring Boot 3.x service with a local PostgreSQL: startup is typically 8–15 seconds. `initialDelaySeconds: 20` is conservative and safe.

**`startupProbe` (Spring Boot 3.x alternative):**  
For services with variable startup times, use a `startupProbe` instead of inflating `initialDelaySeconds` on the readiness probe:

```yaml
        startupProbe:
          httpGet:
            path: /actuator/health/liveness
            port: 8080
          failureThreshold: 30     # 30 * 10s = 5 minutes max startup time
          periodSeconds: 10
```

During startup, only the `startupProbe` runs. Once it succeeds, readiness and liveness take over. This prevents the Deployment from killing slow-starting pods while still detecting hung containers.

---

## Service — Types and When to Use Each

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api-svc
  namespace: order-platform
spec:
  selector:
    app: order-api    # Routes to any pod with this label — includes new pods during rolling update
  ports:
  - port: 80          # Port the Service listens on (other services call this)
    targetPort: 8080  # Port the container actually listens on
  type: ClusterIP     # Internal only
```

| Service Type | Scope | Use case |
|---|---|---|
| `ClusterIP` | Internal to cluster | Service-to-service communication (default) |
| `NodePort` | External via node IP + port | Dev/testing, not for production |
| `LoadBalancer` | External via cloud load balancer | Public-facing services (expensive, one LB per service) |
| `ExternalName` | DNS alias | Point in-cluster services to external DNS |

**For the capstone:**
- `order-api-svc`: `ClusterIP` — only other services and the Ingress need to reach it
- `order-worker`: no Service at all — it's a consumer, not a server
- Ingress (not in scope for this milestone): routes external HTTP traffic to `order-api-svc`

### How Service → Pod routing works

The Service does not proxy through a central point. `kube-proxy` on each node maintains `iptables` or `ipvs` rules that load-balance connections directly to pod IPs. When a pod is added or removed from the Service (via readiness state), the rules update within seconds.

This means: a pod that fails its readiness probe stops receiving *new* connections. In-flight connections that are already established continue until they complete or the pod terminates.

---

## Image Tagging — Why `:latest` Is Dangerous

```yaml
# Wrong — never in production
image: order-api:latest

# Correct — immutable, traceable
image: your-registry/order-api:a3b4c5d6   # git commit SHA
```

With `:latest`, two things break:

1. **Reproducibility:** two deployments with the same YAML may run different code if the image was rebuilt between them.
2. **Rollback:** `kubectl rollout undo` sets `image: latest` — which is still the broken latest image.

**Convention:** tag images with the git commit SHA. CI builds the image, tags it with `$GITHUB_SHA`, pushes it, then updates the manifest. Rollback (`kubectl rollout undo`) reverts to the previous commit SHA tag — which is a specific, known, working version.

---

## Common Mistakes

**`selector` in Deployment doesn't match `template.labels`.**  
```yaml
selector:
  matchLabels:
    app: order-api        # This must exactly match...
template:
  metadata:
    labels:
      app: order-api-v2   # ...this. If it doesn't, kubectl apply returns an error.
```

**Not setting `terminationGracePeriodSeconds`.**  
Default is 30 seconds. If your service takes longer than 30 seconds to drain in-flight requests, Kubernetes sends SIGKILL after the grace period. Set it to `max(expected drain time + 10s, 60s)`.

**Using `ClusterIP: None` (headless Service) unintentionally.**  
Headless Services bypass `kube-proxy` and return pod IPs directly from DNS. Useful for stateful sets and service discovery, but will break standard client-side load balancing. Only use intentionally.

---

## Exercise 3.2

**Task:** Apply and verify the Deployment on a local kind cluster.

```bash
# Create the namespace
kubectl create namespace order-platform

# Apply the manifests (use the ones from /capstone/k8s/order-api/)
kubectl apply -f capstone/k8s/order-api/ -n order-platform

# Watch the rollout
kubectl rollout status deployment/order-api -n order-platform

# Verify pods are running
kubectl get pods -n order-platform -w

# Describe a pod to see events (useful for debugging startup issues)
kubectl describe pod -l app=order-api -n order-platform

# Test rolling update: change the image tag and re-apply
kubectl set image deployment/order-api \
  order-api=your-registry/order-api:new-tag \
  -n order-platform

# Watch zero-downtime update
kubectl rollout status deployment/order-api -n order-platform

# Rollback if needed
kubectl rollout undo deployment/order-api -n order-platform
```

**Answer — What you should see:**
```
Waiting for deployment "order-api" rollout to finish: 0 of 2 updated replicas are available...
Waiting for deployment "order-api" rollout to finish: 1 of 2 updated replicas are available...
deployment "order-api" successfully rolled out
```

If you see pods stuck in `Pending`, run `kubectl describe pod <name> -n order-platform` and look at the `Events` section — it will tell you if it's an image pull error, insufficient resources, or a scheduling constraint.

---

## Interview Mode

**Question:** *"How does a Service route traffic to pods in Kubernetes?"*

**60-second answer:**
> "A Service has a stable virtual IP and DNS name. Under the hood, `kube-proxy` maintains network rules on every node that load-balance traffic to the current healthy pod IPs. When a pod passes its readiness probe, it's added to the Service's endpoint list and starts receiving traffic. When it fails readiness, it's removed — no more new connections, but existing connections finish.
>
> The Service selector is just a label query: `app: order-api`. Any pod with that label is a potential target. This means during a rolling update, the Service naturally distributes traffic across both old and new pods as they come up. You don't need to do anything special — as long as your readiness probe is correctly implemented, traffic only goes to ready pods."

---

*Next: [Chapter 3.3 — ConfigMaps & Secrets →](./03-config-secrets.md)*
