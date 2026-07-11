terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    # Fill in your state bucket
    bucket = "my-terraform-state"
    key    = "carbon-scheduler/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# ──────────────────────────────────────────────
# Variables
# ──────────────────────────────────────────────
variable "aws_region" {
  default = "us-east-1"
}

variable "project_name" {
  default = "carbon-aware-scheduler"
}

variable "carbon_threshold" {
  default = "250"
}

variable "electricity_maps_token" {
  sensitive = true
}

variable "github_token" {
  sensitive = true
}

# ──────────────────────────────────────────────
# S3 — Carbon logs + Dashboard hosting
# ──────────────────────────────────────────────
resource "aws_s3_bucket" "carbon_logs" {
  bucket = "${var.project_name}-carbon-logs-${data.aws_caller_identity.current.account_id}"
  tags   = local.tags
}

resource "aws_s3_bucket_versioning" "carbon_logs" {
  bucket = aws_s3_bucket.carbon_logs.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket" "dashboard" {
  bucket = "${var.project_name}-dashboard-${data.aws_caller_identity.current.account_id}"
  tags   = local.tags
}

resource "aws_s3_bucket_website_configuration" "dashboard" {
  bucket = aws_s3_bucket.dashboard.id
  index_document { suffix = "index.html" }
  error_document { key    = "index.html" }
}

resource "aws_s3_bucket_public_access_block" "dashboard" {
  bucket                  = aws_s3_bucket.dashboard.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "dashboard" {
  bucket = aws_s3_bucket.dashboard.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicRead"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.dashboard.arn}/*"
    }]
  })
}

# ──────────────────────────────────────────────
# SQS — Held deployments queue
# ──────────────────────────────────────────────
resource "aws_sqs_queue" "held_deployments_dlq" {
  name                      = "${var.project_name}-held-dlq"
  message_retention_seconds = 86400  # 1 day
  tags                      = local.tags
}

resource "aws_sqs_queue" "held_deployments" {
  name                       = "${var.project_name}-held-deployments"
  visibility_timeout_seconds = 1800   # 30 min — matches poll interval
  message_retention_seconds  = 86400  # 24 hrs max hold
  receive_wait_time_seconds  = 5      # long polling

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.held_deployments_dlq.arn
    maxReceiveCount     = 50
  })

  tags = local.tags
}

# ──────────────────────────────────────────────
# IAM — Lambda execution role
# ──────────────────────────────────────────────
resource "aws_iam_role" "lambda_poller" {
  name = "${var.project_name}-lambda-poller"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "lambda_poller" {
  name = "${var.project_name}-lambda-policy"
  role = aws_iam_role.lambda_poller.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage", "sqs:DeleteMessage",
          "sqs:SendMessage",    "sqs:ChangeMessageVisibility",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.held_deployments.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.carbon_logs.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ──────────────────────────────────────────────
# Secrets Manager — sensitive env vars
# ──────────────────────────────────────────────
resource "aws_secretsmanager_secret" "electricity_maps_token" {
  name = "${var.project_name}/electricity-maps-token"
  tags = local.tags
}

resource "aws_secretsmanager_secret_version" "electricity_maps_token" {
  secret_id     = aws_secretsmanager_secret.electricity_maps_token.id
  secret_string = var.electricity_maps_token
}

# ──────────────────────────────────────────────
# Lambda — Poller function
# ──────────────────────────────────────────────
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../../src"
  output_path = "${path.module}/lambda_poller.zip"
}

resource "aws_lambda_function" "poller" {
  function_name    = "${var.project_name}-poller"
  role             = aws_iam_role.lambda_poller.arn
  handler          = "deploy_queue.lambda_poller.handler"
  runtime          = "python3.11"
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  timeout          = 300
  memory_size      = 256

  environment {
    variables = {
      SQS_QUEUE_URL          = aws_sqs_queue.held_deployments.url
      S3_CARBON_BUCKET       = aws_s3_bucket.carbon_logs.bucket
      CARBON_THRESHOLD       = var.carbon_threshold
      AWS_REGION_TARGET      = var.aws_region
      ELECTRICITY_MAPS_TOKEN = var.electricity_maps_token
      GITHUB_TOKEN           = var.github_token
      MAX_RETRIES            = "48"
    }
  }

  tags = local.tags
}

# ──────────────────────────────────────────────
# EventBridge — Trigger Lambda every 30 minutes
# ──────────────────────────────────────────────
resource "aws_cloudwatch_event_rule" "every_30_min" {
  name                = "${var.project_name}-poll-schedule"
  description         = "Triggers carbon-aware poller every 30 minutes"
  schedule_expression = "rate(30 minutes)"
  tags                = local.tags
}

resource "aws_cloudwatch_event_target" "lambda" {
  rule      = aws_cloudwatch_event_rule.every_30_min.name
  target_id = "carbon-poller"
  arn       = aws_lambda_function.poller.arn
}

resource "aws_lambda_permission" "eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.poller.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.every_30_min.arn
}

# ──────────────────────────────────────────────
# CloudWatch — Dashboard for Lambda metrics
# ──────────────────────────────────────────────
resource "aws_cloudwatch_dashboard" "carbon" {
  dashboard_name = "${var.project_name}-metrics"
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          title  = "Poller invocations"
          metrics = [["AWS/Lambda", "Invocations", "FunctionName", aws_lambda_function.poller.function_name]]
          period = 1800
          stat   = "Sum"
        }
      },
      {
        type = "metric"
        properties = {
          title  = "SQS queue depth"
          metrics = [["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.held_deployments.name]]
          period = 300
          stat   = "Average"
        }
      }
    ]
  })
}

# ──────────────────────────────────────────────
# Locals + data
# ──────────────────────────────────────────────
data "aws_caller_identity" "current" {}

locals {
  tags = {
    Project   = var.project_name
    ManagedBy = "terraform"
  }
}

# ──────────────────────────────────────────────
# Outputs
# ──────────────────────────────────────────────
output "sqs_queue_url" {
  value = aws_sqs_queue.held_deployments.url
}

output "s3_carbon_bucket" {
  value = aws_s3_bucket.carbon_logs.bucket
}

output "dashboard_url" {
  value = "http://${aws_s3_bucket.dashboard.bucket}.s3-website-${var.aws_region}.amazonaws.com"
}

output "lambda_function_name" {
  value = aws_lambda_function.poller.function_name
}
