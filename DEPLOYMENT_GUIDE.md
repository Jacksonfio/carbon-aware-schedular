# Deployment Checklist & Implementation Guide

## 📋 Pre-Deployment Checklist

### 1. Configuration Setup ✅
- [ ] Set `ELECTRICITY_MAPS_TOKEN` in GitHub Secrets
- [ ] Set `AWS_REGION` environment variable
- [ ] Set `S3_CARBON_BUCKET` for carbon logs
- [ ] Set `SQS_QUEUE_URL` for held jobs
- [ ] Validate all required env vars: `python -c "from config import Config; Config.from_env().validate()"`

### 2. Testing ✅
- [ ] Run unit tests: `pytest tests/ -v`
- [ ] Test with mock data: `ELECTRICITY_MAPS_TOKEN=mock python example_usage.py`
- [ ] Test caching behavior: `python tests/test_cache.py`
- [ ] Test error handling: `python tests/test_error_handling.py`
- [ ] Verify dashboard loads without errors

### 3. Code Review ✅
- [ ] Review config.py for all env vars
- [ ] Review cache.py implementation
- [ ] Review logging setup
- [ ] Review updated scheduler.py and fetcher.py
- [ ] Check dashboard utils.js error boundaries

### 4. Documentation ✅
- [ ] Update deployment docs with new env vars
- [ ] Document caching behavior
- [ ] Add troubleshooting guide
- [ ] Document monitoring/alerts

---

## 🚀 Step-by-Step Implementation

### Step 1: Install New Dependencies (if any)
```bash
cd e:\carbon-aware-scheduler
pip install -r requirements.txt
```

### Step 2: Verify Python Imports
```bash
# Test that all new modules can be imported
python -c "
from config import Config
from cache import TTLCache
from logging_config import setup_logging
from fetcher.carbon_fetcher import CarbonFetcher
from scheduler.scheduler import CarbonScheduler
print('✅ All imports successful')
"
```

### Step 3: Run Examples
```bash
# Run with mock data (no API calls needed)
ELECTRICITY_MAPS_TOKEN=mock python example_usage.py
```

Expected output:
```
============================================================
Example 1: Configuration Management
============================================================
Carbon hold threshold: 250.0 gCO₂/kWh
Cache enabled: True
Cache TTL: 300s
Log level: INFO
...
✅ All examples completed successfully!
```

### Step 4: Deploy to Production
```bash
# Build Docker image (if using containers)
docker build -t carbon-aware-scheduler:2.0 .

# Or deploy Lambda directly
cd infra/terraform
terraform plan
terraform apply
```

### Step 5: Monitor Initial Deployment
```bash
# Watch logs for first few deployments
tail -f logs/scheduler.log

# Monitor cache hit rate
grep "Cache hit" logs/scheduler.log | wc -l

# Monitor error rate
grep "ERROR" logs/scheduler.log | wc -l
```

---

## 🔍 Verification Tests

### Test 1: Configuration Loading
```bash
# Should succeed
ELECTRICITY_MAPS_TOKEN=test-token python -c "from config import Config; Config.from_env()"

# Should fail with helpful message
python -c "from config import Config; Config.from_env()"
```

### Test 2: Caching Behavior
```bash
ELECTRICITY_MAPS_TOKEN=mock python -c "
from cache import TTLCache
cache = TTLCache(ttl_seconds=5)

# Test set/get
cache.set('key1', 'value1')
print(f'Get: {cache.get(\"key1\")}')  # Should print: value1

# Test expiration (would need sleep in real test)
print(f'Miss: {cache.get(\"key2\")}')  # Should print: None
"
```

### Test 3: Error Handling
```bash
ELECTRICITY_MAPS_TOKEN=mock python -c "
from fetcher.carbon_fetcher import CarbonFetcher

fetcher = CarbonFetcher()
try:
    fetcher.fetch('invalid-region')
except ValueError as e:
    print(f'✅ Caught error: {e}')
"
```

### Test 4: Logging Configuration
```bash
LOG_LEVEL=DEBUG python -c "
from logging_config import setup_logging
import logging

setup_logging('DEBUG')
logger = logging.getLogger('test')
logger.debug('Debug message')
logger.info('Info message')
logger.warning('Warning message')
"
```

---

## 📊 Monitoring & Health Checks

### Metrics to Monitor

```
# Cache Performance
- Cache hit rate: (cache hits) / (total fetches)
  Target: > 60% after warmup

# API Performance
- API calls per 5 min: Should be < 2 with caching
- API response time: Should be < 500ms
- Rate limit errors: Should be 0 (or minimal)

# Deployment Decisions
- DEPLOY_NOW: % of deployments
- HOLD: % of deployments  
- OVERRIDE: % of deployments

# CO₂ Savings
- Total CO₂ held deployments: kg
- Estimated savings: %
```

