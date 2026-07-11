"""
example_usage.py
Examples of using the improved carbon-aware scheduler with new features.
Run with: ELECTRICITY_MAPS_TOKEN=mock python example_usage.py
"""

import logging
from config import Config
from logging_config import setup_logging
from fetcher.carbon_fetcher import CarbonFetcher
from scheduler.scheduler import CarbonScheduler, DeploymentContext

# Setup logging
setup_logging("DEBUG")
logger = logging.getLogger(__name__)

def example_1_basic_config():
    """Example 1: Load and validate configuration"""
    logger.info("=" * 60)
    logger.info("Example 1: Configuration Management")
    logger.info("=" * 60)
    
    config = Config.from_env()
    config.validate()
    
    logger.info(f"Carbon hold threshold: {config.carbon_hold_threshold} gCO₂/kWh")
    logger.info(f"Cache enabled: {config.enable_carbon_cache}")
    logger.info(f"Cache TTL: {config.carbon_cache_ttl_seconds}s")
    logger.info(f"Log level: {config.log_level}")


def example_2_caching():
    """Example 2: Demonstrate caching behavior"""
    logger.info("\n" + "=" * 60)
    logger.info("Example 2: Caching Layer")
    logger.info("=" * 60)
    
    config = Config.from_env()
    fetcher = CarbonFetcher(config=config)
    
    # First fetch (cache miss)
    logger.info("First fetch (cache miss)...")
    reading1 = fetcher.fetch("us-east-1")
    logger.info(f"  → {reading1.carbon_intensity:.0f} gCO₂/kWh from {reading1.zone}")
    
    # Second fetch (cache hit)
    logger.info("Second fetch (cache hit)...")
    reading2 = fetcher.fetch("us-east-1")
    logger.info(f"  → {reading2.carbon_intensity:.0f} gCO₂/kWh (cached)")
    
    # Different region (cache miss)
    logger.info("Different region (cache miss)...")
    reading3 = fetcher.fetch("eu-west-1")
    logger.info(f"  → {reading3.carbon_intensity:.0f} gCO₂/kWh from {reading3.zone}")


def example_3_scheduler_decision():
    """Example 3: Make scheduling decisions"""
    logger.info("\n" + "=" * 60)
    logger.info("Example 3: Scheduler Decisions")
    logger.info("=" * 60)
    
    config = Config.from_env()
    scheduler = CarbonScheduler(config=config)
    
    # Create deployment context
    context = DeploymentContext(
        repo="myapp/repo",
        workflow="deploy.yml",
        run_id="run-12345",
        aws_region="us-east-1",
        urgency=False,
        branch="main",
        job_type="deploy",
    )
    
    # Get decision
    decision = scheduler.evaluate(context)
    
    logger.info(f"Decision: {decision.decision.value} 🚀")
    logger.info(f"  Carbon intensity: {decision.carbon_intensity:.0f} gCO₂/kWh")
    logger.info(f"  Threshold: {decision.threshold:.0f} gCO₂/kWh")
    logger.info(f"  Renewable: {decision.renewable_percentage:.1f}%")
    logger.info(f"  Est. CO₂: {decision.estimated_co2_kg:.3f} kg")
    logger.info(f"  Reason: {decision.reason}")
    
    # Show GitHub summary
    logger.info("\nGitHub Summary:")
    for line in decision.to_github_summary().split("\n"):
        logger.info(f"  {line}")


def example_4_error_handling():
    """Example 4: Error handling and retry logic"""
    logger.info("\n" + "=" * 60)
    logger.info("Example 4: Error Handling (with mock data)")
    logger.info("=" * 60)
    
    config = Config.from_env()
    fetcher = CarbonFetcher(config=config)
    
    try:
        # Try invalid region
        logger.info("Attempting to fetch data for invalid region...")
        fetcher.fetch("invalid-region-123")
    except ValueError as e:
        logger.info(f"✅ Caught expected error: {e}")
    
    # List supported regions
    logger.info("\nSupported AWS regions:")
    from fetcher.carbon_fetcher import REGION_ZONE_MAP
    for region in sorted(REGION_ZONE_MAP.keys()):
        logger.info(f"  • {region}")


def example_5_multiple_regions():
    """Example 5: Batch evaluate multiple regions"""
    logger.info("\n" + "=" * 60)
    logger.info("Example 5: Multi-Region Evaluation")
    logger.info("=" * 60)
    
    config = Config.from_env()
    scheduler = CarbonScheduler(config=config)
    
    regions = ["us-east-1", "us-west-2", "eu-west-1", "ap-northeast-1"]
    
    decisions = {}
    for region in regions:
        context = DeploymentContext(
            repo="myapp/repo",
            workflow="deploy.yml",
            run_id=f"run-region-{region}",
            aws_region=region,
            urgency=False,
        )
        decision = scheduler.evaluate(context)
        decisions[region] = decision
        logger.info(
            f"{region:15} → {decision.decision.value:12} "
            f"({decision.carbon_intensity:.0f} gCO₂/kWh)"
        )
    
    # Summary
    greenest_region = min(decisions, key=lambda r: decisions[r].carbon_intensity)
    dirtiest_region = max(decisions, key=lambda r: decisions[r].carbon_intensity)
    
    logger.info(f"\n🟢 Greenest:  {greenest_region} ({decisions[greenest_region].carbon_intensity:.0f} gCO₂/kWh)")
    logger.info(f"🔴 Dirtiest:  {dirtiest_region} ({decisions[dirtiest_region].carbon_intensity:.0f} gCO₂/kWh)")


if __name__ == "__main__":
    try:
        example_1_basic_config()
        example_2_caching()
        example_3_scheduler_decision()
        example_4_error_handling()
        example_5_multiple_regions()
        
        logger.info("\n" + "=" * 60)
        logger.info("✅ All examples completed successfully!")
        logger.info("=" * 60)
    except Exception as e:
        logger.error(f"❌ Example failed: {e}", exc_info=True)
        exit(1)
