"""
tests/test_scheduler.py
Unit tests for the carbon-aware scheduler decision engine.
Uses unittest.mock to avoid real API calls.
"""

import json
import pytest
from unittest.mock import MagicMock, patch

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from fetcher.carbon_fetcher import CarbonReading
from scheduler.scheduler import CarbonScheduler, DeploymentContext, Decision


# ─────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────

def make_reading(carbon_intensity: float, renewable_pct: float = 60.0) -> CarbonReading:
    return CarbonReading(
        zone="US-MIDA-PJM",
        aws_region="us-east-1",
        carbon_intensity=carbon_intensity,
        fossil_fuel_percentage=100 - renewable_pct,
        renewable_percentage=renewable_pct,
        timestamp="2024-06-01T12:00:00Z",
    )


def make_context(**kwargs) -> DeploymentContext:
    defaults = dict(
        repo="myorg/myrepo",
        workflow="deploy",
        run_id="12345",
        aws_region="us-east-1",
        urgency=False,
        job_type="deploy",
    )
    defaults.update(kwargs)
    return DeploymentContext(**defaults)


def make_scheduler(mock_intensity: float) -> CarbonScheduler:
    mock_fetcher = MagicMock()
    mock_fetcher.fetch.return_value = make_reading(mock_intensity)
    return CarbonScheduler(hold_threshold=250.0, green_threshold=150.0, fetcher=mock_fetcher)


# ─────────────────────────────────────────────
# Tests — Decision logic
# ─────────────────────────────────────────────

class TestDeployNow:
    def test_very_green_grid_deploys(self):
        scheduler = make_scheduler(100.0)
        decision = scheduler.evaluate(make_context())
        assert decision.decision == Decision.DEPLOY_NOW

    def test_acceptable_grid_deploys(self):
        scheduler = make_scheduler(200.0)
        decision = scheduler.evaluate(make_context())
        assert decision.decision == Decision.DEPLOY_NOW

    def test_just_below_threshold_deploys(self):
        scheduler = make_scheduler(249.9)
        decision = scheduler.evaluate(make_context())
        assert decision.decision == Decision.DEPLOY_NOW

    def test_reason_contains_intensity(self):
        scheduler = make_scheduler(120.0)
        decision = scheduler.evaluate(make_context())
        assert "120" in decision.reason or "very green" in decision.reason.lower()


class TestHold:
    def test_above_threshold_holds(self):
        scheduler = make_scheduler(300.0)
        decision = scheduler.evaluate(make_context())
        assert decision.decision == Decision.HOLD

    def test_very_high_carbon_holds(self):
        scheduler = make_scheduler(600.0)
        decision = scheduler.evaluate(make_context())
        assert decision.decision == Decision.HOLD

    def test_hold_reason_mentions_recheck(self):
        scheduler = make_scheduler(350.0)
        decision = scheduler.evaluate(make_context())
        assert "30 minutes" in decision.reason or "re-check" in decision.reason.lower()


class TestOverride:
    def test_urgency_overrides_high_carbon(self):
        scheduler = make_scheduler(500.0)
        decision = scheduler.evaluate(make_context(urgency=True))
        assert decision.decision == Decision.OVERRIDE

    def test_urgency_overrides_low_carbon_too(self):
        scheduler = make_scheduler(50.0)
        decision = scheduler.evaluate(make_context(urgency=True))
        assert decision.decision == Decision.OVERRIDE

    def test_rollback_never_held(self):
        scheduler = make_scheduler(999.0)
        decision = scheduler.evaluate(make_context(job_type="rollback"))
        assert decision.decision == Decision.DEPLOY_NOW

    def test_rollback_reason(self):
        scheduler = make_scheduler(999.0)
        decision = scheduler.evaluate(make_context(job_type="rollback"))
        assert "rollback" in decision.reason.lower()


# ─────────────────────────────────────────────
# Tests — CO₂ estimation
# ─────────────────────────────────────────────

class TestCO2Estimation:
    def test_co2_is_positive(self):
        scheduler = make_scheduler(200.0)
        decision = scheduler.evaluate(make_context())
        assert decision.estimated_co2_kg > 0

    def test_higher_carbon_means_higher_co2(self):
        s1 = make_scheduler(100.0)
        s2 = make_scheduler(400.0)
        d1 = s1.evaluate(make_context())
        d2 = s2.evaluate(make_context())
        assert d2.estimated_co2_kg > d1.estimated_co2_kg

    def test_smoke_test_uses_less_energy_than_deploy(self):
        s1 = make_scheduler(200.0)
        s2 = make_scheduler(200.0)
        smoke = s1.evaluate(make_context(job_type="smoke-test"))
        deploy = s2.evaluate(make_context(job_type="deploy"))
        assert smoke.estimated_co2_kg < deploy.estimated_co2_kg


# ─────────────────────────────────────────────
# Tests — Output format
# ─────────────────────────────────────────────

class TestOutputFormat:
    def test_to_json_is_valid(self):
        scheduler = make_scheduler(200.0)
        decision = scheduler.evaluate(make_context())
        parsed = json.loads(decision.to_json())
        assert "decision" in parsed
        assert "carbon_intensity" in parsed

    def test_github_summary_contains_decision(self):
        scheduler = make_scheduler(200.0)
        decision = scheduler.evaluate(make_context())
        summary = decision.to_github_summary()
        assert "DEPLOY_NOW" in summary

    def test_github_summary_contains_intensity(self):
        scheduler = make_scheduler(175.0)
        decision = scheduler.evaluate(make_context())
        summary = decision.to_github_summary()
        assert "175" in summary

    def test_decision_has_timestamp(self):
        scheduler = make_scheduler(200.0)
        decision = scheduler.evaluate(make_context())
        assert decision.timestamp is not None
        assert "T" in decision.timestamp  # ISO format

    def test_decision_has_zone(self):
        scheduler = make_scheduler(200.0)
        decision = scheduler.evaluate(make_context())
        assert decision.zone == "US-MIDA-PJM"
