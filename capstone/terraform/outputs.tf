output "order_queue_url" {
  description = "SQS URL for order-created-queue (use in application config)"
  value       = aws_sqs_queue.order_queue.url
}

output "order_queue_arn" {
  description = "SQS ARN for order-created-queue"
  value       = aws_sqs_queue.order_queue.arn
}

output "order_dlq_url" {
  description = "SQS URL for Dead Letter Queue"
  value       = aws_sqs_queue.order_dlq.url
}

output "db_endpoint" {
  description = "RDS endpoint (host:port) — use in SPRING_DATASOURCE_URL"
  value       = aws_db_instance.order_postgres.endpoint
}

output "db_name" {
  description = "RDS database name"
  value       = aws_db_instance.order_postgres.db_name
}

output "app_iam_policy_arn" {
  description = "IAM Policy ARN to attach to IRSA role for K8s service accounts"
  value       = aws_iam_policy.order_app.arn
}
