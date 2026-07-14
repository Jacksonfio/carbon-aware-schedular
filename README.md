<p align="center">
  <img src="https://img.shields.io/badge/status-active-success?style=for-the-badge" alt="Status">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="License">
  <img src="https://img.shields.io/badge/version-2.1.0--HackVerse-2d6a4f?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/terraform-✓-7B42BC?style=for-the-badge&logo=terraform&logoColor=white" alt="Terraform">
  <img src="https://img.shields.io/badge/AWS-serverless-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white" alt="AWS">
</p>

<h1 align="center">🌱 GreenGate</h1>
<h3 align="center">Carbon-Aware Deployment Scheduler</h3>

<p align="center">
  <em>A GitHub Actions plugin that intelligently delays non-urgent CI/CD deployments to AWS regions powered by the <strong>cleanest grid energy</strong> — then tracks every kilogram of CO₂ saved on a live dashboard.</em>
</p>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [How It Works](#-how-it-works)
- [Carbon Scoring](#-carbon-scoring)
- [Quick Start](#-quick-start)
- [Deployment](#-deployment)
- [Environment Variables](#-environment-variables)
- [Tech Stack](#-tech-stack)
- [AWS Region Mapping](#-aws-region--grid-zone-mapping)
- [Testing](#-testing)
- [Project Structure](#-project-structure)
- [License](#-license)

---

## 🌍 Overview

**GreenGate** tackles the carbon footprint of cloud operations by acting as a smart gate between CI/CD triggers and actual deployments. It queries real-time electrical grid carbon intensity via the [Electricity Maps API](https://www.electricitymaps.com/), scores each deployment request, and either allows, queues, or overrides the deployment based on how green the grid is at that moment.

| Capability | Description |
|---|---|
| **Real-time Carbon Tracking** | Fetches live gCO₂/kWh + renewable/fossil breakdown per AWS region |
| **Smart Gate Validation** | Configurable thresholds decide DEPLOY_NOW, HOLD (auto-retry), or OVERRIDE |
| **Automated Dispatch** | Held jobs queue in SQS; Lambda re-checks every 30 min and auto-releases on green grid |
| **Live Dashboard** | React + Recharts telemetry dashboard with AI-powered optimization insights |
| **Infrastructure as Code** | One-click Terraform deployment for the entire serverless stack |

<div align="center">
  <sub>🏆 Developed for <strong>HackVerse 2026</strong> — Sustainability & Smart Cities domain</sub>
  <br>
  <sub>Aligns with UN Sustainable Development Goals <strong>#7</strong> (Clean Energy), <strong>#9</strong> (Industry & Innovation), <strong>#11</strong> (Sustainable Cities), <strong>#13</strong> (Climate Action)</sub>
</div>

---

## 🏗 Architecture

```mermaid
%%{init: {
  'theme': 'base',
  'themeVariables': {
    'primaryColor': '#2d6a4f',
    'primaryTextColor': '#fff',
    'primaryBorderColor': '#1b4332',
    'lineColor': '#52b788',
    'secondaryColor': '#40916c',
    'tertiaryColor': '#d8f3dc',
    'fontSize': '14px'
  }
}}%%

flowchart TB
    subgraph Trigger["🚀 Trigger"]
        direction LR
        GIT["📤 Git Push / PR"] --> GHA["⚡ GitHub Actions Workflow"]
    end

    subgraph Gate["🛡️ Carbon Gate Action"]
        direction TB
        BUILD["🔨 Job: Build & Test"] --> GATE_ACTION["⚙️ carbon-gate/action.yml"]
        GATE_ACTION --> CF["🌐 CarbonFetcher<br/><i>Electricity Maps API</i>"]
        CF --> CACHE["📦 TTL Cache<br/><i>5 min expiry</i>"]
        CF --> CS["🧠 CarbonScheduler<br/><i>Decision Engine</i>"]
        CS -->|"CI < threshold"| DN["✅ DEPLOY_NOW"]
        CS -->|"CI ≥ threshold"| HOLD["⏳ HOLD"]
        CS -->|"urgency = true"| OV["🚨 OVERRIDE"]
    end

    subgraph Queue["📬 Queue & Poll"]
        direction TB
        HOLD --> QM["📨 QueueManager<br/><i>enqueue_held_job()</i>"]
        QM --> SQS["📥 AWS SQS<br/><i>held-deployments</i>"]
        SQS --> LAMBDA["⚡ AWS Lambda<br/><i>lambda_poller.py</i>"]
        LAMBDA -->|"Re-fetch carbon"| CF
        LAMBDA -->|"CI < threshold"| RERUN["🔄 GitHub API<br/><i>rerun workflow</i>"]
        LAMBDA -->|"Max retries"| FORCE["⚠️ Force Deploy"]
        LAMBDA -->|"Still dirty"| SQS
        EB["⏰ EventBridge<br/><i>rate(30 min)</i>"] --> LAMBDA
    end

    subgraph Storage["💾 Storage & Observability"]
        direction LR
        S3_LOGS["📊 S3 Bucket<br/><i>carbon-logs/</i>"]
        S3_DASH["🖥️ S3 Bucket<br/><i>dashboard hosting</i>"]
        CW["📈 CloudWatch<br/><i>dashboard & metrics</i>"]
        SM["🔐 Secrets Manager<br/><i>API tokens</i>"]
    end

    subgraph Dashboard["📊 React Dashboard"]
        direction TB
        DASH_APP["🖥️ Dashboard App<br/><i>React + Recharts</i>"]
        AI["🤖 AI Insights<br/><i>Groq LLM</i>"]
        SIM["🎮 Simulator<br/><i>Pipeline simulator</i>"]
        DASH_APP --> AI
        DASH_APP --> SIM
    end

    subgraph Deploy["🚢 Deployment"]
        direction LR
        RERUN --> DEP_JOB["📦 Deploy Job"]
        FORCE --> DEP_JOB
        DN --> DEP_JOB
        OV --> DEP_JOB
        DEP_JOB --> ECS["☁️ AWS ECS"]
        DEP_JOB --> SLACK["💬 Slack Notification"]
    end

    QM --> S3_LOGS
    LAMBDA --> S3_LOGS
    S3_DASH --> DASH_APP
    DEP_JOB --> S3_LOGS

    style Trigger fill:#1b4332,color:#fff,stroke:#2d6a4f
    style Gate fill:#2d6a4f,color:#fff,stroke:#40916c
    style Queue fill:#40916c,color:#fff,stroke:#52b788
    style Storage fill:#52b788,color:#1b4332,stroke:#74c69d
    style Dashboard fill:#95d5b2,color:#1b4332,stroke:#b7e4c7
    style Deploy fill:#d8f3dc,color:#1b4332,stroke:#e9f5f0
```

### Data Flow Summary

```
1️⃣ Git Push → GitHub Actions triggers build job
2️⃣ Carbon Gate fetches live gCO₂/kWh from Electricity Maps API
3️⃣ Decision engine scores the deployment (DEPLOY_NOW / HOLD / OVERRIDE)
4️⃣ Held jobs enqueue to AWS SQS with retry metadata
5️⃣ Lambda poller re-checks every 30 min (up to 48 retries = 24h max hold)
6️⃣ Clean grid → workflow auto-reruns → deployment proceeds
7️⃣ Every decision logged to S3 → visualized on React dashboard
```

---

## ⚙️ How It Works

### The Decision Pipeline

```
                 ┌─────────────────────┐
                 │   Git Push / PR     │
                 │   triggers workflow │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │  Job: Build & Test  │
                 │  (always runs)      │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │  Job: Carbon Gate   │
                 │  (needs: build)     │
                 └──────────┬──────────┘
                            │
                            ▼
              ┌──────────────────────────┐
              │  Fetch Carbon Intensity  │
              │  (Electricity Maps API)  │
              └────────────┬─────────────┘
                           │
                           ▼
              ┌──────────────────────────┐
              │    Evaluate Decision     │
              │                          │
              │  urgency=true? ──► OVERRIDE│
              │  rollback? ──────► DEPLOY_NOW│
              │  CI < threshold? ► DEPLOY_NOW│
              │  CI ≥ threshold? ──► HOLD  │
              └────────────┬─────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   ┌──────────┐     ┌──────────┐     ┌──────────┐
   │DEPLOY_NOW│     │  HOLD    │     │OVERRIDE  │
   │  ✅ Go   │     │  ⏳ Wait │     │  🚨 Go   │
   └──────────┘     └──────────┘     └──────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │ Enqueue to SQS       │
              │ (up to 48 retries)   │
              └──────────────────────┘
```

---

## 📊 Carbon Scoring

| gCO₂/kWh | Quality | Decision | Action |
|---|---|---|---|
| **< 150** | 🟢 Very Green | **DEPLOY_NOW** ✅ | Proceed immediately |
| **150 – 250** | 🟡 Acceptable | **DEPLOY_NOW** ✅ | Proceed immediately |
| **250 – 400** | 🟠 Hold Zone | **HOLD** ⏳ | Queue, re-check in 30 min |
| **> 400** | 🔴 High Carbon | **HOLD** ⏳ | Queue, re-check in 30 min |
| **Any (urgency=true)** | — | **OVERRIDE** 🚨 | Bypass carbon check |

### CO₂ Estimation Formula

```
Estimated CO₂ (kg) = Carbon Intensity (gCO₂/kWh) × Energy per Job Type (kWh) / 1000
```

| Job Type | Energy Estimate |
|---|---|
| `deploy` | 0.002 kWh |
| `release` | 0.003 kWh |
| `rollback` | 0.001 kWh |
| `smoke-test` | 0.0005 kWh |

---

## 🚀 Quick Start

### 1. Add Carbon Gate to Any Workflow

```yaml
- name: Carbon gate
  uses: ./.github/actions/carbon-gate
  with:
    aws_region: us-east-1
    carbon_threshold: 250
    urgency: false
    electricity_maps_token: ${{ secrets.ELECTRICITY_MAPS_TOKEN }}
    job_type: deploy
    sqs_queue_url: ${{ vars.SQS_QUEUE_URL }}
    s3_carbon_bucket: ${{ vars.S3_CARBON_BUCKET }}
```

### 2. Deploy AWS Infrastructure

```bash
cd infra/terraform
terraform init
terraform apply
```

### 3. Run Dashboard Locally

```bash
cd src/dashboard
npm install
npm start
```

### 4. Run Tests

```bash
pip install -r requirements.txt
pytest tests/ -v --cov=src
```

### 5. Quick Demo

```bash
python scripts/run_live_demo.py
```

---

## 🚢 Deployment

See the full [Deployment Guide](DEPLOYMENT_GUIDE.md) for detailed instructions including:

- Step-by-step implementation checklist
- AWS IAM role and policy configuration
- Secrets Manager setup for API tokens
- Verification and smoke tests
- Monitoring and health check metrics
- Rollback procedures
- Team training and support escalation

---

## 🔧 Environment Variables

| Variable | Description | Required | Default |
|---|---|---|---|
| `ELECTRICITY_MAPS_TOKEN` | API token from electricitymaps.com | ✅ Yes | — |
| `AWS_REGION` | Target deployment AWS region | ✅ Yes | — |
| `CARBON_THRESHOLD` | gCO₂/kWh above which deploys are held | ❌ No | `250` |
| `CARBON_GREEN_THRESHOLD` | gCO₂/kWh below which grid is "very green" | ❌ No | `150` |
| `URGENCY_OVERRIDE` | `true` to bypass carbon check entirely | ❌ No | `false` |
| `SQS_QUEUE_URL` | SQS queue URL for held deployment jobs | ⚠️ Conditional | — |
| `S3_CARBON_BUCKET` | S3 bucket for deployment carbon logs | ⚠️ Conditional | — |
| `GITHUB_TOKEN` | GitHub token for workflow re-triggering | ❌ No | Auto-set in Actions |
| `ELECTRICITY_MAPS_TIMEOUT` | API request timeout in seconds | ❌ No | `10` |
| `ELECTRICITY_MAPS_RETRIES` | Max API retry attempts | ❌ No | `3` |
| `CARBON_CACHE_TTL` | Cache TTL in seconds | ❌ No | `300` |
| `ENABLE_CARBON_CACHE` | Enable in-memory caching | ❌ No | `true` |
| `LOG_LEVEL` | Logging verbosity | ❌ No | `INFO` |

---

## 🛠 Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **CI/CD Hook** | [GitHub Actions](https://github.com/features/actions) Composite Action | Carbon gate integration |
| **Carbon Data** | [Electricity Maps API](https://www.electricitymaps.com/) v3 | Real-time grid intensity |
| **Decision Engine** | Python 3.11 | Scheduler with configurable thresholds |
| **Message Queue** | AWS SQS | Held deployment buffer |
| **Serverless Poller** | AWS Lambda (Python 3.11) | Auto-retry every 30 min |
| **Event Trigger** | Amazon EventBridge | Lambda schedule: `rate(30 min)` |
| **Data Storage** | AWS S3 (versioned) | Carbon logs + dashboard hosting |
| **Secrets** | AWS Secrets Manager | API token storage |
| **Dashboard** | React 18 + Recharts | Carbon telemetry visualization |
| **AI Insights** | Groq Cloud (Llama 3 / Mixtral) | Carbon audit & optimization reports |
| **Infrastructure** | Terraform (AWS ~>5.0) | One-click stack deployment |
| **Testing** | pytest + moto | Unit & integration tests |
| **Container** | Docker (Alpine) | Build step in workflows |

---

## 🌐 AWS Region → Grid Zone Mapping

| AWS Region | Electricity Maps Zone | Grid | Notes |
|---|---|---|---|
| `us-east-1` | `US-MIDA-PJM` | PJM Interconnection | Virginia |
| `us-east-2` | `US-MIDW-MISO` | MISO | Ohio |
| `us-west-1` | `US-CA-NEVP` | NEVP | California |
| `us-west-2` | `US-NW-PACW` | Pacific West | Oregon |
| `eu-west-1` | `IE` | Irish Grid | Ireland |
| `eu-west-2` | `GB` | UK Grid | London |
| `eu-central-1` | `DE` | German Grid | Frankfurt |
| `eu-north-1` | `SE` | Swedish Grid | Stockholm |
| `ap-southeast-1` | `SG` | Singapore Grid | Singapore |
| `ap-southeast-2` | `AU-NSW` | New South Wales | Sydney |
| `ap-northeast-1` | `JP-KN` | Kansai | Tokyo |
| `ap-south-1` | `IN-SO` | Southern India | Mumbai |
| `sa-east-1` | `BR-CS` | Brazilian Grid | São Paulo |
| `ca-central-1` | `CA-ON` | Ontario | Montreal |

---

## ✅ Testing

```bash
# Install test dependencies
pip install -r requirements.txt

# Run all tests with coverage
pytest tests/ -v --cov=src

# Run specific test modules
pytest tests/test_fetcher.py -v
pytest tests/test_scheduler.py -v
```

### Test Coverage

| Module | Tests |
|---|---|
| **Carbon Fetcher** (`test_fetcher.py`) | Region mapping validation, API response parsing, mock data generation, error handling, cache behavior |
| **Decision Engine** (`test_scheduler.py`) | DEPLOY_NOW at various intensities, HOLD thresholds, OVERRIDE bypass, rollback safety, CO₂ estimation, JSON output format |

---

## 📁 Project Structure

```
carbon-aware-scheduler/
├── .github/
│   ├── actions/
│   │   └── carbon-gate/
│   │       └── action.yml              # 🔌 Composite GitHub Action
│   └── workflows/
│       └── deploy.yml                  # 📋 Example CI/CD pipeline
├── src/
│   ├── config.py                       # ⚙️ Centralized configuration
│   ├── cache.py                        # 💾 TTL-based in-memory cache
│   ├── logging_config.py               # 📝 Structured logging setup
│   ├── fetcher/
│   │   └── carbon_fetcher.py           # 🌐 Electricity Maps API client
│   ├── scheduler/
│   │   └── scheduler.py                # 🧠 Decision engine (core logic)
│   ├── deploy_queue/
│   │   ├── queue_manager.py            # 📨 SQS enqueue + S3 logging
│   │   └── lambda_poller.py            # ⚡ Lambda re-check handler
│   └── dashboard/                      # 📊 React + Recharts dashboard
│       ├── public/
│       └── src/
├── infra/
│   └── terraform/
│       └── main.tf                     # 🏗️ AWS infrastructure (SQS, Lambda, S3, IAM)
├── tests/
│   ├── conftest.py                     # 🧪 Pytest configuration
│   ├── test_fetcher.py                 # Fetcher unit tests
│   └── test_scheduler.py               # Scheduler unit tests
├── scripts/
│   ├── setup.sh                        # 🔧 One-shot environment setup
│   └── run_live_demo.py                # 🎮 Multi-region demo script
├── requirements.txt                    # 📦 Python dependencies
├── Dockerfile                          # 🐳 Build step container
├── example_usage.py                    # 📖 Usage examples
├── DEPLOYMENT_GUIDE.md                 # 📘 Deployment checklist & guide
└── README.md                           # 📄 This file
```

---

## 📄 License

```
MIT License

Copyright (c) 2026 Jacksonfio

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

<p align="center">
  <strong>🌱 Deploy Greener. Compute Cleaner. 🌍</strong>
</p>
