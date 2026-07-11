"""
tests/test_fetcher.py
Unit tests for the carbon fetcher — mocks HTTP calls.
"""

import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from unittest.mock import patch, MagicMock
from fetcher.carbon_fetcher import CarbonFetcher, REGION_ZONE_MAP


class TestRegionMapping:
    def test_known_regions_have_zones(self):
        for region in ["us-east-1", "us-west-2", "eu-west-1", "ap-south-1"]:
            fetcher = CarbonFetcher.__new__(CarbonFetcher)
            zone = REGION_ZONE_MAP.get(region)
            assert zone is not None, f"No zone for {region}"

    def test_unknown_region_raises(self):
        fetcher = CarbonFetcher.__new__(CarbonFetcher)
        fetcher.token = "fake"
        with pytest.raises(ValueError, match="No grid zone mapping"):
            fetcher.get_zone_for_region("xx-fake-99")


import json

class TestFetch:
    @patch("fetcher.carbon_fetcher.urllib.request.urlopen")
    def test_successful_fetch(self, mock_urlopen):
        mock_response_1 = MagicMock()
        mock_response_1.read.return_value = json.dumps({
            "carbonIntensity": 183.0,
            "datetime": "2024-06-01T12:00:00Z",
            "isEstimated": False,
        }).encode("utf-8")

        mock_response_2 = MagicMock()
        mock_response_2.read.return_value = json.dumps({
            "fossilFuelPercentage": 38.0,
            "renewablePercentage": 62.0,
        }).encode("utf-8")

        # Mock the context manager __enter__
        mock_response_1.__enter__.return_value = mock_response_1
        mock_response_2.__enter__.return_value = mock_response_2

        mock_urlopen.side_effect = [mock_response_1, mock_response_2]

        fetcher = CarbonFetcher.__new__(CarbonFetcher)
        fetcher.token = "fake-token"
        fetcher.headers = {
            "auth-token": "fake-token",
            "User-Agent": "carbon-aware-scheduler/1.0"
        }

        reading = fetcher.fetch("us-east-1")
        assert reading.carbon_intensity == 183.0
        assert reading.zone == "US-MIDA-PJM"
        assert reading.aws_region == "us-east-1"
        assert reading.renewable_percentage == 62.0
        assert reading.is_estimated is False

    def test_no_token_raises(self):
        with patch.dict(os.environ, {}, clear=True):
            import os as _os
            _os.environ.pop("ELECTRICITY_MAPS_TOKEN", None)
            with pytest.raises(ValueError, match="ELECTRICITY_MAPS_TOKEN"):
                CarbonFetcher()
