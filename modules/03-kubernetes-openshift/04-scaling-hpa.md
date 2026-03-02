# 3.4 — Scaling & HPA

> **Capstone connection:** The HPA manifest in `/capstone/k8s/order-api/service-config-hpa.yaml` is already written. This chapter explains the decisions behind it and shows you how to verify and test it.

---

## Horizontal vs Vertical Scaling

| Type | What changes | K8s mechanism | Use when |
|---|---|---|---|
| Horizontal | Number of pod replicas | HPA | Stateless services, any web API |
| Vertical | CPU/memory per pod | VPA | Stateful services, hard to shard, ML workloads |

For `order-api` and `order-worker`: always horizontal. Both services are stateless — any instance can handle any request or message. Adding replicas distributes load linearly.

**Why not vertical?** VPA requires pod restarts to apply resource changes. You cannot live-resize a running JVM's heap. Restarting to scale is what horizontal scaling avoids.

---

## HPA Mechanics

The HPA controller runs in the control plane and polls metrics every 15 seconds (by default). The scaling formula:

```
desiredReplicas = ceil(currentReplicas × currentMetricValue / targetMetricValue)
```

Example with CPU:
- `currentReplicas`: 2
- `currentCPU`: 80% average across pods
- `targetCPU`: 70%
- `desiredReplicas`: ceil(2 × 80 / 70) = ceil(2.28) = **3**

HPA scales up immediately (if `scaleUp.stabilizationWindowSeconds: 0`). It waits before scaling down to avoid flapping — the `stabilizationWindowSeconds` for scale-down is 300 seconds (5 minutes) by default.

---

## HPA Configuration for `order-api`

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-api-hpa
  namespace: order-platform
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-api
  minReplicas: 2       # Never below 2 — single replica means any restart = downtime
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300   # 5 min cooldown prevents flapping
      policies:
      - type: Pods
        value: 1
        periodSeconds: 60               # Remove at most 1 pod per minute
    scaleUp:
      stabilizationWindowSeconds: 0     # Scale up immediately on load spike
      policies:
      - type: Pods
        value: 4
        periodSeconds: 60               # Add at most 4 pods per minute
```

### Why `minReplicas: 2`

A single replica means any pod restart — rolling update, node maintenance, OOMKill — takes the entire service offline for the duration of the restart (typically 20–60 seconds). Two replicas guarantee at least one pod is always serving traffic. This is the minimum for any service with an SLA.

### Why CPU target at 70% not 90%

At 90% CPU, by the time HPA decides to scale and a new pod starts and passes readiness (easily 30–60 seconds for a Java service), your existing pods may have hit 100% and started queuing requests. 70% leaves headroom for the scale-out lag.

### The `behavior` block

Without `behavior`, HPA uses defaults:
- Scale down: removes multiple pods immediately, can cause brief underprovisioning
- Scale up: limited to doubling per minute

With explicit `behavior`:
- Scale up: aggressive (0s stabilization, up to 4 pods/min)
- Scale down: conservative (5 min stabilization, 1 pod/min) — prevents flapping on brief load spikes

---

## Resource Requests Are Mandatory for HPA

**HPA cannot work without `resources.requests.cpu` set.**

```yaml
# HPA will fail with "unable to get metrics for resource cpu: no metrics"
# if containers don't have resource requests
resources:
  requests:
    cpu: "250m"     # Required for CPU-based HPA
    memory: "256Mi"
```

The Metrics Server (installed on the cluster) measures actual CPU usage and compares it against the request to calculate utilization percentage.

Verify Metrics Server is running:
```bash
kubectl get deployment metrics-server -n kube-system
# On kind: kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

---

## HPA for `order-worker` — Beyond CPU

For a queue consumer like `order-worker`, CPU-based HPA is a proxy metric. What you actually want to scale on is queue depth: if there are 10,000 messages in SQS, add more consumers.

**KEDA (Kubernetes Event Driven Autoscaler)** enables this:

