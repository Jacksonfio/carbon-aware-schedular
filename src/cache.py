"""
cache.py
Simple in-memory TTL-based cache for carbon readings.
Reduces redundant API calls during high request volumes.
"""

import time
import logging
from typing import TypeVar, Optional, Callable
from dataclasses import dataclass

logger = logging.getLogger(__name__)

T = TypeVar("T")


@dataclass
class CacheEntry:
    """A cached value with expiration time."""
    value: T
    expires_at: float


class TTLCache:
    """Thread-safe in-memory cache with time-to-live expiration."""
    
    def __init__(self, ttl_seconds: int = 300):
        """
        Initialize cache.
        
        Args:
            ttl_seconds: Time-to-live for cache entries in seconds.
        """
        self.ttl_seconds = ttl_seconds
        self._cache: dict[str, CacheEntry] = {}
    
    def get(self, key: str) -> Optional[T]:
        """
        Retrieve a value from cache if it exists and hasn't expired.
        
        Args:
            key: Cache key.
            
        Returns:
            Cached value or None if not found or expired.
        """
        if key not in self._cache:
            logger.debug(f"Cache miss: {key}")
            return None
        
        entry = self._cache[key]
        if time.time() > entry.expires_at:
            logger.debug(f"Cache expired: {key}")
            del self._cache[key]
            return None
        
        logger.debug(f"Cache hit: {key}")
        return entry.value
    
    def set(self, key: str, value: T) -> None:
        """
        Store a value in cache with TTL.
        
        Args:
            key: Cache key.
            value: Value to cache.
        """
        expires_at = time.time() + self.ttl_seconds
        self._cache[key] = CacheEntry(value=value, expires_at=expires_at)
        logger.debug(f"Cached {key} (expires in {self.ttl_seconds}s)")
    
    def clear(self) -> None:
        """Clear all cache entries."""
        self._cache.clear()
        logger.debug("Cache cleared")
    
    def get_or_compute(
        self,
        key: str,
        compute_fn: Callable[[], T],
    ) -> T:
        """
        Get value from cache, or compute and cache it if missing.
        
        Args:
            key: Cache key.
            compute_fn: Function to call if cache miss.
            
        Returns:
            Cached or newly computed value.
        """
        cached = self.get(key)
        if cached is not None:
            return cached
        
        logger.debug(f"Computing value for {key}")
        value = compute_fn()
        self.set(key, value)
        return value
