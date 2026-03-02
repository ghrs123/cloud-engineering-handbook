# 5.1 — Terraform Core Concepts

> **What you need to know as a backend engineer:** enough to read, write, and modify Terraform for your service's infrastructure. You don't need to manage Terraform Cloud or design multi-region module hierarchies.

---

## The Mental Model

Terraform works with three things:

1. **Desired state** — what you write in `.tf` files: "I want an SQS queue named `order-created-queue`"
2. **Actual state** — what exists in AWS right now
3. **State file** — Terraform's record of what it last created/managed

The workflow:
```
Write .tf → terraform plan (diff: desired vs actual) → terraform apply (make actual = desired)
```

The `plan` is the most important step. It shows exactly what will be created, modified, or destroyed — before touching anything. Always review the plan before applying. In production, plans are reviewed in pull requests.

---

## The Four Core Building Blocks

### Provider

Tells Terraform which cloud/service to manage and how to authenticate:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"    # ~> means: >= 5.0, < 6.0
    }
  }
}

provider "aws" {
  region = var.aws_region

  # For LocalStack only — remove in real AWS
  endpoints {
    sqs = var.localstack_endpoint
    rds = var.localstack_endpoint
  }
  skip_credentials_validation = var.is_localstack
  skip_requesting_account_id  = var.is_localstack
  access_key = var.is_localstack ? "test" : null
  secret_key = var.is_localstack ? "test" : null
}
```

### Resource

The actual infrastructure you're creating:

```hcl
resource "aws_sqs_queue" "order_dlq" {
  # resource type ↑      # resource name (local ref) ↑
  name                      = "dev-order-created-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "order_queue" {
  name                       = "dev-order-created-queue"
  visibility_timeout_seconds = 30

  # Reference the DLQ using its resource address
  # Terraform resolves dependencies automatically from references
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.order_dlq.arn   # ← reference
    maxReceiveCount     = 3
  })
}
```

Resource references (`aws_sqs_queue.order_dlq.arn`) create implicit dependencies. Terraform builds a dependency graph and creates the DLQ before the main queue — without you specifying the order.

### Data Source

Read existing infrastructure (not managed by this Terraform):

```hcl
# Read an existing VPC to get its ID for security group rules
data "aws_vpc" "main" {
  filter {
    name   = "tag:Name"
    values = ["production-vpc"]
  }
}

# Use it
resource "aws_security_group" "rds" {
  vpc_id = data.aws_vpc.main.id   # ← reference data source
}
```

### Local Value

Computed values to avoid repetition:

```hcl
locals {
  name_prefix = "${var.environment}-order"
  common_tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Service     = "order-platform"
  }
}

resource "aws_sqs_queue" "order_queue" {
  name = "${local.name_prefix}-created-queue"   # ← use local
  tags = local.common_tags
}
```

---

## The Workflow Commands

```bash
# 1. Initialise — download providers, configure backend
terraform init

# 2. Validate syntax
terraform validate

# 3. Plan — show what will change (read-only, no side effects)
terraform plan
terraform plan -out=tfplan          # Save plan to file

# 4. Apply — make changes
terraform apply                     # Shows plan, asks for confirmation
terraform apply tfplan              # Apply saved plan (no confirmation needed, used in CI)
terraform apply -auto-approve       # Skip confirmation (CI only, never manually in prod)

# 5. Show current state
terraform show
terraform state list                # List all managed resources

# 6. Destroy — remove everything (DANGEROUS in prod)
terraform destroy
terraform destroy -target=aws_sqs_queue.order_queue   # Target specific resource
```

---

## Reading a `terraform plan` Output

```
Terraform will perform the following actions:

  # aws_sqs_queue.order_dlq will be created
  + resource "aws_sqs_queue" "order_dlq" {
      + arn                               = (known after apply)
      + id                                = (known after apply)
      + message_retention_seconds         = 1209600
      + name                              = "dev-order-created-dlq"
      + tags                              = {
          + "Environment" = "dev"
          + "ManagedBy"   = "terraform"
        }
    }

  # aws_sqs_queue.order_queue will be modified in-place
  ~ resource "aws_sqs_queue" "order_queue" {
        id                                = "https://..."
      ~ visibility_timeout_seconds        = 30 -> 60    # ← changed
        # (all other attributes unchanged)
    }

  # aws_db_instance.order_postgres must be replaced
  -/+ resource "aws_db_instance" "order_postgres" {
      ~ instance_class = "db.t3.micro" -> "db.t3.small"  # forces replacement
    }

Plan: 1 to add, 1 to change, 1 to destroy.
```

**Symbol legend:**
- `+` create
- `-` destroy
- `~` modify in-place (no downtime for most resources)
- `-/+` destroy and recreate (**DANGEROUS** — means downtime for databases)

Always look for `-/+` in plans. Changing certain RDS attributes (like `instance_class` or `engine_version`) forces replacement — the old database is deleted and a new one is created. Those changes require a maintenance window.

---

## Common Mistakes

**Running `terraform apply` without reviewing the plan.**
In CI, use `plan -out=tfplan` in one step, have a human review it, then `apply tfplan` in a separate step. Never `apply -auto-approve` in production.

**Not pinning provider versions.**
```hcl
# Bad — gets latest, may break
required_providers {
  aws = { source = "hashicorp/aws" }
}

# Good — explicit constraint
required_providers {
  aws = { source = "hashicorp/aws", version = "~> 5.0" }
}
```

**Manually modifying resources managed by Terraform.**
If you change an SQS queue in the AWS console and then run `terraform apply`, Terraform will revert your manual change. Terraform owns the resources it created. All changes must go through Terraform.

---

## Interview Mode

**Question:** *"What is Terraform state and why does it matter?"*

**60-second answer:**
> "Terraform state is a JSON file that records what infrastructure Terraform has created and manages. It maps your resource definitions to the real AWS resource IDs. When you run `terraform plan`, Terraform compares your `.tf` files against the state file to determine what has changed — not by querying AWS directly for every resource.
>
> State is critical because without it, Terraform can't know what exists. If the state file is lost, Terraform loses track of all managed resources — it can't update or destroy them. That's why remote state in S3 is mandatory for any team use: it's shared, versioned, and doesn't live on one engineer's laptop.
>
> The DynamoDB locking table is equally important — it prevents two engineers from running `terraform apply` simultaneously, which would cause state corruption."

---

*Next: [Chapter 5.2 — State Management →](./02-state-management.md)*