```yaml
# KEDA ScaledObject — not a standard K8s resource, requires KEDA installed
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: order-worker-scaler
  namespace: order-platform
spec:
  scaleTargetRef:
    name: order-worker
  minReplicaCount: 1
  maxReplicaCount: 20
  triggers:
  - type: aws-sqs-queue
    metadata:
      queueURL: https://sqs.us-east-1.amazonaws.com/123456789/order-created-queue
      queueLength: "5"      # Target: 5 messages per worker replica
      awsRegion: us-east-1
      identityOwner: pod    # Uses IRSA
```

**Logic:** if the queue has 50 messages and target is 5 per worker, KEDA scales to 10 replicas. If the queue drains to 0, KEDA scales to 0 (scale-to-zero) — no idle workers consuming resources.

KEDA is not a capstone requirement (needs additional cluster setup), but it is the production answer to "how would you scale a queue consumer?" Know it for interviews.

---

## Testing HPA Locally

On kind, you need to install the Metrics Server first:

```bash
# Install metrics-server (with insecure TLS for local testing)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Patch to skip TLS verification (required on kind)
kubectl patch deployment metrics-server \
  -n kube-system \
  --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

# Wait for metrics-server
kubectl rollout status deployment/metrics-server -n kube-system

# Apply HPA
kubectl apply -f capstone/k8s/order-api/service-config-hpa.yaml -n order-platform

# Check HPA status
kubectl get hpa -n order-platform
kubectl describe hpa order-api-hpa -n order-platform

# Generate load (in a separate terminal)
kubectl run load-test --image=busybox --rm -it --restart=Never -- \
  sh -c "while true; do wget -qO- http://order-api-svc/actuator/health; done"

# Watch replicas grow
kubectl get hpa order-api-hpa -n order-platform -w
```

---

## Common Mistakes

**Setting `maxReplicas` too low.**  
If `maxReplicas: 3` and a traffic spike requires 10 replicas, the HPA hits the ceiling and your pods are over-provisioned. Set `maxReplicas` to what your infrastructure can handle, not what you expect in normal operation.

**HPA and Deployment `replicas` conflict.**  
If your Deployment manifest has `replicas: 2` and HPA has scaled to 5, the next `kubectl apply` of the Deployment will reset replicas to 2 unless you remove the `replicas` field or use server-side apply. Best practice: remove `replicas` from the Deployment manifest when using HPA, and let HPA control the count.

**Not setting `minReplicas` to at least 2.**  
```yaml
minReplicas: 1  # During scale-down, goes to 1 replica = SPOF
```
During low traffic (nights, weekends), HPA scales down to 1 replica. Any restart of that single pod = brief downtime. Set `minReplicas: 2` for any service with availability requirements.

---

## Interview Mode

**Question:** *"How would you handle a sudden 10x traffic spike to your service?"*

**90-second answer:**
> "The first line of defense is the HPA. With a CPU target of 70%, it starts adding replicas as load increases. The scale-up behavior is configured aggressively — 0 second stabilization, up to 4 new pods per minute. With pods starting in 20–30 seconds, we can go from 2 to 10 replicas in about 2 minutes.
>
> The key constraint is startup time. Java services aren't as fast to start as Go or Node services. I pre-warm this by keeping `minReplicas: 2` so there are always available instances during the initial spike, and by keeping the heap warm — Spring Boot 3 with class data sharing starts significantly faster.
>
> If this were a queue consumer and the spike came from message volume, I'd use KEDA instead of CPU-based HPA. KEDA scales directly on queue depth — if there are 500 messages queued and the target is 5 per worker, it spins up 100 replicas immediately, rather than waiting for CPU to climb.
>
> Beyond that: database connection pool sizing matters. If you go from 2 to 20 replicas, each with a pool of 10 connections, that's 200 connections to PostgreSQL. You need connection pooling at the infrastructure layer — PgBouncer — before scaling becomes a DB bottleneck."

---

*Next: [Chapter 3.5 — Debugging with kubectl →](./05-debugging-kubectl.md)*
