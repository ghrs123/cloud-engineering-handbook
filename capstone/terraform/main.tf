# ─────────────────────────────────────────────────────────────────────
# Terraform — Cloud-Native Order Processing Platform
#
# What this provisions:
#   - SQS queue (order-created-queue) + Dead Letter Queue
#   - RDS PostgreSQL instance (or LocalStack equivalent in dev)
#   - IAM policy for application access (IRSA-compatible)
#   - Outputs: queue URLs, DB endpoint
#
# Usage:
#   cd envs/dev && terraform init && terraform plan && terraform apply
#   cd envs/prod && terraform init && terraform plan && terraform apply
# ─────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state: S3 + DynamoDB locking
  # Configure in envs/dev/backend.tf and envs/prod/backend.tf
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  # For LocalStack (dev only): override endpoint
  dynamic "endpoints" {
    for_each = var.localstack_endpoint != "" ? [1] : []
    content {
      sqs = var.localstack_endpoint
      rds = var.localstack_endpoint
      iam = var.localstack_endpoint
    }
  }

  # Required for LocalStack (dev only)
  skip_credentials_validation = var.is_localstack
  skip_metadata_api_check     = var.is_localstack
  skip_requesting_account_id  = var.is_localstack
  access_key                  = var.is_localstack ? "test" : null
  secret_key                  = var.is_localstack ? "test" : null
}

# ─── SQS — Dead Letter Queue ─────────────────────────────────────────
resource "aws_sqs_queue" "order_dlq" {
  name                      = "${var.environment}-order-created-dlq"
  message_retention_seconds = 1209600   # 14 days

  tags = var.common_tags
}

# ─── SQS — Main Queue ────────────────────────────────────────────────
resource "aws_sqs_queue" "order_queue" {
  name                       = "${var.environment}-order-created-queue"
  visibility_timeout_seconds = 30
  message_retention_seconds  = 86400    # 1 day
  receive_wait_time_seconds  = 20       # Long polling (reduces empty receives)

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.order_dlq.arn
    maxReceiveCount     = 3             # After 3 failures, move to DLQ
  })

  tags = var.common_tags
}

# ─── RDS — PostgreSQL ────────────────────────────────────────────────
resource "aws_db_subnet_group" "order" {
  name       = "${var.environment}-order-db-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = var.common_tags
}

resource "aws_db_instance" "order_postgres" {
  identifier        = "${var.environment}-order-postgres"
  engine            = "postgres"
  engine_version    = "16.2"
  instance_class    = var.db_instance_class
  allocated_storage = var.db_storage_gb
  storage_type      = "gp3"

  db_name  = "orderdb"
  username = "orderuser"
  password = var.db_password     # Inject from Secrets Manager or terraform.tfvars (not committed)

  db_subnet_group_name   = aws_db_subnet_group.order.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  multi_az            = var.enable_multi_az    # true in prod, false in dev
  skip_final_snapshot = var.environment == "dev"
  deletion_protection = var.environment == "prod"

  backup_retention_period = var.environment == "prod" ? 7 : 1

  tags = var.common_tags
}

# ─── Security Group — RDS ────────────────────────────────────────────
resource "aws_security_group" "rds" {
  name        = "${var.environment}-order-rds-sg"
  description = "Allow PostgreSQL access from order services"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.app_security_group_id]   # Only from application SG
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.common_tags
}

# ─── IAM — Policy for application access ─────────────────────────────
# This policy is attached to the IRSA role used by K8s ServiceAccounts
resource "aws_iam_policy" "order_app" {
  name        = "${var.environment}-order-app-policy"
  description = "Permissions for order-api and order-worker"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
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
      }
    ]
  })
}
