# Module 3 — Kubernetes/OpenShift for Backend Engineers

> **Theme:** The Operations Layer. You have a container that works. Now you need to run it reliably at scale — with rolling updates that don't cause downtime, automatic restarts when it crashes, traffic routing that respects readiness, and horizontal scaling when load increases. Kubernetes handles all of this. Your job is to know how to configure it correctly and how to debug when it goes wrong.

---

## What This Module Builds

By the end of this module you will have implemented **Milestone M3** of the capstone:

- Complete Kubernetes manifests for `order-api` and `order-worker` applied to a local cluster (kind/minikube)
- Rolling update with zero downtime (`maxUnavailable: 0`)
- HPA configured and verifiable with `kubectl describe hpa`
- `kubectl rollout undo` rollback tested and working
- ConfigMaps and Secrets wired into both Deployments
- Readiness and liveness probes verified in-cluster

---

## Chapters

| # | Title | What you learn |
|---|---|---|
| [3.1](./01-cluster-anatomy.md) | Cluster Anatomy | Control plane, nodes, pods, what you need to know vs what ops manages |
| [3.2](./02-deployments-services.md) | Deployments & Services | Deployment YAML anatomy, rolling updates, Service types |
| [3.3](./03-config-secrets.md) | ConfigMaps & Secrets | Externalising config, the External Secrets Operator, what never goes in Git |
| [3.4](./04-scaling-hpa.md) | Scaling & HPA | Horizontal Pod Autoscaler, resource requests/limits, scaling behavior |
| [3.5](./05-debugging-kubectl.md) | Debugging with kubectl | CrashLoopBackOff, OOMKilled, pending pods — the diagnostic workflow |
| [3.6](./06-capstone-milestone.md) | Capstone Milestone M3 | Full apply, smoke test in-cluster, verification checklist |

---

## What You Need Before Starting

- Docker installed and the image from Module 2 building successfully
- A local Kubernetes cluster: [kind](https://kind.sigs.k8s.io/) or [minikube](https://minikube.sigs.k8s.io/)
- `kubectl` installed

```bash
# Quick setup with kind
brew install kind kubectl
kind create cluster --name order-platform
kubectl cluster-info --context kind-order-platform
```

---

## What You Don't Need

- A real AWS account (Module 4)
- Helm (useful in production, deliberately excluded here — understand raw manifests first)
- Istio or any service mesh
- Cluster-admin access (all manifests are namespace-scoped)

---

## Key Principle

> Kubernetes does not run your application. It runs whatever container image you point it at. If the container is wrong (bad JVM config, no graceful shutdown, missing health probes), Kubernetes cannot fix it. Module 2 prepared the container. This module configures the orchestrator to use it correctly.

---

*Start with [Chapter 3.1 — Cluster Anatomy →](./01-cluster-anatomy.md)*
