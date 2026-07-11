"""
config.py
Centralized configuration management for the carbon-aware scheduler.
Loads and validates environment variables with sensible defaults.
"""

import os
import logging
from dataclasses import dataclass
from typing import Optional


@dataclass
class Config:
    """Application configuration loaded from environment variables."""
    
    # Electricity Maps API
    electricity_maps_token: str
    electricity_maps_timeout: int = 10
    electricity_maps_retries: int = 3
    
    # Carbon Thresholds (gCO2/kWh)
    carbon_hold_threshold: float = 250.0
    carbon_green_threshold: float = 150.0
    
    # AWS
    aws_region: str = "us-east-1"
    sqs_queue_url: Optional[str] = None
    s3_carbon_bucket: Optional[str] = None
    
    # Caching
    carbon_cache_ttl_seconds: int = 300  # 5 minutes
    enable_carbon_cache: bool = True
    
    # Logging
    log_level: str = "INFO"
    
    # Feature Flags
    enable_mock_data: bool = False
    
    @classmethod
    def from_env(cls) -> "Config":
        """Load configuration from environment variables."""
        token = os.environ.get("ELECTRICITY_MAPS_TOKEN", "").strip()
        if not token:
            raise ValueError(
                "ELECTRICITY_MAPS_TOKEN not set. "
                "Get a free token at https://www.electricitymaps.com/ "
                "or set ELECTRICITY_MAPS_TOKEN=mock for simulated data."
            )
        
        return cls(
            electricity_maps_token=token,
            electricity_maps_timeout=int(
                os.environ.get("ELECTRICITY_MAPS_TIMEOUT", "10")
            ),
            electricity_maps_retries=int(
                os.environ.get("ELECTRICITY_MAPS_RETRIES", "3")
            ),
            carbon_hold_threshold=float(
                os.environ.get("CARBON_THRESHOLD", "250.0")
            ),
            carbon_green_threshold=float(
                os.environ.get("CARBON_GREEN_THRESHOLD", "150.0")
            ),
            aws_region=os.environ.get("AWS_REGION", "us-east-1"),
            sqs_queue_url=os.environ.get("SQS_QUEUE_URL"),
            s3_carbon_bucket=os.environ.get("S3_CARBON_BUCKET"),
            carbon_cache_ttl_seconds=int(
                os.environ.get("CARBON_CACHE_TTL_SECONDS", "300")
            ),
            enable_carbon_cache=os.environ.get(
                "ENABLE_CARBON_CACHE", "true"
            ).lower() in ("true", "1", "yes"),
            log_level=os.environ.get("LOG_LEVEL", "INFO"),
            enable_mock_data=token.lower() == "mock",
        )
    
    def validate(self) -> None:
        """Validate configuration values."""
        if self.carbon_hold_threshold <= 0:
            raise ValueError("carbon_hold_threshold must be > 0")
        if self.carbon_green_threshold <= 0:
            raise ValueError("carbon_green_threshold must be > 0")
        if self.carbon_green_threshold > self.carbon_hold_threshold:
            raise ValueError(
                "carbon_green_threshold must be <= carbon_hold_threshold"
            )
        if self.electricity_maps_timeout <= 0:
            raise ValueError("electricity_maps_timeout must be > 0")
        if self.electricity_maps_retries < 0:
            raise ValueError("electricity_maps_retries must be >= 0")
