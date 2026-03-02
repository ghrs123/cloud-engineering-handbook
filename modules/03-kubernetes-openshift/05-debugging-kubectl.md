# 3.5 — Debugging with kubectl

> **This chapter is your on-call runbook.** When something goes wrong in Kubernetes at 2am, you need a systematic approach. Random `kubectl` commands don't find problems — a diagnostic flow does.

---

## The Diagnostic Flow

```
kubectl get pods             → What is the current state?
kubectl describe pod <n>     → Why is it in that state? (Events)
kubectl logs <pod> [--previous] → What did the application say?
kubectl exec -it <pod> -- sh → What does the environment look like?
kubectl top pod              → How much CPU/memory is being used?
```

Always start with the state, then look at events, then look at logs. `kubectl logs` without checking events first misses infrastructure-level failures.

---

## Pod Status Reference

| Status | Meaning | First action |
|---|---|---|
| `Pending` | No node assigned yet | `describe pod` → look at Events |
| `ContainerCreating` | Image pulling or volumes mounting | `describe pod` → Events for pull errors |
| `Running` | Container started | Check logs if not working correctly |
| `CrashLoopBackOff` | Container starting and crashing repeatedly | `logs --previous` |
| `OOMKilled` | Container exceeded memory limit | Check memory limits, heap config |
| `ImagePullBackOff` | Cannot pull the image | Registry credentials, image tag |
| `Terminating` | Pod shutting down | May be stuck; check finalizers |
| `Error` | Container exited with non-zero code | `logs --previous` |

---

## Scenario 1: CrashLoopBackOff

The most common status for a misconfigured Spring Boot service.

```bash
kubectl get pods -n order-platform
# NAME                         READY   STATUS             RESTARTS
# order-api-6d8f9-xk2p9       0/1     CrashLoopBackOff   4
```

**Diagnosis:**
```bash
# Get logs from the PREVIOUS run (the current run hasn't produced logs yet, it crashed)
kubectl logs order-api-6d8f9-xk2p9 --previous -n order-platform

# Get the last 100 lines
kubectl logs order-api-6d8f9-xk2p9 --previous --tail=100 -n order-platform
```

**What to look for in the logs:**

```
# Case 1: Database connection failure
Unable to acquire JDBC Connection; nested exception is...
Connection refused: postgres-svc:5432

# Fix: verify the postgres Service exists and the hostname/port is correct
kubectl get svc -n order-platform | grep postgres

# Case 2: Missing environment variable (NPE or IllegalArgument at startup)
java.lang.IllegalArgumentException: Could not resolve placeholder 'SQS_ORDER_QUEUE_URL'

# Fix: verify ConfigMap has the required key
kubectl describe configmap order-api-config -n order-platform

# Case 3: Port already in use (rare in K8s, common in docker-compose)
Web server failed to start. Port 8080 was already in use.

# Fix: check if another container in the pod uses the same port
```

---

## Scenario 2: OOMKilled

```bash
kubectl get pods -n order-platform
# NAME                         READY   STATUS      RESTARTS   AGE
# order-api-6d8f9-xk2p9       0/1     OOMKilled   2          5m
```

```bash
# Describe to see the OOMKilled reason and exit code (137)
kubectl describe pod order-api-6d8f9-xk2p9 -n order-platform
```

Expected output:
```
Containers:
  order-api:
    State:          Terminated
      Reason:       OOMKilled
      Exit Code:    137
    Last State:     Terminated
      Reason:       OOMKilled
```

**Diagnosis checklist:**
```bash
# Check how much memory the pod was using before death
kubectl top pod order-api-6d8f9-xk2p9 -n order-platform

# Check current resource limits
kubectl get pod order-api-6d8f9-xk2p9 -n order-platform -o jsonpath='{.spec.containers[0].resources}'

# See if the JVM heap settings match the container limits
kubectl exec -it order-api-6d8f9-xk2p9 -n order-platform -- env | grep JAVA_TOOL_OPTIONS
```

**Fix options (in order of preference):**
1. Increase `limits.memory` — if the service genuinely needs more
2. Reduce JVM heap (`-Xmx`) to leave room for non-heap memory
3. Use `MaxRAMPercentage` instead of fixed `-Xmx` — scales automatically with container limits
4. Profile heap usage — the service may have a memory leak

```yaml
# Before (risky with OOMKill)
limits:
  memory: "256Mi"
env:
- name: JAVA_TOOL_OPTIONS
  value: "-Xmx256m"   # JVM uses more than heap: metadata, threads, etc.

# After (safe margin)
limits:
  memory: "512Mi"
env:
- name: JAVA_TOOL_OPTIONS
  value: "-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"
  # With 512Mi limit: max heap ≈ 384Mi, leaves 128Mi for JVM overhead
```

---

## Scenario 3: Pod Stuck in Pending

```bash
kubectl get pods -n order-platform
# NAME                         READY   STATUS    RESTARTS
# order-api-6d8f9-xk2p9       0/1     Pending   0
```

```bash
kubectl describe pod order-api-6d8f9-xk2p9 -n order-platform
```

Look at the `Events` section at the bottom:
```
Events:
  Warning  FailedScheduling  scheduler  0/2 nodes are available:
           2 Insufficient cpu.  preemption: 0/2 nodes are available...
```

**Common causes:**

| Event message | Cause | Fix |
|---|---|---|
| `Insufficient cpu` | Requested CPU exceeds available on all nodes | Reduce `requests.cpu` or add nodes |
| `Insufficient memory` | Requested memory exceeds available | Reduce `requests.memory` or add nodes |
| `no nodes matched node selector` | `nodeSelector` or `affinity` rule has no match | Check labels on nodes |
| `pod has unbound PersistentVolumeClaims` | PVC not created | Create the PVC first |
| `ImagePullBackOff` | Can't pull image | Check registry credentials and image name |