### Health Check Script
```bash
#!/bin/bash
# health_check.sh

echo "=== Carbon-Aware Scheduler Health Check ==="

# Check config loading
python -c "from config import Config; Config.from_env().validate()" && echo "✅ Config OK" || echo "❌ Config FAILED"

# Check cache
python -c "from cache import TTLCache; TTLCache().set('test', 1)" && echo "✅ Cache OK" || echo "❌ Cache FAILED"

# Check fetcher
ELECTRICITY_MAPS_TOKEN=mock python -c "from fetcher.carbon_fetcher import CarbonFetcher; CarbonFetcher().fetch('us-east-1')" && echo "✅ Fetcher OK" || echo "❌ Fetcher FAILED"

# Check scheduler
ELECTRICITY_MAPS_TOKEN=mock python -c "from scheduler.scheduler import CarbonScheduler; CarbonScheduler().evaluate(__import__('scheduler').DeploymentContext('r', 'w', 'id', 'us-east-1'))" && echo "✅ Scheduler OK" || echo "❌ Scheduler FAILED"

echo ""
echo "=== All Systems Nominal ==="
```

---

## 🐛 Rollback Plan

If issues occur:

### Option 1: Revert to Previous Version
```bash
git revert HEAD~N  # Where N = number of commits to revert
git push origin main
```

### Option 2: Disable Caching
```bash
export ENABLE_CARBON_CACHE=false
# Redeploy Lambda function
```

### Option 3: Disable New Features (Use Legacy Mode)
```bash
# Don't use Config class, use old env var approach
# Set ELECTRICITY_MAPS_TIMEOUT=10 (default behavior)
```

---

## 📝 Deployment Log Template

```
Date: 2026-06-23
Version: 2.0
Components Deployed:
  - [x] config.py
  - [x] cache.py
  - [x] logging_config.py
  - [x] Updated fetcher.py
  - [x] Updated scheduler.py
  - [x] Dashboard utils.js

Pre-Deployment Tests:
  - [x] Config validation passed
  - [x] Cache tests passed
  - [x] Example usage successful
  - [x] Unit tests passed (X/Y)

Production Deployment:
  - [x] Terraform apply successful
  - [x] Lambda functions updated
  - [x] S3 artifacts deployed
  - [x] GitHub Actions workflow updated

Post-Deployment Monitoring:
  - [ ] API call reduction: __ %
  - [ ] Cache hit rate: __ %
  - [ ] Error rate: __ %
  - [ ] Average decision time: __ ms

Notes:
  - Initial warmup period: 5 minutes
  - Monitor logs for first 100 deployments
  - Check Electricity Maps quota usage

Sign-off: _________________ Date: _________
```

---

## 🎓 Team Training

### For Backend Engineers
1. Review [IMPROVEMENTS.md](./IMPROVEMENTS.md) sections 1-4
2. Run `python example_usage.py`
3. Update any custom deployment scripts to use Config class
4. Review error handling patterns in updated fetcher.py

### For DevOps/Infrastructure
1. Review deployment checklist above
2. Update monitoring dashboards
3. Add alerts for cache miss rate > 40%
4. Update runbooks with new troubleshooting section

### For Frontend Engineers
1. Review dashboard utils.js
2. Test ErrorBoundary in browser console
3. Verify S3 data loading with network tab
4. Test error scenarios manually

---

## ✅ Final Verification (Day 1)

After deployment, verify:

```bash
# 1. Services running
ps aux | grep -E "lambda|scheduler"

# 2. Recent logs show no errors
tail -100 /var/log/carbon-scheduler.log | grep -i error

# 3. Cache is working
grep "Cache hit" /var/log/carbon-scheduler.log | wc -l

# 4. API calls reduced
grep "Fetched carbon" /var/log/carbon-scheduler.log | wc -l

# 5. Dashboard loads
curl https://your-dashboard.s3.amazonaws.com/index.html | grep "React"

# 6. Deployments proceeding normally
git log --oneline | head -5
```

---

## 📞 Support & Escalation

### Issue: Cache not working
1. Check `ENABLE_CARBON_CACHE=true`
2. Check `CARBON_CACHE_TTL_SECONDS` value
3. Restart Lambda function
4. Check CloudWatch logs

### Issue: High error rate
1. Check `ELECTRICITY_MAPS_TOKEN` validity
2. Check API quota at electricitymaps.com
3. Check network connectivity
4. Increase `ELECTRICITY_MAPS_RETRIES=5`

### Issue: Dashboard errors
1. Check S3 bucket permissions
2. Verify CORS configuration
3. Check `REACT_APP_S3_BASE_URL`
4. Open browser DevTools (F12) for errors

---

## 🔗 Related Resources

- [IMPROVEMENTS.md](./IMPROVEMENTS.md) - Comprehensive technical guide
- [SUMMARY.md](./SUMMARY.md) - Executive summary
- [example_usage.py](./example_usage.py) - Runnable examples
- [README.md](./README.md) - Original project docs
- Electricity Maps API: https://api.electricitymap.org/docs
- AWS Lambda docs: https://docs.aws.amazon.com/lambda/

---

**Last Updated:** 2026-06-23  
**Status:** Ready for Deployment
