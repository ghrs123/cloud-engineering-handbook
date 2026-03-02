# 5.3 — Variables, Outputs, Locals & Environment Separation

---

## Variables — Parameterise Everything That Changes

```hcl
# variables.tf
variable "environment" {
  type        = string
  description = "Deployment environment: dev, staging, prod"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Must be dev, staging, or prod."
  }
}

variable "db_password" {
  type      = string
  sensitive = true   # Redacted in plan output and logs
  description = "RDS master password — inject via TF_VAR_db_password or AWS Secrets Manager"
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "enable_multi_az" {
  type    = bool
  default = false
}
```

### How to pass variable values

**Option 1 — `.tfvars` file (per environment):**
```hcl
# envs/dev/terraform.tfvars
environment       = "dev"
db_instance_class = "db.t3.micro"
enable_multi_az   = false
```

```hcl
# envs/prod/terraform.tfvars
environment       = "prod"
db_instance_class = "db.t3.small"
enable_multi_az   = true
```

**Option 2 — Environment variables (for secrets, in CI):**
```bash
export TF_VAR_db_password="$(aws secretsmanager get-secret-value \
  --secret-id order-platform/prod/db-password \
  --query SecretString --output text | jq -r .password)"
terraform apply
```

Never put real passwords in `.tfvars` files committed to Git.

---

## Outputs — Expose Values for Other Systems

After Terraform provisions infrastructure, other systems (your CI pipeline, your K8s manifests) need the resulting values — queue URLs, DB endpoints, IAM role ARNs:

```hcl
# outputs.tf
output "order_queue_url" {
  description = "SQS queue URL for order-api ConfigMap"
  value       = aws_sqs_queue.order_queue.url
}

output "order_dlq_url" {
  description = "SQS DLQ URL"
  value       = aws_sqs_queue.order_dlq.url
}

output "db_endpoint" {
  description = "RDS endpoint for SPRING_DATASOURCE_URL"
  value       = aws_db_instance.order_postgres.endpoint
}

output "db_password" {
  description = "RDS password — used to create K8s Secret"
  value       = var.db_password
  sensitive   = true   # Not shown in console output or logs
}

output "app_iam_policy_arn" {
  description = "Attach to IRSA role for pod AWS access"
  value       = aws_iam_policy.order_app.arn
}
```

```bash
# Read outputs after apply
terraform output order_queue_url
# https://sqs.us-east-1.amazonaws.com/123456789/prod-order-created-queue

# Use in CI to update K8s ConfigMap
QUEUE_URL=$(terraform output -raw order_queue_url)
kubectl create configmap order-api-config \
  --from-literal=SQS_ORDER_QUEUE_URL=$QUEUE_URL \
  -n order-platform --dry-run=client -o yaml | kubectl apply -f -
```

---

## Environment Separation — Directories vs Workspaces

Two approaches for managing dev/prod:

### Approach A: Separate directories (recommended for this course)

```
capstone/terraform/
├── main.tf          ← shared resource definitions
├── variables.tf     ← variable declarations
├── outputs.tf       ← output declarations
└── envs/
    ├── dev/
    │   ├── backend.tf       ← S3 backend with dev key
    │   └── terraform.tfvars ← dev variable values
    └── prod/
        ├── backend.tf       ← S3 backend with prod key
        └── terraform.tfvars ← prod variable values
```

Usage:
```bash
# Apply dev
cd capstone/terraform
terraform init -backend-config=envs/dev/backend.tf
terraform apply -var-file=envs/dev/terraform.tfvars

# Apply prod (separate state, separate variables)
terraform init -reconfigure -backend-config=envs/prod/backend.tf
terraform apply -var-file=envs/prod/terraform.tfvars
```

### Approach B: Terraform Workspaces

```bash
terraform workspace new dev
terraform workspace new prod
terraform workspace select dev
terraform apply   # uses dev workspace state
```

**Why directories are preferred:**
- Workspaces share the same backend configuration — accidentally applying to prod is easier
- Directory approach makes the environment explicit in the file path
- Easier to have different backend buckets per environment (dev bucket vs prod bucket with stricter IAM)

---

## Capstone Milestone M5

```bash
# ── Start LocalStack ──────────────────────────────────────────────────
docker run -d -p 4566:4566 -e SERVICES=sqs,rds -e AWS_DEFAULT_REGION=us-east-1 \
  localstack/localstack:3

# Create LocalStack S3 bucket for state
aws --endpoint-url=http://localhost:4566 --region us-east-1 \
  s3api create-bucket --bucket terraform-state

# ── Initialise and apply ───────────────────────────────────────────────
cd capstone/terraform
terraform init -backend-config=envs/dev/backend.tf
terraform validate
terraform plan -var-file=envs/dev/terraform.tfvars

# Review plan — verify:
# + aws_sqs_queue.order_dlq (create)
# + aws_sqs_queue.order_queue (create)
# + aws_db_instance.order_postgres (create)
# + aws_iam_policy.order_app (create)

terraform apply -var-file=envs/dev/terraform.tfvars

# ── Verify outputs ────────────────────────────────────────────────────
terraform output
# order_queue_url = "http://localhost:4566/000000000000/dev-order-created-queue"
# db_endpoint     = "localhost:5432"
# app_iam_policy_arn = "arn:aws:iam::000000000000:policy/dev-order-app-policy"

# ── Verify checklist ──────────────────────────────────────────────────
# [ ] terraform plan shows 0 changes after apply (idempotent)
# [ ] terraform output returns all expected values
# [ ] SQS queues exist in LocalStack:
aws --endpoint-url=http://localhost:4566 --region us-east-1 sqs list-queues
# [ ] No credentials committed to Git:
git diff --cached | grep -E "(password|secret|key)" && echo "FAIL: credentials in git" || echo "OK"
```

---

## Interview Mode

**Question:** *"How do you manage infrastructure across multiple environments with Terraform?"*

**60-second answer:**
> "I use separate directories for each environment — `envs/dev/` and `envs/prod/` — each with its own backend configuration and `.tfvars` file. The resource definitions in `main.tf` are shared, but the state is completely isolated: dev has its own S3 key, prod has its own. Destroying dev never touches prod.
>
> Sensitive values like database passwords never go in `.tfvars` files committed to Git. In CI, I inject them via `TF_VAR_` environment variables sourced from AWS Secrets Manager at pipeline runtime.
>
> The workflow for a prod change: open a PR with the `.tf` change, CI runs `terraform plan` and posts the output as a PR comment, a second engineer reviews both the code and the plan, then the plan is applied after merge. The `-out=tfplan` flag ensures what gets applied is exactly what was reviewed — not a re-planned version that might differ if AWS state changed."

---

*Module 5 complete. Move to [Module 6 — Resilience Patterns →](../06-resilience-patterns/README.md)*
