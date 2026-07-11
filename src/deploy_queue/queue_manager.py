"""
queue_manager.py
Pushes held deployment jobs to AWS SQS and logs carbon records to S3.
"""

import os
import json
import boto3
import logging
from datetime import datetime, timezone
from dataclasses import asdict

logger = logging.getLogger(__name__)


class QueueManager:
    def __init__(self):
        self.sqs = boto3.client("sqs", region_name=os.environ.get("AWS_REGION", "us-east-1"))
        self.s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
        self.queue_url = os.environ["SQS_QUEUE_URL"]
        self.s3_bucket = os.environ["S3_CARBON_BUCKET"]

    def enqueue_held_job(self, decision_dict: dict, context: dict) -> str:
        """Push a held deployment to SQS for later re-evaluation."""
        message = {
            "type": "held_deployment",
            "queued_at": datetime.now(timezone.utc).isoformat(),
            "decision": decision_dict,
            "context": context,
            "retry_count": 0,
        }
        response = self.sqs.send_message(
            QueueUrl=self.queue_url,
            MessageBody=json.dumps(message),
            MessageAttributes={
                "JobType": {
                    "StringValue": context.get("job_type", "deploy"),
                    "DataType": "String",
                }
            },
        )
        msg_id = response["MessageId"]
        logger.info(f"Enqueued held job: MessageId={msg_id}")
        return msg_id

    def log_carbon_record(self, decision_dict: dict, held_minutes: int = 0) -> str:
        """
        Writes a JSON carbon record to S3 for dashboard consumption.
        Key format: carbon-logs/YYYY/MM/DD/<run_id>.json
        """
        now = datetime.now(timezone.utc)
        record = {
            **decision_dict,
            "held_minutes": held_minutes,
            "logged_at": now.isoformat(),
        }
        key = (
            f"carbon-logs/{now.year}/{now.month:02d}/{now.day:02d}/"
            f"{decision_dict.get('context', {}).get('run_id', 'unknown')}.json"
        )
        self.s3.put_object(
            Bucket=self.s3_bucket,
            Key=key,
            Body=json.dumps(record, indent=2),
            ContentType="application/json",
        )
        logger.info(f"Carbon record written to s3://{self.s3_bucket}/{key}")
        return key
