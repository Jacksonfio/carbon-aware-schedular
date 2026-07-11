"""
logging_config.py
Centralized logging configuration for the carbon-aware scheduler.
Provides consistent formatting and handlers across all modules.
"""

import logging
import sys
from typing import Optional


def setup_logging(log_level: str = "INFO") -> None:
    """
    Configure logging for the application.
    
    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL).
    """
    # Convert string log level to logging constant
    numeric_level = getattr(logging, log_level.upper(), logging.INFO)
    
    # Create formatter
    formatter = logging.Formatter(
        fmt="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(numeric_level)
    
    # Remove existing handlers
    root_logger.handlers.clear()
    
    # Add console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(numeric_level)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # Suppress verbose third-party loggers
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    
    # Log startup message
    logger = logging.getLogger(__name__)
    logger.debug(f"Logging configured at level {log_level}")


class ErrorHandler:
    """Utility for consistent error handling and reporting."""
    
    @staticmethod
    def log_and_raise(
        logger: logging.Logger,
        error_class: type,
        message: str,
        cause: Optional[Exception] = None,
        **context,
    ) -> None:
        """
        Log an error with context and raise a custom exception.
        
        Args:
            logger: Logger instance.
            error_class: Exception class to raise.
            message: Error message.
            cause: Optional underlying exception (for chaining).
            **context: Additional context to log.
        """
        context_str = " | ".join(f"{k}={v}" for k, v in context.items())
        full_message = f"{message}" + (f" | {context_str}" if context_str else "")
        
        logger.error(full_message)
        
        if cause:
            raise error_class(full_message) from cause
        else:
            raise error_class(full_message)
    
    @staticmethod
    def log_retry(
        logger: logging.Logger,
        attempt: int,
        total: int,
        error: Exception,
        wait_seconds: int,
    ) -> None:
        """
        Log a retry attempt.
        
        Args:
            logger: Logger instance.
            attempt: Current attempt number.
            total: Total number of attempts.
            error: The error that triggered the retry.
            wait_seconds: Time to wait before next attempt.
        """
        logger.warning(
            f"Attempt {attempt}/{total} failed with {type(error).__name__}: "
            f"{str(error)[:100]}... Retrying in {wait_seconds}s"
        )
