# 3.3 — ConfigMaps & Secrets

> **Capstone connection:** `order-api` needs database credentials, an API key, and SQS queue URLs. None of these are hardcoded. All are injected via ConfigMaps (non-sensitive) and Secrets (sensitive). This is non-negotiable in any production environment.

---

## The Rule

> **No credentials, URLs with embedded credentials, or API keys ever appear in source code or Docker images.**

This sounds obvious. It is violated constantly. The most common findings in security audits of backend services:

1. `application.properties` committed to Git with a real database password
2. `AWS_SECRET_ACCESS_KEY` hardcoded in a `Dockerfile` `ENV` instruction
3. API keys in `docker-compose.yml` committed to a public repository

The Kubernetes-native solution: ConfigMaps for non-sensitive config, Secrets for sensitive values.

---

## ConfigMaps — Non-Sensitive Configuration

Use ConfigMaps for anything that changes between environments but is not sensitive:

- Database hostname and port
- SQS queue URLs
- Feature flags
- Log levels
- Application port

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: order-api-config
  namespace: order-platform
data:
  # Spring Boot property names as keys (injected as env vars)
  SPRING_PROFILES_ACTIVE: "kubernetes"
  SPRING_DATASOURCE_URL: "jdbc:postgresql://postgres-svc:5432/orderdb"
  SPRING_DATASOURCE_USERNAME: "orderuser"
  AWS_REGION: "us-east-1"
  SQS_ORDER_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123456789/order-created-queue"
  SERVER_SHUTDOWN: "graceful"
```

Inject into the Deployment:
```yaml
containers:
- name: order-api
  envFrom:
  - configMapRef:
      name: order-api-config    # All keys become environment variables
```

**`envFrom` vs `env` with `valueFrom`:**
- `envFrom: configMapRef` injects all keys at once — convenient for large configs
- `env: valueFrom: configMapKeyRef` injects individual keys — explicit, better for documentation

Use `envFrom` for your main application config and `valueFrom` for values from Secrets (explicit, auditable).

### ConfigMap as mounted file

For config files (like `application-kubernetes.yml`):
```yaml
# In ConfigMap
data:
  application-kubernetes.yml: |
    management:
      server:
        port: 8081
    logging:
      level:
        com.example: INFO

# In Deployment
volumeMounts:
- name: app-config
  mountPath: /app/config
  readOnly: true

volumes:
- name: app-config
  configMap:
    name: order-api-config
```

Spring Boot auto-loads `config/application-*.yml` from the working directory.

---

## Secrets — Sensitive Values

Kubernetes Secrets store values as base64-encoded strings. **Base64 is encoding, not encryption.** Anyone with read access to the Secret can decode the values in seconds.

```bash
echo "orderpass" | base64          # b3JkZXJwYXNzCg==
echo "b3JkZXJwYXNzCg==" | base64 -d  # orderpass
```

Despite this, Secrets are still better than ConfigMaps for sensitive values because:
- RBAC can restrict Secret access separately from ConfigMap access
- Kubernetes can be configured to encrypt Secrets at rest in etcd
- Audit logs track Secret access separately
- External tools (External Secrets Operator) target Secrets specifically

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: order-platform-secrets
  namespace: order-platform
type: Opaque
data:
  db-password: b3JkZXJwYXNz        # base64("orderpass")
  api-key: ZGV2LXNlY3JldC1rZXk=   # base64("dev-secret-key")
  aws-access-key-id: dGVzdA==      # base64("test") — use IRSA in prod
  aws-secret-access-key: dGVzdA==
```

Inject into the Deployment (always use `valueFrom`, never `envFrom` for Secrets):
```yaml
env:
- name: SPRING_DATASOURCE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: order-platform-secrets
      key: db-password
- name: APP_API_KEY
  valueFrom:
    secretKeyRef:
      name: order-platform-secrets
      key: api-key
```

**Why `valueFrom` for Secrets, not `envFrom`?**  
`envFrom` loads all keys. If someone adds a new key to the Secret, it silently appears as an env var in your pod. Explicit `valueFrom` is auditable — you know exactly which secrets your pod uses.

---

## The Production Approach: External Secrets Operator

Kubernetes Secrets have two production problems:

1. They must be created manually or via CI — credentials are in your deployment pipeline
2. Secret values in Git (even encoded) are a security anti-pattern
3. No automatic rotation when AWS rotates credentials

The **External Secrets Operator (ESO)** solves this by syncing secrets from AWS Secrets Manager (or HashiCorp Vault, GCP Secret Manager, etc.) into Kubernetes Secrets automatically.

