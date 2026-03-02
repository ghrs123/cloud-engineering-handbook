#!/bin/bash
# localstack-init.sh
# This script runs automatically when LocalStack is ready.
# It creates the SQS queues needed for local development.

set -e

echo "=== Creating SQS queues in LocalStack ==="

AWS_CMD="aws --endpoint-url=http://localhost:4566 --region us-east-1"

# Create Dead Letter Queue first (referenced by main queue)
echo "Creating DLQ: order-created-dlq"
$AWS_CMD sqs create-queue \
  --queue-name order-created-dlq \
  --attributes '{
    "MessageRetentionPeriod": "1209600"
  }'

# Get DLQ ARN
DLQ_ARN=$($AWS_CMD sqs get-queue-attributes \
  --queue-url http://localstack:4566/000000000000/order-created-dlq \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

echo "DLQ ARN: $DLQ_ARN"

# Create main queue with DLQ redrive policy
echo "Creating main queue: order-created-queue"
$AWS_CMD sqs create-queue \
  --queue-name order-created-queue \
  --attributes "{
    \"VisibilityTimeout\": \"30\",
    \"MessageRetentionPeriod\": \"86400\",
    \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"
  }"

echo "=== SQS queues created successfully ==="
echo "Main queue: http://localhost:4566/000000000000/order-created-queue"
echo "DLQ:        http://localhost:4566/000000000000/order-created-dlq"

# List queues to confirm
echo ""
echo "=== All queues ==="
$AWS_CMD sqs list-queues
