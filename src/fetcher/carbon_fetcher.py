"""
carbon_fetcher.py
Fetches real-time carbon intensity from the Electricity Maps API
and maps AWS regions to their corresponding grid zones.
Includes caching and exponential backoff retry logic.
"""

import os
import time
import logging
import json
import urllib.request
import urllib.parse
import urllib.error
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

# Import config and cache utilities
try:
    from config import Config
    from cache import TTLCache
except ImportError:
    # Fallback for when running in different contexts
    Config = None
    TTLCache = None

# AWS region → Electricity Maps zone mapping
REGION_ZONE_MAP: dict[str, str] = {
    "us-east-1":      "US-MIDA-PJM",   # N. Virginia — PJM grid
    "us-east-2":      "US-MIDW-MISO",  # Ohio — MISO grid
    "us-west-1":      "US-CAL-CISO",   # N. California — CAISO
    "us-west-2":      "US-NW-PACW",    # Oregon — Pacific West
    "eu-west-1":      "IE",            # Ireland
    "eu-west-2":      "GB",            # London — UK grid
    "eu-central-1":   "DE",            # Frankfurt — Germany
    "eu-north-1":     "SE",            # Stockholm — Sweden
    "ap-southeast-1": "SG",            # Singapore
    "ap-southeast-2": "AU-NSW",        # Sydney — NSW
    "ap-south-1":     "IN-SO",         # Mumbai — South India
    "ap-northeast-1": "JP-TK",         # Tokyo
    "ca-central-1":   "CA-ON",         # Canada — Ontario
    "sa-east-1":      "BR-CS",         # São Paulo — Brazil Central
}

ELECTRICITY_MAPS_BASE = "https://api.electricitymap.org/v3"


@dataclass
class CarbonReading:
    zone: str
    aws_region: str
    carbon_intensity: float       # gCO2eq/kWh
    fossil_fuel_percentage: float # % of generation from fossil fuels
    renewable_percentage: float   # % from renewables
    timestamp: str
    data_source: str = "electricity_maps"
    is_estimated: bool = False


