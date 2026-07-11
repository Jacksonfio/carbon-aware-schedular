"""
run_live_demo.py
Demonstrates the carbon-aware scheduler running with live simulated data.
Run with: set ELECTRICITY_MAPS_TOKEN=mock && python scripts/run_live_demo.py
"""

import sys
import os
import json

# Allow imports from src/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from fetcher.carbon_fetcher import CarbonFetcher
from scheduler.scheduler import CarbonScheduler, DeploymentContext

REGIONS = [
    "us-east-1",
    "us-east-2",
    "us-west-1",
    "us-west-2",
    "eu-west-1",
    "eu-west-2",
    "eu-central-1",
    "eu-north-1",
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-south-1",
    "ap-northeast-1",
    "ca-central-1",
    "sa-east-1",
]

DECISION_ICON = {
    "DEPLOY_NOW": "OK  ",
    "HOLD":       "HOLD",
    "OVERRIDE":   "WARN",
}

def main():
    token = os.environ.get("ELECTRICITY_MAPS_TOKEN", "mock")
    fetcher = CarbonFetcher(api_token=token)
    scheduler = CarbonScheduler(hold_threshold=250.0, green_threshold=150.0, fetcher=fetcher)

    print("=" * 72)
    print("  Carbon-Aware Scheduler — Live Demo  (token={})".format(token))
    print("=" * 72)
    print("{:<22} {:>10}  {:>12}  {:>8}  {}".format(
        "Region", "gCO2/kWh", "Renewables%", "Decision", "Reason"))
    print("-" * 72)

    results = []
    total_co2 = 0.0
    deployed = held = 0

    for region in REGIONS:
        ctx = DeploymentContext(
            repo="myorg/carbon-demo",
            workflow="deploy.yml",
            run_id="live-001",
            aws_region=region,
            urgency=False,
            job_type="deploy",
        )
        decision = scheduler.evaluate(ctx)
        icon = DECISION_ICON.get(decision.decision.value, "    ")
        print("[{}] {:<20} {:>8.1f}   {:>10.1f}%   {:>10}   {}".format(
            icon,
            region,
            decision.carbon_intensity,
            decision.renewable_percentage,
            decision.decision.value,
            decision.reason[:55] + "..." if len(decision.reason) > 55 else decision.reason,
        ))
        total_co2 += decision.estimated_co2_kg
        if decision.decision.value in ("DEPLOY_NOW", "OVERRIDE"):
            deployed += 1
        else:
            held += 1

        results.append({
            "timestamp": decision.timestamp,
            "aws_region": region,
            "zone": decision.zone,
            "carbon_intensity": decision.carbon_intensity,
            "renewable_percentage": decision.renewable_percentage,
            "fossil_fuel_percentage": decision.fossil_fuel_percentage,
            "decision": decision.decision.value,
            "estimated_co2_kg": decision.estimated_co2_kg,
            "held_minutes": 0,
            "reason": decision.reason,
        })

    print("=" * 72)
    print("  Summary: {} regions evaluated".format(len(REGIONS)))
    print("  Deploy Now : {}".format(deployed))
    print("  Hold       : {}".format(held))
    print("  Total est. CO2 this batch : {:.4f} kg".format(total_co2))
    print("=" * 72)

    # Write live results to dashboard sample-data.json so the UI shows live data
    out_path = os.path.join(
        os.path.dirname(__file__), '..', 'src', 'dashboard', 'public', 'sample-data.json'
    )
    with open(out_path, 'w') as f:
        json.dump(results, f, indent=2)
    print("\n  Dashboard data written -> src/dashboard/public/sample-data.json")
    print("  Start the dashboard with:  cd src/dashboard && npm start")
    print()

if __name__ == "__main__":
    main()
