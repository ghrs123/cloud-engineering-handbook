# 4.5 — IAM & IRSA

> **The rule:** no AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) ever appear in your code, your Dockerfiles, your Kubernetes Secrets committed to Git, or your CI logs. In production, pods access AWS via IAM Roles for Service Accounts (IRSA). This chapter explains why and how.

---

## Why Static Credentials Are Dangerous

Static IAM credentials (access key + secret key) have three critical problems:

1. **They don't expire.** A leaked key from a public GitHub repo 3 years ago is still valid today unless manually rotated.
2. **They're hard to rotate.** Rotating requires updating every service that uses them — Kubernetes Secrets, CI pipelines, developer machines.
3. **They have no scope.** The same key is used in dev, staging, and prod. Compromise in dev means exposure in prod.

The most common security incidents in AWS environments involve leaked access keys. It's the #1 finding in cloud security audits.

---

## The IRSA Solution

**IAM Roles for Service Accounts** gives pods a temporary, scoped, automatically-rotating IAM identity — without any credentials stored anywhere in the application.

```
Pod (order-api) → Kubernetes ServiceAccount (order-api-sa)
                           ↓
              IAM Role (order-api-role) [via OIDC trust]
                           ↓
              IAM Policy (SQS send, RDS connect)
                           ↓
              Temporary credentials (auto-rotated every 15min)
              Injected as env vars by the EKS pod identity webhook
```

The pod never sees `AWS_ACCESS_KEY_ID`. It gets `AWS_ROLE_ARN` and `AWS_WEB_IDENTITY_TOKEN_FILE`. The AWS SDK reads these automatically.

---

## Setting Up IRSA (Platform Team Does This)

As a backend engineer, you typically don't create the IRSA setup — the platform team does. But you need to understand it to:
- Request the right permissions
- Debug access denied errors
- Write the Terraform that provisions it

### Step 1: Create the IAM Policy (Terraform — you write this)

```hcl
# In capstone/terraform/main.tf (already shown in Etapa 1)
resource "aws_iam_policy" "order_app" {
  name = "${var.environment}-order-app-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ChangeMessageVisibility"
      ]
      Resource = [
        aws_sqs_queue.order_queue.arn,
        aws_sqs_queue.order_dlq.arn
      ]
    }]
  })
}
```

**Least privilege:** only the exact actions needed, only on the exact queues that the service uses. No `sqs:*`. No `*`.

### Step 2: Create the IAM Role with EKS OIDC Trust (platform team)

```hcl
data "aws_iam_openid_connect_provider" "eks" {
  url = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

resource "aws_iam_role" "order_api" {
  name = "${var.environment}-order-api-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = data.aws_iam_openid_connect_provider.eks.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${data.aws_iam_openid_connect_provider.eks.url}:sub" =
            "system:serviceaccount:order-platform:order-api-sa"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "order_api" {
  role       = aws_iam_role.order_api.name
  policy_arn = aws_iam_policy.order_app.arn
}
```

### Step 3: Create the Kubernetes ServiceAccount (you write this)

```yaml
# capstone/k8s/order-api/serviceaccount.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: order-api-sa
  namespace: order-platform
  annotations:
    # This annotation is what links the K8s SA to the IAM Role
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789:role/prod-order-api-role
```

### Step 4: Reference the ServiceAccount in your Deployment

```yaml
spec:
  template:
    spec:
      serviceAccountName: order-api-sa    # ← add this
      containers:
      - name: order-api
        # Remove static credential env vars:
        # AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are NOT needed
        # The AWS SDK picks up temporary creds automatically from the injected token
```

**Result:** the pod gets temporary credentials valid for 15 minutes, scoped to exactly the permissions in the attached policy, with no credentials stored anywhere.

---

## Debugging IRSA Issues

When you get `AccessDenied` from AWS in a pod with IRSA:

```bash
# 1. Verify the ServiceAccount annotation is correct
kubectl describe sa order-api-sa -n order-platform
# Look for: eks.amazonaws.com/role-arn annotation

# 2. Verify the pod is using the ServiceAccount
kubectl describe pod <order-api-pod> -n order-platform
# Look for: Service Account: order-api-sa
# Look for: AWS_ROLE_ARN env var (injected by webhook)
# Look for: AWS_WEB_IDENTITY_TOKEN_FILE env var (injected by webhook)

# 3. Test the assumed role from inside the pod
kubectl exec -it <pod> -n order-platform -- sh
aws sts get-caller-identity
# Should return the role ARN, not the node's instance profile
```

Common issues:
- OIDC provider not created for the cluster
- Trust policy condition has wrong namespace or service account name (typo)
- IAM policy doesn't allow the specific action/resource the code is calling
- Pod is using `default` ServiceAccount instead of the annotated one

---

## For Local Development: LocalStack with Dummy Credentials

```yaml
# application-dev.yml
spring:
  cloud:
    aws:
      credentials:
        access-key: test     # LocalStack accepts any non-empty value
        secret-key: test
      sqs:
        endpoint: http://localhost:4566
```

Never use real AWS credentials for local development. LocalStack works with dummy values. If you need to test against real AWS in dev, use a separate AWS account with limited permissions and short-lived credentials via `aws sso login`.

---

## IAM Best Practices Summary

| Practice | Why |
|---|---|
| Least privilege | If credentials are compromised, blast radius is limited |
| No static credentials in code/config | Keys don't expire and are hard to audit |
| IRSA for EKS workloads | Temporary, scoped, auto-rotating, no storage |
| Separate policies per service | `order-api` and `order-worker` get different permissions |
| Use conditions in trust policies | Prevents other namespaces/accounts from assuming the role |
| Audit with CloudTrail | Every API call is logged with the caller identity |

---

## Interview Mode

**Question:** *"How does your application authenticate with AWS services in production? How do you avoid storing credentials?"*

**90-second answer:**
> "In production on EKS, I use IRSA — IAM Roles for Service Accounts. Each Kubernetes ServiceAccount is annotated with an IAM Role ARN. When the pod starts, an EKS webhook injects temporary credentials via a web identity token file. The AWS SDK picks these up automatically — no `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` anywhere in the pod, the image, or the Kubernetes Secret.
>
> The IAM Role has a trust policy that scopes it to a specific EKS cluster, namespace, and service account name. So even if someone runs a pod in a different namespace, they can't assume this role. The attached IAM policy follows least privilege — only the SQS actions our service actually calls, only on our specific queues.
>
> For local development with LocalStack, we use dummy credentials — any non-empty string. LocalStack doesn't validate them. In CI that runs against real AWS, we use short-lived credentials from GitHub Actions OIDC federation, not static keys stored in GitHub Secrets."

---

*Next: [Chapter 4.6 — Capstone Milestone M4 →](./06-capstone-milestone.md)*
