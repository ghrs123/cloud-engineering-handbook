# 5.2 — State Management

> State is Terraform's memory. Lose it, corrupt it, or let two people write it simultaneously — and your infrastructure becomes unmanageable. This chapter explains how to make state safe.

---

## Why Local State Is Not Production-Ready

By default, `terraform init` creates `terraform.tfstate` in the current directory. This is fine for learning. It is not acceptable for team use:

| Problem | What happens |
|---|---|
| State lives on one machine | Other team members can't run Terraform — they have no state |
| State is not versioned | If you delete or corrupt it, it's gone |
| No locking | Two engineers running `apply` simultaneously corrupt the state |
| State contains secrets | DB passwords in state → they live in a file on your laptop |

---

## Remote State: S3 + DynamoDB

The standard AWS setup: store state in S3 (versioned, encrypted), lock with DynamoDB:

```hcl
# capstone/terraform/backend.tf
terraform {
  backend "s3" {
    bucket         = "your-company-terraform-state"   # Must exist before terraform init
    key            = "order-platform/dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true                             # Encrypt state at rest
    dynamodb_table = "terraform-locks"               # For state locking
  }
}
```

### Creating the S3 Bucket and DynamoDB Table

These are the only resources you create manually (before Terraform can manage anything):

```bash
# Create the S3 bucket for state (do this once per AWS account)
aws s3api create-bucket \
  --bucket your-company-terraform-state \
  --region us-east-1

# Enable versioning (allows state recovery)
aws s3api put-bucket-versioning \
  --bucket your-company-terraform-state \
  --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-encryption \
  --bucket your-company-terraform-state \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}
    }]
  }'

# Create DynamoDB table for locking
aws dynamodb create-table \
  --table-name terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### How the Lock Works

```
Engineer A: terraform apply → acquires lock (writes to DynamoDB) → applies changes → releases lock
Engineer B: terraform apply → tries to acquire lock → LOCKED → waits or fails

If Engineer A crashes mid-apply: lock remains in DynamoDB
Engineer B (or A): terraform force-unlock <lock-id>   # Manual unlock after verifying A's apply truly stopped
```

---

## State Per Environment

Each environment gets its own state file with a unique `key`:

```
s3://your-company-terraform-state/
  order-platform/
    dev/terraform.tfstate      ← dev environment state
    staging/terraform.tfstate  ← staging environment state
    prod/terraform.tfstate     ← prod environment state
```

```hcl
# envs/dev/backend.tf
terraform {
  backend "s3" {
    bucket = "your-company-terraform-state"
    key    = "order-platform/dev/terraform.tfstate"
    region = "us-east-1"
    dynamodb_table = "terraform-locks"
  }
}

# envs/prod/backend.tf
terraform {
  backend "s3" {
    bucket = "your-company-terraform-state"
    key    = "order-platform/prod/terraform.tfstate"
    region = "us-east-1"
    dynamodb_table = "terraform-locks"
  }
}
```

**Critical:** dev and prod states are completely independent. Destroying the dev environment does not affect prod.

---

## State for LocalStack (capstone dev environment)

For local development with LocalStack, use a local backend — no real S3 needed:

```hcl
# envs/dev/backend.tf (local dev override)
terraform {
  backend "local" {
    path = "terraform.tfstate"   # Stored locally — acceptable for dev with LocalStack
  }
}
```

Or, use LocalStack's S3 emulation:

```hcl
terraform {
  backend "s3" {
    bucket   = "terraform-state"
    key      = "order-platform/dev/terraform.tfstate"
    region   = "us-east-1"
    endpoint = "http://localhost:4566"
    # LocalStack-specific flags
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_requesting_account_id  = true
    access_key = "test"
    secret_key = "test"
    # Disable S3 checksum validation (LocalStack compatibility)
    skip_s3_checksum = true
  }
}
```

Create the bucket in LocalStack first:
```bash
aws --endpoint-url=http://localhost:4566 --region us-east-1 \
  s3api create-bucket --bucket terraform-state
```

---

## What's in the State File

```json
{
  "version": 4,
  "terraform_version": "1.7.0",
  "resources": [
    {
      "type": "aws_sqs_queue",
      "name": "order_queue",
      "instances": [{
        "attributes": {
          "id": "https://sqs.us-east-1.amazonaws.com/123456789/dev-order-created-queue",
          "arn": "arn:aws:sqs:us-east-1:123456789:dev-order-created-queue",
          "name": "dev-order-created-queue",
          "visibility_timeout_seconds": 30
        }
      }]
    }
  ]
}
```

**Note:** if your Terraform includes an `aws_db_instance` resource with a password, the password appears in plaintext in the state file. This is why:
1. State bucket must be encrypted
2. Access to the state bucket must be restricted via IAM
3. Never commit state files to Git (add `*.tfstate` and `*.tfstate.backup` to `.gitignore`)

---

## Recovering from State Issues

```bash
# List all resources in state
terraform state list

# Show details of a specific resource
terraform state show aws_sqs_queue.order_queue

# Remove a resource from state without destroying it
# (useful when you want Terraform to stop managing a resource)
terraform state rm aws_sqs_queue.order_queue

# Import an existing resource into state
# (useful when someone created a resource manually and you want Terraform to manage it)
terraform import aws_sqs_queue.order_queue \
  https://sqs.us-east-1.amazonaws.com/123456789/existing-queue

# Move a resource to a different address (e.g., after refactoring module structure)
terraform state mv aws_sqs_queue.order_queue module.sqs.aws_sqs_queue.order_queue
```

---

## Interview Mode

**Question:** *"What happens if two engineers run `terraform apply` at the same time?"*

**45-second answer:**
> "Without state locking, they both read the same state, both compute a plan against the same current infrastructure, and both try to apply. The results are unpredictable — resources may be created twice, or one apply may overwrite the other's changes, leading to state corruption where Terraform's record no longer matches what's actually in AWS.
>
> With DynamoDB locking, the first engineer to run `apply` acquires a lock. The second gets an error: 'Error acquiring the state lock.' They have to wait. When the first finishes, the lock is released and the second can proceed with an up-to-date state.
>
> If an apply crashes while holding the lock, the lock must be manually released with `terraform force-unlock` — after verifying the previous apply truly stopped."

---

*Next: [Chapter 5.3 — Variables, Outputs & Locals →](./03-variables-outputs.md)*
