# 3.1 — Cluster Anatomy

> **What you need vs what you don't.** A backend engineer does not need to operate a Kubernetes cluster. You need to understand it well enough to write correct manifests, debug your own deployments, and have an informed conversation with platform engineers.

---

## The Mental Model

Kubernetes is a system that watches a desired state and works to make the actual state match it.

You declare: "I want 3 replicas of `order-api` running, with at least 256MB of memory each, reachable on port 8080."

Kubernetes continuously works to make that true. If a pod crashes, Kubernetes replaces it. If a node fails, Kubernetes moves the pods to other nodes. If load increases and HPA triggers, Kubernetes adds pods.

You do not start or stop pods manually. You change the desired state and Kubernetes handles the rest.

---

## The Components (What You Need to Know)

### Control Plane — runs the cluster itself

You don't manage these. They run on dedicated nodes. Understanding what they do helps you interpret errors.

| Component | What it does | Why you care |
|---|---|---|
| **API Server** | Single entry point for all cluster operations. Every `kubectl` command goes here. | If you get "connection refused" from kubectl, the API server is down |
| **etcd** | Distributed key-value store, holds all cluster state | If etcd is degraded, the cluster can't accept changes |
| **Scheduler** | Decides which node a new Pod runs on, based on resource requests and affinity rules | If pods are stuck in `Pending`, check scheduler events |
| **Controller Manager** | Runs controllers: Deployment controller, ReplicaSet controller, HPA controller | The Deployment controller is what creates pods from your Deployment manifest |

### Worker Nodes — run your workload

| Component | What it does | Why you care |
|---|---|---|
| **kubelet** | Agent on every node. Starts/stops containers, reports health | If a pod is stuck in `ContainerCreating`, look at kubelet logs |
| **kube-proxy** | Manages network rules for Service routing | Relevant when debugging Service connectivity |
| **Container runtime** | containerd or CRI-O — actually runs containers | You usually don't interact with this directly |

### The Objects You Create

| Object | Purpose | Created by |
|---|---|---|
| **Pod** | One or more containers, shared network/storage | Deployment controller (never create bare Pods) |
| **ReplicaSet** | Maintains N copies of a Pod | Deployment controller (you don't create these directly either) |
| **Deployment** | Manages ReplicaSets, enables rolling updates and rollbacks | You |
| **Service** | Stable network endpoint for a set of Pods | You |
| **ConfigMap** | Non-sensitive configuration data | You |
| **Secret** | Sensitive configuration data | You (or External Secrets Operator) |
| **HPA** | Horizontal Pod Autoscaler — scales Deployment replicas | You |
| **Namespace** | Logical isolation scope | You or platform team |

---

## Pod Lifecycle — Why Pods Are Ephemeral

```
Pending → Running → Succeeded / Failed / Unknown
```

| Phase | Meaning |
|---|---|
| `Pending` | Pod accepted, waiting for node assignment or image pull |
| `Running` | At least one container is running |
| `Succeeded` | All containers completed successfully (batch jobs) |
| `Failed` | At least one container exited with non-zero code |
| `Unknown` | Node communication lost |

**Critical implication:** Pods are disposable. They have no stable IP address — every time a pod restarts or reschedules, it gets a new IP. This is why you never talk to a Pod directly. You always talk to a **Service**, which has a stable virtual IP and name that routes to the current healthy pods.

---

## Namespaces — Logical Isolation

All capstone manifests use the `order-platform` namespace. Create it before applying:

```bash
kubectl create namespace order-platform
```

Namespaces provide:
- Resource isolation (you can set ResourceQuotas per namespace)
- RBAC scope (permissions per namespace)
- Naming scope (two services named `postgres` can coexist in different namespaces)

```bash
# Most kubectl commands need -n flag or you work against 'default' namespace
kubectl get pods -n order-platform
kubectl get deployments -n order-platform
kubectl logs <pod-name> -n order-platform
```

Set the default namespace for your current context to avoid typing `-n` every time:
```bash
kubectl config set-context --current --namespace=order-platform
```

---

## OpenShift Compatibility

The capstone manifests are designed to work on both Kubernetes and OpenShift. Key differences that matter for backend engineers:

| Topic | Kubernetes | OpenShift |
|---|---|---|
| Security Context | Optional | SCCs (Security Context Constraints) enforced by default |
| Running as root | Allowed (not recommended) | Blocked by default |
| Arbitrary UIDs | Allowed | OpenShift assigns a random UID from a range |
| Routes | Use Ingress | OpenShift `Route` object (Ingress also works on modern OCP) |
| Image registry | Any registry | Internal registry available, image pull secrets needed for external |

**The `runAsNonRoot: true` and `runAsUser: 1000`** in the capstone manifests ensure compatibility with both. On OpenShift, if your SCC allows arbitrary UIDs, it will override `runAsUser` with its assigned UID — that's fine as long as your application doesn't depend on a specific UID.

---

## The Relationship Between Deployment, ReplicaSet, and Pod

```
Deployment (order-api)
  └── ReplicaSet (order-api-6d8f9b4c7)        ← current version
        ├── Pod (order-api-6d8f9b4c7-xk2p9)
        ├── Pod (order-api-6d8f9b4c7-m7nq3)
        └── Pod (order-api-6d8f9b4c7-p4rt8)
  └── ReplicaSet (order-api-7e9a0c5d8)        ← previous version (kept for rollback)
        └── (0 pods — scaled down)
```

When you do a rolling update:
1. Kubernetes creates a new ReplicaSet with the new image
2. It scales up the new RS while scaling down the old RS
3. The old RS is kept with 0 replicas for rollback capability

```bash
# See all ReplicaSets for a Deployment
kubectl get rs -n order-platform

# Rollback to the previous ReplicaSet
kubectl rollout undo deployment/order-api -n order-platform

# See rollout history
kubectl rollout history deployment/order-api -n order-platform
```

---

## Common Mistakes

**Creating bare Pods instead of Deployments.**
```yaml
# Wrong — if this Pod dies, it's gone forever
apiVersion: v1
kind: Pod
metadata:
  name: order-api
```
Always use a Deployment. The controller handles restarts, rolling updates, and scaling.

**Not setting resource requests.**  
Without `resources.requests`, the Scheduler places pods anywhere. You may end up with 10 pods on one node and 0 on another, causing OOMKilled events. Always set `requests` — it's the Scheduler's currency.

**Using `kubectl apply` with `--force` in production.**  
`--force` deletes and recreates resources. This means downtime. Always prefer `kubectl apply` (which patches in-place) or `kubectl rollout restart`.

---

## Interview Mode

**Question:** *"Explain how Kubernetes handles a rolling update for your service."*

**60-second answer:**
> "When I update the image tag in my Deployment manifest and apply it, Kubernetes creates a new ReplicaSet with the updated image. It then scales up the new ReplicaSet and scales down the old one incrementally. The rate is controlled by `maxSurge` and `maxUnavailable` — I set `maxUnavailable: 0` which means Kubernetes never reduces the number of running pods below the desired count. It adds a new pod, waits for it to pass the readiness probe, then removes an old pod.
>
> The old ReplicaSet is kept with zero replicas. If I need to rollback — because the new version has a bug — I run `kubectl rollout undo` and Kubernetes scales the old ReplicaSet back up while scaling down the new one. The whole process is the same rolling update mechanism in reverse."

---

*Next: [Chapter 3.2 — Deployments & Services →](./02-deployments-services.md)*