```yaml
# ExternalSecret — tells ESO what to fetch and where to put it
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: order-platform-secrets
  namespace: order-platform
spec:
  refreshInterval: 1h              # Re-sync from AWS every hour (picks up rotations)
  secretStoreRef:
    name: aws-secretsmanager       # Reference to a ClusterSecretStore (set up by platform team)
    kind: ClusterSecretStore
  target:
    name: order-platform-secrets   # Creates a regular Kubernetes Secret with this name
    creationPolicy: Owner
  data:
  - secretKey: db-password         # Key in the Kubernetes Secret
    remoteRef:
      key: order-platform/prod/db  # Path in AWS Secrets Manager
      property: password           # JSON key within the secret value
  - secretKey: api-key
    remoteRef:
      key: order-platform/prod/api
      property: key
```

**What this means for your Deployment:** nothing changes. The Deployment still reads from `secretKeyRef: name: order-platform-secrets`. ESO manages keeping that Secret in sync with AWS Secrets Manager. If AWS rotates the DB password, ESO detects the change within `refreshInterval` and updates the Secret. Your pods pick up the new value on the next restart or if you configure secret live-reload.

**For the local capstone (kind/minikube):** use plain Secrets with base64 values. ESO is referenced here for interview conversations, not as a capstone requirement.

---

## What Never Goes in Git

| Item | Storage |
|---|---|
| Database passwords | Kubernetes Secret + AWS Secrets Manager (prod) |
| API keys | Kubernetes Secret + AWS Secrets Manager (prod) |
| AWS credentials | IRSA (pod identity) in prod, LocalStack dummy values in dev |
| TLS certificates | Kubernetes Secret (`type: kubernetes.io/tls`) or cert-manager |
| JWT signing keys | Kubernetes Secret + AWS Secrets Manager |

**What is safe in Git:**
- ConfigMap values (non-sensitive)
- Secret structure (keys, not values): `name: db-password` is fine, the value is not
- Secret placeholder manifests with `REPLACE_ME` values

---

## Common Mistakes

**Checking in a real `terraform.tfvars` with database passwords.**  
```hcl
# This is in Git — do not do this
db_password = "ProductionPass123!"
```
Use `TF_VAR_db_password` environment variable or AWS Secrets Manager as a Terraform data source.

**Encoding instead of encrypting and thinking it's secure.**  
"It's base64 encoded, so it's protected" is not a security argument. Treat base64 the same as plaintext for access control purposes.

**Putting configuration that differs by environment in the Docker image.**  
Every `ENV` instruction in a Dockerfile is baked into the image and visible to anyone who can pull it. Environment-specific config belongs in ConfigMaps and Secrets, injected at runtime.

**Not restarting pods after changing a ConfigMap.**  
ConfigMaps are not automatically re-read by running pods (unless mounted as files and your app reloads them). After `kubectl apply` of a ConfigMap change, trigger a rolling restart:

```bash
kubectl rollout restart deployment/order-api -n order-platform
```

---

## Exercise 3.3

**Task:** Apply ConfigMaps and Secrets and verify injection.

```bash
# Apply
kubectl apply -f capstone/k8s/order-api/service-config-hpa.yaml -n order-platform

# Verify the Secret was created
kubectl get secret order-platform-secrets -n order-platform

# Decode a value to verify (never do this in prod scripts)
kubectl get secret order-platform-secrets -n order-platform \
  -o jsonpath='{.data.db-password}' | base64 -d

# Verify env vars are injected in a running pod
kubectl exec -it \
  $(kubectl get pod -l app=order-api -n order-platform -o jsonpath='{.items[0].metadata.name}') \
  -n order-platform -- env | grep -E "SPRING_DATASOURCE|SQS|APP_API"
```

**Expected:** You should see the values from ConfigMap and Secret injected as environment variables without any base64 encoding.

---

## Interview Mode

**Question:** *"How do you manage secrets in Kubernetes?"*

**90-second answer:**
> "In development and local clusters, I use Kubernetes Secrets directly — values are base64-encoded in the manifest. I'm careful never to commit real credential values to Git: the manifest has the structure, values come from a separate source.
>
> In production, I use the External Secrets Operator to sync secrets from AWS Secrets Manager into Kubernetes Secrets. The ESO has a ClusterSecretStore configured with IAM access to Secrets Manager. I define ExternalSecret objects that specify which secret paths to fetch and where to place them. My Deployment manifest doesn't change — it still reads from `secretKeyRef` — but now the values come from a managed, auditable, rotation-capable source.
>
> The key principle is: credentials never travel through Git. They go from AWS Secrets Manager → ESO → Kubernetes Secret → Pod environment variable, all within the cluster. Even if someone gains read access to Git, they get no credentials."

---

*Next: [Chapter 3.4 — Scaling & HPA →](./04-scaling-hpa.md)*
