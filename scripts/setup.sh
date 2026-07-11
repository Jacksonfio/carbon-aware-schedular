#!/bin/bash
# setup.sh — One-shot setup for the carbon-aware-scheduler project
set -e

echo "==> Carbon-Aware Deployment Scheduler — Setup"
echo ""

# ── Python deps ──────────────────────────────────────────────
echo "[1/4] Installing Python dependencies..."
pip install -r requirements.txt --quiet
echo "      Done."

# ── Env file ─────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "[2/4] Creating .env file from template..."
  cat > .env << 'EOF'
# Get a free token at https://www.electricitymaps.com/
ELECTRICITY_MAPS_TOKEN=your_token_here

# AWS settings
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012

# Set these after running terraform apply
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/carbon-aware-scheduler-held-deployments
S3_CARBON_BUCKET=carbon-aware-scheduler-carbon-logs-123456789012

# For Lambda poller re-triggering
GITHUB_TOKEN=ghp_your_token_here

# Scheduler config
CARBON_THRESHOLD=250
URGENCY_OVERRIDE=false
JOB_TYPE=deploy
EOF
  echo "      .env created. Fill in your tokens before running."
else
  echo "[2/4] .env already exists, skipping."
fi

# ── Run tests ─────────────────────────────────────────────────
echo "[3/4] Running unit tests..."
export PYTHONPATH=src
pytest tests/ -v --tb=short
echo "      All tests passed."

# ── Dashboard deps ────────────────────────────────────────────
echo "[4/4] Installing dashboard dependencies..."
cd src/dashboard && npm install --silent && cd ../..
echo "      Done."

echo ""
echo "✅  Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your tokens"
echo "  2. cd infra/terraform && terraform init && terraform apply"
echo "  3. Add the carbon gate to your workflow (.github/workflows/deploy.yml)"
echo "  4. cd src/dashboard && npm start   (view the dashboard locally)"
