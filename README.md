# Carbon-Aware Deployment Scheduler

> A GitHub Actions plugin that delays non-urgent CI/CD deployments to AWS regions with the lowest real-time carbon intensity — then tracks the saved CO₂ on a live dashboard.

---

## What it does

When a deployment is triggered:
1. Fetches real-time grid carbon intensity (gCO₂/kWh) for the target AWS region via [Electricity Maps API](https://www.electricitymaps.com/)
2. Scores the deployment and decides: **DEPLOY_NOW**, **HOLD**, or **OVERRIDE**
3. Held jobs queue in AWS SQS; a Lambda poller re-checks every 30 min and auto-triggers when the grid is green
4. Every deployment logs a carbon record to S3 → visible on the React dashboard

---

## Project Structure

```
carbon-aware-scheduler/
├── .github/
│   ├── actions/carbon-gate/     # Composite GitHub Action
│   └── workflows/               # Example CI/CD workflows
├── src/
│   ├── fetcher/                 # Carbon intensity fetcher (Electricity Maps)
│   ├── scheduler/               # Decision engine (DEPLOY_NOW / HOLD / OVERRIDE)
│   ├── queue/                   # SQS queue + Lambda poller
│   └── dashboard/               # React dashboard (S3-hosted)
├── infra/
│   └── terraform/               # AWS infra (SQS, Lambda, S3, IAM)
├── tests/                       # pytest unit + integration tests
├── docs/                        # Architecture diagrams, reports
└── scripts/                     # Setup and utility scripts
```

---

## Quick Start

### 1. Add to any GitHub Actions workflow

```yaml
- name: Carbon gate
  uses: ./.github/actions/carbon-gate
  with:
    aws_region: us-east-1
    carbon_threshold: 250        # gCO2/kWh — hold above this
    urgency: false               # true = skip carbon check
    electricity_maps_token: ${{ secrets.ELECTRICITY_MAPS_TOKEN }}
```

### 2. Deploy the AWS infrastructure

```bash
cd infra/terraform
terraform init
terraform apply
```

### 3. Run the dashboard locally

```bash
cd src/dashboard
npm install
npm start
```

---

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `ELECTRICITY_MAPS_TOKEN` | API token from electricitymaps.com | Yes |
| `AWS_REGION` | Target deployment region | Yes |
| `CARBON_THRESHOLD` | gCO₂/kWh above which deploys are held | No (default: 250) |
| `URGENCY_OVERRIDE` | `true` to bypass carbon check | No (default: false) |
| `SQS_QUEUE_URL` | SQS queue URL for held jobs | Yes (for queue mode) |
| `GITHUB_TOKEN` | For re-triggering workflows | Yes (auto-set in Actions) |
| `S3_CARBON_BUCKET` | Bucket for deployment carbon logs | Yes |

---

## Carbon Scoring

```
gCO2/kWh < 150    →  Very green   →  DEPLOY_NOW  ✅
gCO2/kWh 150–250  →  Acceptable   →  DEPLOY_NOW  ✅
gCO2/kWh 250–400  →  Hold zone    →  HOLD ⏳ (re-check in 30 min)
gCO2/kWh > 400    →  High carbon  →  HOLD ⏳ (re-check in 30 min)
urgency = true    →  Any score    →  OVERRIDE 🚨
```

---

## AWS Region → Grid Zone Mapping

| AWS Region | Grid Zone | Notes |
|---|---|---|
| us-east-1 | US-MIDA-PJM | Virginia — PJM grid |
| us-west-2 | US-NW-PACW | Oregon — Pacific West |
| eu-west-1 | IE | Ireland |
| eu-central-1 | DE | Germany |
| ap-southeast-1 | SG | Singapore |
| ap-south-1 | IN-SO | Mumbai — Southern India |

---

## Tech Stack

| Layer | Technology |
|---|---|
| CI/CD hook | GitHub Actions composite action |
| Carbon data | Electricity Maps API |
| Decision engine | Python 3.11 |
| Queue | AWS SQS |
| Poller | AWS Lambda (Python 3.11) |
| Data store | AWS S3 (JSON records) |
| Dashboard | React + Recharts |
| Infra-as-Code | Terraform |
| Testing | pytest + moto (AWS mock) |

---

## HackVerse 2026 Context

Developed for **HackVerse 2026** under the **Sustainability & Smart Cities** domain. This project tackles the carbon footprint of cloud operations, enabling organizations to automatically schedule computational workloads (like code compilation, test suite executions, and deployments) to run at times when local grids are powered by renewable sources.

---

## License

MIT
