"""
lambda_poller.py
AWS Lambda function that polls the SQS queue every 30 minutes,
re-evaluates carbon intensity, and re-triggers GitHub Actions workflows
when the grid is green enough.
"""

import os
import json
import boto3
import logging
import urllib.request
import urllib.error
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def get_carbon_intensity(aws_region: str, token: str) -> float:
    """Re-fetch carbon intensity inline (no external deps in Lambda)."""
    from fetcher.carbon_fetcher import CarbonFetcher
    fetcher = CarbonFetcher(api_token=token)
    reading = fetcher.fetch(aws_region)
    return reading.carbon_intensity


def trigger_workflow_rerun(repo: str, run_id: str, github_token: str) -> bool:
    """Trigger a GitHub Actions workflow re-run via the API."""
    url = f"https://api.github.com/repos/{repo}/actions/runs/{run_id}/rerun"
    headers = {
        "Authorization": f"Bearer {github_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "carbon-aware-scheduler/1.0"
    }
    try:
        # Note: Github re-run endpoint requires a POST request but takes empty body.
        req = urllib.request.Request(url, data=b"", headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status == 201:
                logger.info(f"Re-triggered workflow run {run_id} for {repo}")
                return True
            else:
                logger.error(f"Failed to re-trigger: {response.status}")
                return False
    except urllib.error.HTTPError as e:
        logger.error(f"Failed to re-trigger: HTTPError {e.code} - {e.read().decode('utf-8', errors='ignore')}")
        return False
    except Exception as e:
        logger.error(f"Failed to re-trigger: {e}")
        return False


def log_final_record(record: dict, held_minutes: int, deployed: bool) -> None:
    """Write final carbon log to S3."""
    now = datetime.now(timezone.utc)
    record["held_minutes"] = held_minutes
    record["deployed"] = deployed
    record["resolved_at"] = now.isoformat()
    key = (
        f"carbon-logs/{now.year}/{now.month:02d}/{now.day:02d}/"
        f"{record.get('context', {}).get('run_id', 'unknown')}-resolved.json"
    )
    s3_bucket = os.environ.get("S3_CARBON_BUCKET", "")
    s3 = boto3.client("s3")
    s3.put_object(
        Bucket=s3_bucket,
        Key=key,
        Body=json.dumps(record, indent=2),
        ContentType="application/json",
    )


def handler(event, context):
    """
    Lambda handler — triggered by EventBridge every 30 minutes.
    Processes all messages in the SQS queue.
    """
    queue_url = os.environ.get("SQS_QUEUE_URL", "")
    github_token = os.environ.get("GITHUB_TOKEN", "")
    max_retries = int(os.environ.get("MAX_RETRIES", "48"))   # 48 × 30 min = 24 hrs
    carbon_threshold = float(os.environ.get("CARBON_THRESHOLD", "250"))
    electricity_maps_token = os.environ.get("ELECTRICITY_MAPS_TOKEN", "")

    sqs = boto3.client("sqs")
    processed = 0
    deployed = 0
    requeued = 0

    while True:
        response = sqs.receive_message(
            QueueUrl=queue_url,
            MaxNumberOfMessages=10,
            WaitTimeSeconds=5,
            MessageAttributeNames=["All"],
        )
        messages = response.get("Messages", [])
        if not messages:
            break

        for msg in messages:
            body = json.loads(msg["Body"])
            receipt = msg["ReceiptHandle"]
            processed += 1

            ctx = body.get("context", {})
            aws_region = ctx.get("aws_region", "us-east-1")
            repo = ctx.get("repo", "")
            run_id = str(ctx.get("run_id", ""))
            retry_count = body.get("retry_count", 0)
            queued_at = datetime.fromisoformat(body["queued_at"])
            held_min = int((datetime.now(timezone.utc) - queued_at).total_seconds() / 60)

            # Max retries exceeded — force deploy (don't block forever)
            if retry_count >= max_retries:
                logger.warning(
                    f"Max retries ({max_retries}) exceeded for run {run_id}. "
                    f"Force-deploying."
                )
                trigger_workflow_rerun(repo, run_id, github_token)
                log_final_record(body, held_min, deployed=True)
                sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt)
                deployed += 1
                continue

            # Re-check carbon intensity
            try:
                ci = get_carbon_intensity(aws_region, electricity_maps_token)
            except Exception as e:
                logger.error(f"Failed to fetch carbon for {aws_region}: {e}")
                sqs.change_message_visibility(
                    QueueUrl=queue_url,
                    ReceiptHandle=receipt,
                    VisibilityTimeout=1800,   # re-try in 30 min
                )
                continue

            if ci < carbon_threshold:
                # Grid is green — deploy!
                logger.info(
                    f"Grid green ({ci:.0f} gCO₂/kWh < {carbon_threshold}) "
                    f"for {aws_region}. Re-triggering {repo} run {run_id}."
                )
                success = trigger_workflow_rerun(repo, run_id, github_token)
                log_final_record(body, held_min, deployed=success)
                sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt)
                deployed += 1
            else:
                # Still too high — requeue with incremented retry count
                logger.info(
                    f"Still high ({ci:.0f} gCO₂/kWh) for {aws_region}. "
                    f"Re-queuing (retry {retry_count + 1}/{max_retries})."
                )
                body["retry_count"] = retry_count + 1
                sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(body))
                sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt)
                requeued += 1

    logger.info(
        f"Poll complete. Processed={processed}, Deployed={deployed}, Requeued={requeued}"
    )
    return {"processed": processed, "deployed": deployed, "requeued": requeued}

