# envs/dev/terraform.tfvars
# Development environment — uses LocalStack, no real AWS resources

environment         = "dev"
aws_region          = "us-east-1"
localstack_endpoint = "http://localhost:4566"
is_localstack       = true
enable_multi_az     = false
db_instance_class   = "db.t3.micro"
db_storage_gb       = 20
db_password         = "orderpass"    # Safe in dev/LocalStack; never commit real passwords
