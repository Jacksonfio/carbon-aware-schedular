"""
scheduler.py
Decision engine for the carbon-aware deployment scheduler.
Evaluates a CarbonReading and deployment metadata to produce a
SchedulerDecision: DEPLOY_NOW, HOLD, or OVERRIDE.
"""

import os
import json
import logging
from dataclasses import dataclass, field, asdict
from enum import Enum
from datetime import datetime, timezone
from typing import Optional

from fetcher.carbon_fetcher import CarbonFetcher, CarbonReading

# Try to import config, fall back to env vars if not available
try:
    from config import Config
except ImportError:
    Config = None

logger = logging.getLogger(__name__)


class Decision(str, Enum):
    DEPLOY_NOW = "DEPLOY_NOW"
    HOLD       = "HOLD"
    OVERRIDE   = "OVERRIDE"


@dataclass
class DeploymentContext:
    """Metadata about the deployment being evaluated."""
    repo: str
    workflow: str
    run_id: str
    aws_region: str
    urgency: bool = False
    branch: str = "main"
    triggered_by: str = "push"
    job_type: str = "deploy"         # deploy | release | rollback | smoke-test


@dataclass
class SchedulerDecision:
    decision: Decision
    carbon_intensity: float
    threshold: float
    zone: str
    aws_region: str
    renewable_percentage: float
    fossil_fuel_percentage: float
    reason: str
    timestamp: str
    estimated_co2_kg: float          # estimated CO2 for this deploy job
    context: dict = field(default_factory=dict)

    def to_json(self) -> str:
        d = asdict(self)
        d["decision"] = self.decision.value
        return json.dumps(d, indent=2)

    def to_github_summary(self) -> str:
        icon = {"DEPLOY_NOW": "✅", "HOLD": "⏳", "OVERRIDE": "🚨"}[self.decision.value]
        lines = [
            f"## {icon} Carbon Gate — {self.decision.value}",
            "",
            f"| Metric | Value |",
            f"|--------|-------|",
            f"| Carbon intensity | **{self.carbon_intensity:.0f} gCO₂/kWh** |",
            f"| Threshold | {self.threshold:.0f} gCO₂/kWh |",
            f"| Renewables | {self.renewable_percentage:.1f}% |",
            f"| Fossil fuels | {self.fossil_fuel_percentage:.1f}% |",
            f"| Grid zone | {self.zone} |",
            f"| Est. CO₂ this deploy | {self.estimated_co2_kg:.3f} kg |",
            "",
            f"**Reason:** {self.reason}",
        ]
        return "\n".join(lines)


