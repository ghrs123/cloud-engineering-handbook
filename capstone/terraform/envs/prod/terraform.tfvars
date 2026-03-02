# envs/prod/terraform.tfvars
# Production environment — real AWS resources
# db_password must be injected via:
#   export TF_VAR_db_password=$(aws secretsmanager get-secret-value ...)
# Never hardcode here.

environment     = "prod"
aws_region      = "us-east-1"
is_localstack   = false
enable_multi_az = true
db_instance_class = "db.t3.small"
db_storage_gb   = 50

# Set these from your actual VPC:
# vpc_id                = "vpc-0123456789abcdef"
# private_subnet_ids    = ["subnet-aaa", "subnet-bbb"]
# app_security_group_id = "sg-0123456789abcdef"