class CarbonFetcher:
    def __init__(self, api_token: Optional[str] = None, config: Optional["Config"] = None):
        """
        Initialize the carbon fetcher.
        
        Args:
            api_token: Optional override for API token (for backwards compatibility).
            config: Optional Config object. If not provided, loads from environment.
        """
        if config:
            self.config = config
        elif Config:
            self.config = Config.from_env()
            self.config.validate()
        else:
            # Fallback to simple token-based initialization
            raw = api_token or os.environ.get("ELECTRICITY_MAPS_TOKEN", "")
            self.token = raw.strip() if raw else raw
            if not self.token:
                raise ValueError(
                    "ELECTRICITY_MAPS_TOKEN not set. "
                    "Get a free token at https://www.electricitymaps.com/ "
                    "or set ELECTRICITY_MAPS_TOKEN=mock for simulated live data."
                )
            self.config = None
        
        # Set token and headers
        if self.config:
            self.token = self.config.electricity_maps_token
            timeout = self.config.electricity_maps_timeout
        else:
            timeout = 10
        
        self.headers = {
            "auth-token": self.token,
            "User-Agent": "carbon-aware-scheduler/1.0"
        }
        self.timeout = timeout
        
        # Initialize cache if enabled
        if self.config and self.config.enable_carbon_cache and TTLCache:
            self.cache = TTLCache(ttl_seconds=self.config.carbon_cache_ttl_seconds)
        else:
            self.cache = None

    def get_zone_for_region(self, aws_region: str) -> str:
        zone = REGION_ZONE_MAP.get(aws_region)
        if not zone:
            raise ValueError(
                f"No grid zone mapping found for AWS region '{aws_region}'. "
                f"Supported regions: {list(REGION_ZONE_MAP.keys())}"
            )
        return zone

    def _get_mock_reading(self, aws_region: str) -> CarbonReading:
        """Generates realistic mock carbon intensity data based on the current hour."""
        import random
        import math
        from datetime import datetime, timezone
        
        zone = self.get_zone_for_region(aws_region)
        now = datetime.now(timezone.utc)
        hour = now.hour
        
        # Base typical carbon intensity for various AWS regions
        base_ci = {
            "us-east-1":      300,
            "us-east-2":      450,
            "us-west-1":      200,
            "us-west-2":      120,
            "eu-west-1":      250,
            "eu-west-2":      180,
            "eu-central-1":   350,
            "eu-north-1":      30,
            "ap-southeast-1": 400,
            "ap-southeast-2": 550,
            "ap-south-1":     650,
            "ap-northeast-1": 480,
            "ca-central-1":    80,
            "sa-east-1":      150,
        }.get(aws_region, 300)
        
        # Apply diurnal solar variation (cleaner in midday, i.e. 10:00 to 16:00 UTC)
        time_factor = math.sin((hour - 6) * math.pi / 12)  # -1 to 1
        variation = base_ci * 0.25 * time_factor
        carbon_intensity = max(10.0, base_ci + variation + random.randint(-15, 15))
        
        renewable_pct = max(0.0, min(100.0, 100.0 - (carbon_intensity / 800.0) * 100.0))
        fossil_fuel_pct = 100.0 - renewable_pct
        
        return CarbonReading(
            zone=zone,
            aws_region=aws_region,
            carbon_intensity=round(carbon_intensity, 1),
            fossil_fuel_percentage=round(fossil_fuel_pct, 1),
            renewable_percentage=round(renewable_pct, 1),
            timestamp=now.isoformat(),
            data_source="electricity_maps_mock",
            is_estimated=True,
        )

    def _make_request(self, url: str, params: dict, timeout: Optional[int] = None) -> dict:
        """
        Helper to make an HTTP GET request using urllib and parse JSON response.
        
        Args:
            url: The API endpoint URL.
            params: Query parameters dict.
            timeout: Request timeout in seconds. Uses self.timeout if not provided.
            
        Returns:
            Parsed JSON response as dict.
            
        Raises:
            urllib.error.HTTPError: On HTTP errors (429, 404, 5xx, etc.)
            urllib.error.URLError: On network/DNS errors.
            json.JSONDecodeError: On malformed JSON response.
        """
        if timeout is None:
            timeout = self.timeout
            
        query_string = urllib.parse.urlencode(params)
        full_url = f"{url}?{query_string}"
        req = urllib.request.Request(full_url, headers=self.headers)
        
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            logger.error(
                f"HTTP error {e.code} from {url}: {e.reason} "
                f"(zone: {params.get('zone')})"
            )
            raise
        except urllib.error.URLError as e:
            logger.error(f"Network error fetching {url}: {e.reason}")
            raise
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON response from {url}: {e}")
            raise

    def fetch(self, aws_region: str, retries: Optional[int] = None) -> CarbonReading:
        """
        Fetches the latest carbon intensity reading for a given AWS region.
        Results are cached to reduce API calls. Retries with exponential backoff
        on transient failures.
        
        Args:
            aws_region: AWS region code (e.g., 'us-east-1').
            retries: Number of retries. Uses config value if not provided.
            
        Returns:
            CarbonReading object with current carbon intensity and mix.
            
        Raises:
            ValueError: If region not supported or zone not found.
            RuntimeError: If all retries exhausted.
        """
        if retries is None:
            retries = self.config.electricity_maps_retries if self.config else 3
        
        # Check cache first
        cache_key = f"carbon_reading:{aws_region}"
        if self.cache:
            cached = self.cache.get(cache_key)
            if cached:
                return cached
        
        # Return mock data if configured
        if self.token.lower() == "mock":
            reading = self._get_mock_reading(aws_region)
            if self.cache:
                self.cache.set(cache_key, reading)
            return reading

        zone = self.get_zone_for_region(aws_region)
        url = f"{ELECTRICITY_MAPS_BASE}/carbon-intensity/latest"
        params = {"zone": zone}

        last_error = None
        for attempt in range(1, retries + 1):
            try:
                data = self._make_request(url, params)

                # Try to get power breakdown, but don't fail if unavailable
                power_url = f"{ELECTRICITY_MAPS_BASE}/power-breakdown/latest"
                fossil_pct = 0.0
                renew_pct = 0.0
                try:
                    power_data = self._make_request(power_url, params)
                    fossil_pct = power_data.get("fossilFuelPercentage", 0.0) or 0.0
                    renew_pct = power_data.get("renewablePercentage", 0.0) or 0.0
                except Exception as e:
                    logger.debug(f"Could not fetch power breakdown for {zone}: {e}")

                reading = CarbonReading(
                    zone=zone,
                    aws_region=aws_region,
                    carbon_intensity=data["carbonIntensity"],
                    fossil_fuel_percentage=fossil_pct,
                    renewable_percentage=renew_pct,
                    timestamp=data["datetime"],
                    is_estimated=data.get("isEstimated", False),
                )
                
                # Cache the reading
                if self.cache:
                    self.cache.set(cache_key, reading)
                
                logger.info(
                    f"Fetched carbon intensity for {aws_region} ({zone}): "
                    f"{reading.carbon_intensity:.0f} gCO₂/kWh"
                )
                return reading
                
            except urllib.error.HTTPError as e:
                last_error = e
                if e.code == 429:
                    # Rate limited — exponential backoff
                    wait_time = 2 ** attempt
                    logger.warning(
                        f"Rate limited (HTTP 429). Waiting {wait_time}s "
                        f"before retry (attempt {attempt}/{retries})"
                    )
                    time.sleep(wait_time)
                elif e.code == 404:
                    raise ValueError(
                        f"Zone '{zone}' not found in Electricity Maps API"
                    ) from e
                elif e.code >= 500:
                    # Server error — retry with backoff
                    if attempt < retries:
                        wait_time = 2 ** attempt
                        logger.warning(
                            f"Server error (HTTP {e.code}). Retrying in {wait_time}s "
                            f"(attempt {attempt}/{retries})"
                        )
                        time.sleep(wait_time)
                    else:
                        raise RuntimeError(
                            f"Failed to fetch carbon data after {retries} attempts: "
                            f"HTTP {e.code}"
                        ) from e
                else:
                    raise
            except (urllib.error.URLError, TimeoutError) as e:
                last_error = e
                if attempt < retries:
                    wait_time = 2 ** attempt
                    logger.warning(
                        f"Network error: {e}. Retrying in {wait_time}s "
                        f"(attempt {attempt}/{retries})"
                    )
                    time.sleep(wait_time)
                else:
                    raise RuntimeError(
                        f"Failed to fetch carbon data after {retries} attempts: {e}"
                    ) from e
            except Exception as e:
                last_error = e
                if attempt < retries:
                    wait_time = 2 ** attempt
                    logger.warning(
                        f"Unexpected error: {e}. Retrying in {wait_time}s "
                        f"(attempt {attempt}/{retries})"
                    )
                    time.sleep(wait_time)
                else:
                    raise RuntimeError(
                        f"Failed to fetch carbon data after {retries} attempts: {e}"
                    ) from e
        
        # Should not reach here, but just in case
        raise RuntimeError(
            f"Failed to fetch carbon data after {retries} attempts"
        ) from last_error

    def fetch_forecast(self, aws_region: str, hours: int = 24) -> list[dict]:
        """
        Fetches hourly carbon intensity forecast for the next N hours.
        Useful for finding the optimal deployment window.
        """
        if self.token.lower() == "mock":
            from datetime import datetime, timezone, timedelta
            import math
            forecast = []
            now = datetime.now(timezone.utc)
            base_ci = {
                "us-east-1":      300,
                "us-east-2":      450,
                "us-west-1":      200,
                "us-west-2":      120,
                "eu-west-1":      250,
                "eu-west-2":      180,
                "eu-central-1":   350,
                "eu-north-1":      30,
                "ap-southeast-1": 400,
                "ap-southeast-2": 550,
                "ap-south-1":     650,
                "ap-northeast-1": 480,
                "ca-central-1":    80,
                "sa-east-1":      150,
            }.get(aws_region, 300)
            
            for h in range(hours):
                target_time = now + timedelta(hours=h)
                time_factor = math.sin((target_time.hour - 6) * math.pi / 12)
                ci = max(10.0, base_ci + (base_ci * 0.25 * time_factor))
                forecast.append({
                    "datetime": target_time.isoformat(),
                    "carbonIntensity": round(ci, 1)
                })
            return forecast

        zone = self.get_zone_for_region(aws_region)
        url = f"{ELECTRICITY_MAPS_BASE}/carbon-intensity/forecast"
        params = {"zone": zone}

        data = self._make_request(url, params)
        forecast = data.get("forecast", [])
        return forecast[:hours]

    def find_greenest_window(self, aws_region: str, within_hours: int = 12) -> dict:
        """
        From the forecast, finds the hour with the lowest carbon intensity
        within the next N hours — useful for scheduling batch jobs.
        """
        forecast = self.fetch_forecast(aws_region, hours=within_hours)
        if not forecast:
            return {}
        greenest = min(forecast, key=lambda x: x.get("carbonIntensity", 9999))
        return greenest


if __name__ == "__main__":
    import json
    logging.basicConfig(level=logging.INFO)
    fetcher = CarbonFetcher()
    reading = fetcher.fetch("us-east-1")
    print(json.dumps({
        "region": reading.aws_region,
        "zone": reading.zone,
        "carbon_intensity_gco2_kwh": reading.carbon_intensity,
        "renewable_pct": reading.renewable_percentage,
        "timestamp": reading.timestamp,
    }, indent=2))