For local kind clusters, `Insufficient cpu/memory` is common — kind runs in Docker and has limited resources. Reduce requests or add more workers to the kind cluster.

---

## Scenario 4: Pod Running but Not Receiving Traffic

```bash
# Pod shows Running and Ready = 1/1
kubectl get pods -n order-platform
# NAME                   READY   STATUS    RESTARTS
# order-api-xxx-yyy      1/1     Running   0

# But requests to the Service return connection refused or no pods found
```

**Diagnosis:**
```bash
# Check if the Service has endpoints (pods selected by the Service)
kubectl get endpoints order-api-svc -n order-platform
# ENDPOINTS: <none>  ← Service has no pods! Selector mismatch.
# vs
# ENDPOINTS: 10.244.0.5:8080,10.244.0.6:8080  ← correct

# If no endpoints, check label mismatch
kubectl get pod -l app=order-api -n order-platform
kubectl describe svc order-api-svc -n order-platform | grep Selector
# Selector: app=order-api  ← must match pod labels exactly
```

**Another cause:** pod is `Running` but not `Ready` (1/1 = Running/Ready, 0/1 = Running/NotReady)
```bash
# A pod that fails readiness shows READY: 0/1
kubectl get pods -n order-platform
# NAME                   READY   STATUS    RESTARTS
# order-api-xxx-yyy      0/1     Running   0

# This pod is NOT in the Service endpoints list
# Check readiness probe details
kubectl describe pod order-api-xxx-yyy -n order-platform
# Look for: Readiness probe failed: Get ... connection refused
```

---

## Essential `kubectl` Commands Reference

```bash
# ── Viewing state ─────────────────────────────────────────────────────
kubectl get pods -n order-platform                          # list pods
kubectl get pods -n order-platform -w                       # watch (live updates)
kubectl get pods -n order-platform -o wide                  # show node placement
kubectl get all -n order-platform                           # deployments, services, etc.
kubectl get events -n order-platform --sort-by='.lastTimestamp'  # recent events

# ── Inspecting ────────────────────────────────────────────────────────
kubectl describe pod <name> -n order-platform               # full pod detail + events
kubectl describe deployment order-api -n order-platform     # deployment status
kubectl describe hpa order-api-hpa -n order-platform        # HPA status + current metrics

# ── Logs ─────────────────────────────────────────────────────────────
kubectl logs <pod> -n order-platform                        # current logs
kubectl logs <pod> -n order-platform --previous             # logs from last crash
kubectl logs <pod> -n order-platform -f                     # follow live
kubectl logs -l app=order-api -n order-platform             # logs from all matching pods

# ── Exec ─────────────────────────────────────────────────────────────
kubectl exec -it <pod> -n order-platform -- sh              # shell in container
kubectl exec -it <pod> -n order-platform -- env             # list env vars
kubectl exec -it <pod> -n order-platform -- \
  wget -qO- http://localhost:8081/actuator/health            # test health from inside

# ── Resource usage ────────────────────────────────────────────────────
kubectl top pods -n order-platform                          # CPU/memory usage
kubectl top nodes                                           # node resource usage

# ── Deployment operations ─────────────────────────────────────────────
kubectl rollout status deployment/order-api -n order-platform
kubectl rollout history deployment/order-api -n order-platform
kubectl rollout undo deployment/order-api -n order-platform
kubectl rollout restart deployment/order-api -n order-platform

# ── Port forwarding (for local testing without Ingress) ───────────────
kubectl port-forward svc/order-api-svc 8080:80 -n order-platform
# Then: curl http://localhost:8080/orders
```

---

## Common Mistakes

**Looking at current logs for a CrashLoopBackOff.**  
The current logs are from the latest (running) start attempt. Use `--previous` to get logs from the run that crashed.

**Not checking Events.**  
`kubectl describe pod` is 90% of debugging. The `Events` section at the bottom shows Kubernetes-level problems (scheduling failures, image pull errors, probe failures) that never appear in application logs.

**Forgetting `-n namespace`.**  
Without `-n`, `kubectl` uses the `default` namespace. If your workload is in `order-platform`, you see nothing. Set the default namespace for your context.

---

## Interview Mode

**Question:** *"A pod in your Kubernetes deployment is in CrashLoopBackOff. Walk me through how you debug it."*

**90-second answer:**
> "First, I run `kubectl get pods` to confirm the status and see how many restarts have happened. Then immediately `kubectl logs <pod> --previous` — the `--previous` flag is critical because `CrashLoopBackOff` means the container is crashing and restarting, and the current process hasn't produced logs yet.
>
> In the logs, I look for the startup exception. Most common causes for a Spring Boot service: database connection failure at startup, a required environment variable not found, or a port conflict. If the logs are empty — which happens when the JVM itself can't start — I run `kubectl describe pod` and look at the Events section. That shows image pull errors, OOMKilled on the previous run, or a failed liveness probe that forced a restart.
>
> If the logs point to a missing env var, I check `kubectl describe configmap` and `kubectl describe secret` to verify the key exists. If it's a DB connection error, I check `kubectl get endpoints` for the postgres Service to make sure the Service selector is working and pods are registered as endpoints.
>
> `kubectl exec` is my last resort — I use it to run `env`, check DNS resolution (`nslookup postgres-svc`), or test connectivity (`wget http://postgres-svc:5432`)."

---

*Next: [Chapter 3.6 — Capstone Milestone M3 →](./06-capstone-milestone.md)*
