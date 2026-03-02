# 3.6 — Capstone Milestone M3

> **Deliverable:** Both `order-api` and `order-worker` running in a local Kubernetes cluster (kind/minikube). Rolling update performed. HPA configured and inspectable. `kubectl rollout undo` verified.

---

## Verification Checklist

- [ ] `kubectl create namespace order-platform` succeeds
- [ ] `kubectl apply -f capstone/k8s/order-api/` applies cleanly
- [ ] `kubectl apply -f capstone/k8s/order-worker/` applies cleanly
- [ ] `kubectl get pods -n order-platform` shows both `Running` and `READY 1/1`
- [ ] `kubectl port-forward svc/order-api-svc 8080:80 -n order-platform` then `curl http://localhost:8080/actuator/health/readiness` returns `{"status":"UP"}`
- [ ] `kubectl rollout status deployment/order-api -n order-platform` shows `successfully rolled out`
- [ ] `kubectl set image` triggers a rolling update — no downtime observed (verify with continuous `curl`)
- [ ] `kubectl rollout undo deployment/order-api -n order-platform` reverts successfully
- [ ] `kubectl describe hpa order-api-hpa -n order-platform` shows `Metrics: cpu/70% (current/target)`
- [ ] `kubectl top pods -n order-platform` shows resource usage (requires Metrics Server)
- [ ] `kubectl exec -it <pod> -n order-platform -- env | grep SPRING_DATASOURCE_URL` shows the value from ConfigMap

---

## Local Cluster Setup

```bash
# ── Install kind and kubectl ──────────────────────────────────────────
brew install kind kubectl                    # macOS
# or: https://kind.sigs.k8s.io/docs/user/quick-start/

# ── Create cluster ────────────────────────────────────────────────────
cat <<EOF | kind create cluster --name order-platform --config=-
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
- role: worker
- role: worker
EOF

# Confirm cluster
kubectl cluster-info --context kind-order-platform
kubectl get nodes

# ── Install Metrics Server (required for HPA) ─────────────────────────
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Patch for kind (skip TLS verification for local cluster)
kubectl patch deployment metrics-server \
  -n kube-system \
  --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

kubectl rollout status deployment/metrics-server -n kube-system
```

---

## Loading Images into kind

kind runs its own Docker daemon — images on your local Docker are not automatically visible:

```bash
# Build your images
docker build -t order-api:local ./services/order-api
docker build -t order-worker:local ./services/order-worker

# Load into kind
kind load docker-image order-api:local --name order-platform
kind load docker-image order-worker:local --name order-platform

# Update the image in the Deployment manifests to use :local tag
# or use imagePullPolicy: Never in the Deployment spec
```

For the capstone manifests, add `imagePullPolicy: Never` in the Deployment container spec when testing locally:
```yaml
containers:
- name: order-api
  image: order-api:local
  imagePullPolicy: Never    # Use the locally loaded image
```

---

## Applying All Manifests

```bash
# Create namespace
kubectl create namespace order-platform

# Set default namespace
kubectl config set-context --current --namespace=order-platform

# Apply infrastructure (PostgreSQL and LocalStack as K8s Deployments for local testing)
# Note: for local K8s testing, run postgres and localstack as simple Deployments
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: order-platform
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:16-alpine
        env:
        - name: POSTGRES_DB
          value: orderdb
        - name: POSTGRES_USER
          value: orderuser
        - name: POSTGRES_PASSWORD
          value: orderpass
        ports:
        - containerPort: 5432
        readinessProbe:
          exec:
            command: ["pg_isready", "-U", "orderuser", "-d", "orderdb"]
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: postgres-svc
  namespace: order-platform
spec:
  selector:
    app: postgres
  ports:
  - port: 5432
    targetPort: 5432
EOF

# Wait for postgres
kubectl rollout status deployment/postgres

# Apply order-api manifests
kubectl apply -f capstone/k8s/order-api/

# Apply order-worker manifests
kubectl apply -f capstone/k8s/order-worker/

# Watch everything come up
kubectl get pods -w
```

---

## Zero-Downtime Rolling Update Test

```bash
# Terminal 1: continuous health check (should never fail)
while true; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    http://localhost:8080/actuator/health/readiness 2>/dev/null)
  echo "$(date +%H:%M:%S) HTTP $STATUS"
  sleep 0.5
done

# Terminal 2: port-forward
kubectl port-forward svc/order-api-svc 8080:80 -n order-platform

# Terminal 3: trigger rolling update
kubectl set image deployment/order-api \
  order-api=order-api:local \
  -n order-platform

# Watch rollout
kubectl rollout status deployment/order-api -n order-platform
```

**Expected in Terminal 1:** HTTP 200 on every line, including during the rolling update.

If you see HTTP 000 (connection refused) or HTTP 503 during the update, check:
- `maxUnavailable` is `0`
- `readinessProbe.initialDelaySeconds` gives enough time for the new pod to start
- `preStop` hook is giving the load balancer time to drain

---

## Rollback Test

```bash
# Check rollout history
kubectl rollout history deployment/order-api -n order-platform

# Trigger a bad deployment (nonexistent image)
kubectl set image deployment/order-api \
  order-api=order-api:does-not-exist \
  -n order-platform

# Watch it fail
kubectl rollout status deployment/order-api -n order-platform
# → Waiting for deployment ... 1 out of 2 new replicas have been updated...
# → (the new pod will be in ImagePullBackOff)

# Rollback immediately
kubectl rollout undo deployment/order-api -n order-platform

# Verify restored
kubectl rollout status deployment/order-api -n order-platform
# → deployment "order-api" successfully rolled out
```

---

## What's Missing Until Module 4

`order-worker` will start but immediately log errors about SQS connectivity — the LocalStack setup from `docker-compose` is not available in the kind cluster. Orders stay in `PENDING` status (no worker processing them).

In Module 4, you will wire up LocalStack as a K8s Deployment or update the docker-compose approach and integrate SQS properly into both services.

For now, verify `order-api` is healthy and serving traffic. `order-worker` CrashLoopBackOff due to missing SQS is expected at this stage.

---

*Module 3 complete. Move to [Module 4 — AWS Essentials for Spring Boot →](../04-aws-essentials/README.md)*
