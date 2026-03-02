variable "environment" {
  type        = string
  description = "Environment name: dev, staging, prod"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod"
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "localstack_endpoint" {
  type        = string
  default     = ""
  description = "Override endpoint for LocalStack (dev only). Leave empty for real AWS."
}

variable "is_localstack" {
  type        = bool
  default     = false
  description = "Set to true when using LocalStack (disables credential validation)"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID for RDS security group"
  default     = ""   # Empty in dev (LocalStack)
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for RDS subnet group"
  default     = []   # Empty in dev (LocalStack)
}

variable "app_security_group_id" {
  type        = string
  description = "Security group ID of the application (EKS nodes or pods)"
  default     = ""
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "db_storage_gb" {
  type    = number
  default = 20
}

variable "db_password" {
  type        = string
  sensitive   = true
  description = "RDS master password — inject via TF_VAR_db_password env var or AWS Secrets Manager"
}

variable "enable_multi_az" {
  type    = bool
  default = false
}

variable "common_tags" {
  type = map(string)
  default = {
    Project   = "order-platform"
    ManagedBy = "terraform"
  }
}