class CarbonScheduler:
    """
    Evaluates a deployment against real-time carbon data and returns a decision.

    Thresholds (gCO₂/kWh):
      < green_threshold   → DEPLOY_NOW  (very green grid)
      < hold_threshold    → DEPLOY_NOW  (acceptable)
      >= hold_threshold   → HOLD        (queue it)
      urgency = True      → OVERRIDE    (regardless of carbon score)

    AWS Lambda jobs are assumed to consume ~0.0003 kWh per deployment.
    ECS/EC2 deploys assumed ~0.002 kWh.
    """

    # Estimated energy per deploy job type (kWh)
    ENERGY_PER_DEPLOY: dict[str, float] = {
        "deploy":      0.002,
        "release":     0.003,
        "rollback":    0.001,
        "smoke-test":  0.0005,
    }

    def __init__(
        self,
        hold_threshold: Optional[float] = None,
        green_threshold: Optional[float] = None,
        fetcher: Optional[CarbonFetcher] = None,
        config: Optional["Config"] = None,
    ):
        """
        Initialize the scheduler.
        
        Args:
            hold_threshold: Carbon intensity threshold for holding (gCO₂/kWh).
                           Uses config or env CARBON_THRESHOLD if not provided.
            green_threshold: Carbon intensity threshold for "very green" status.
                            Uses config or default 150.0 if not provided.
            fetcher: Custom CarbonFetcher instance. Creates new one if not provided.
            config: Configuration object. Loads from env if not provided.
        """
        # Load config
        if config:
            self.config = config
        elif Config:
            self.config = Config.from_env()
            self.config.validate()
        else:
            self.config = None
        
        # Set thresholds
        if hold_threshold is not None:
            self.hold_threshold = float(hold_threshold)
        elif self.config:
            self.hold_threshold = self.config.carbon_hold_threshold
        else:
            self.hold_threshold = float(os.environ.get("CARBON_THRESHOLD", 250.0))
        
        if green_threshold is not None:
            self.green_threshold = float(green_threshold)
        elif self.config:
            self.green_threshold = self.config.carbon_green_threshold
        else:
            self.green_threshold = 150.0
        
        # Create or use provided fetcher
        if fetcher:
            self.fetcher = fetcher
        elif self.config:
            self.fetcher = CarbonFetcher(config=self.config)
        else:
            self.fetcher = CarbonFetcher()
        
        logger.info(
            f"CarbonScheduler initialized: "
            f"hold_threshold={self.hold_threshold:.0f} gCO₂/kWh, "
            f"green_threshold={self.green_threshold:.0f} gCO₂/kWh"
        )

    def _estimate_co2(self, carbon_intensity: float, job_type: str) -> float:
        """Estimate CO₂ in kg for this deployment."""
        energy_kwh = self.ENERGY_PER_DEPLOY.get(job_type, 0.002)
        return (carbon_intensity * energy_kwh) / 1000  # gCO₂ → kg

    def evaluate(self, context: DeploymentContext) -> SchedulerDecision:
        """
        Core decision method. Fetches live carbon data and returns a decision.
        """
        logger.info(
            f"Evaluating deployment: repo={context.repo} "
            f"region={context.aws_region} urgency={context.urgency}"
        )

        reading: CarbonReading = self.fetcher.fetch(context.aws_region)
        ci = reading.carbon_intensity
        estimated_co2 = self._estimate_co2(ci, context.job_type)

        # Urgency override — always deploys, regardless of carbon
        if context.urgency:
            return SchedulerDecision(
                decision=Decision.OVERRIDE,
                carbon_intensity=ci,
                threshold=self.hold_threshold,
                zone=reading.zone,
                aws_region=context.aws_region,
                renewable_percentage=reading.renewable_percentage,
                fossil_fuel_percentage=reading.fossil_fuel_percentage,
                reason=(
                    f"Urgency flag is set. Bypassing carbon check "
                    f"(current: {ci:.0f} gCO₂/kWh)."
                ),
                timestamp=datetime.now(timezone.utc).isoformat(),
                estimated_co2_kg=estimated_co2,
                context={"repo": context.repo, "run_id": context.run_id},
            )

        # Rollbacks always deploy — never hold a rollback
        if context.job_type == "rollback":
            return SchedulerDecision(
                decision=Decision.DEPLOY_NOW,
                carbon_intensity=ci,
                threshold=self.hold_threshold,
                zone=reading.zone,
                aws_region=context.aws_region,
                renewable_percentage=reading.renewable_percentage,
                fossil_fuel_percentage=reading.fossil_fuel_percentage,
                reason="Rollback jobs are never held by the carbon gate.",
                timestamp=datetime.now(timezone.utc).isoformat(),
                estimated_co2_kg=estimated_co2,
                context={"repo": context.repo, "run_id": context.run_id},
            )

        # Green grid — deploy immediately
        if ci < self.hold_threshold:
            quality = "very green" if ci < self.green_threshold else "acceptable"
            return SchedulerDecision(
                decision=Decision.DEPLOY_NOW,
                carbon_intensity=ci,
                threshold=self.hold_threshold,
                zone=reading.zone,
                aws_region=context.aws_region,
                renewable_percentage=reading.renewable_percentage,
                fossil_fuel_percentage=reading.fossil_fuel_percentage,
                reason=(
                    f"Grid is {quality} at {ci:.0f} gCO₂/kWh "
                    f"(threshold: {self.hold_threshold:.0f}). Deploying now."
                ),
                timestamp=datetime.now(timezone.utc).isoformat(),
                estimated_co2_kg=estimated_co2,
                context={"repo": context.repo, "run_id": context.run_id},
            )

        # High carbon — hold
        return SchedulerDecision(
            decision=Decision.HOLD,
            carbon_intensity=ci,
            threshold=self.hold_threshold,
            zone=reading.zone,
            aws_region=context.aws_region,
            renewable_percentage=reading.renewable_percentage,
            fossil_fuel_percentage=reading.fossil_fuel_percentage,
            reason=(
                f"Grid carbon intensity is {ci:.0f} gCO₂/kWh, "
                f"above threshold of {self.hold_threshold:.0f}. "
                f"Job queued — will re-check every 30 minutes."
            ),
            timestamp=datetime.now(timezone.utc).isoformat(),
            estimated_co2_kg=estimated_co2,
            context={"repo": context.repo, "run_id": context.run_id},
        )

    def evaluate_from_env(self) -> SchedulerDecision:
        """
        Convenience method: builds DeploymentContext from environment variables.
        Used directly inside GitHub Actions.
        """
        context = DeploymentContext(
            repo=os.environ.get("GITHUB_REPOSITORY", "unknown/repo"),
            workflow=os.environ.get("GITHUB_WORKFLOW", "unknown"),
            run_id=os.environ.get("GITHUB_RUN_ID", "0"),
            aws_region=os.environ.get("AWS_REGION", "us-east-1"),
            urgency=os.environ.get("URGENCY_OVERRIDE", "false").lower() == "true",
            branch=os.environ.get("GITHUB_REF_NAME", "main"),
            triggered_by=os.environ.get("GITHUB_EVENT_NAME", "push"),
            job_type=os.environ.get("JOB_TYPE", "deploy"),
        )
        return self.evaluate(context)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    scheduler = CarbonScheduler()
    decision = scheduler.evaluate_from_env()
    print(decision.to_json())
    print("\n--- GitHub Summary ---")
    print(decision.to_github_summary())
