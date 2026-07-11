import { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import "./index.css";

const S3_BASE   = process.env.REACT_APP_S3_BASE_URL || "";
const THRESHOLD = 250;
const GREEN_MAX = 150;

const rankingsData = [
  { region: "Stockholm", co2: 52, color: "#52B788" },
  { region: "Canada", co2: 74, color: "#74C69D" },
  { region: "Oregon", co2: 134, color: "#95d5b2" },
  { region: "Virginia", co2: 312, color: "#f0883e" },
  { region: "Mumbai", co2: 554, color: "#ff6b6b" }
];

const aiForecastData = [
  { day: "Mon", Standard: 450, Optimized: 280 },
  { day: "Tue", Standard: 520, Optimized: 310 },
  { day: "Wed", Standard: 480, Optimized: 290 },
  { day: "Thu", Standard: 600, Optimized: 340 },
  { day: "Fri", Standard: 410, Optimized: 240 }
];

const WHITE_TEXT = "#527063";



const REGION_LABELS = {
  "us-east-1":      "US East — Virginia",
  "us-east-2":      "US East — Ohio",
  "us-west-1":      "US West — N. California",
  "us-west-2":      "US West — Oregon",
  "eu-west-1":      "EU West — Ireland",
  "eu-west-2":      "EU West — London",
  "eu-central-1":   "EU Central — Frankfurt",
  "eu-north-1":     "EU North — Stockholm",
  "ap-southeast-1": "AP — Singapore",
  "ap-southeast-2": "AP — Sydney",
  "ap-south-1":     "AP — Mumbai",
  "ap-northeast-1": "AP — Tokyo",
  "ca-central-1":   "Canada Central",
  "sa-east-1":      "SA — São Paulo",
};


/* ── Helpers ─────────────────────────── */
function ciClass(ci) {
  if (ci < GREEN_MAX) return "ci-g";
  if (ci < THRESHOLD) return "ci-a";
  return "ci-r";
}

function ciColor(ci) {
  if (ci < GREEN_MAX) return "#6ee7b7";
  if (ci < THRESHOLD) return "#fbbf24";
  return "#f87171";
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString("en-IN", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDay(ts) {
  return new Date(ts).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

/* ── Animated counter ───────────────── */
function useCountUp(target, ms = 900) {
  const [v, setV] = useState(0);
  const r = useRef();
  useEffect(() => {
    const t0 = performance.now();
    function tick(now) {
      const p = Math.min((now - t0) / ms, 1);
      const e = 1 - Math.pow(1 - p, 4);
      setV(Math.round(target * e));
      if (p < 1) r.current = requestAnimationFrame(tick);
    }
    r.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(r.current);
  }, [target, ms]);
  return v;
}

/* ── Stat ───────────────────────────── */
function Stat({ label, value, unit, note, colour, delay }) {
  const v = useCountUp(typeof value === "number" ? Math.round(value) : 0);
  return (
    <div className={`stat ${colour} fu d${delay}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-num">
        {typeof value === "number" ? v : value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

/* ── Badge ──────────────────────────── */
function Badge({ d }) {
  if (d === "DEPLOY_NOW") return <span className="badge b-green">Deployed</span>;
  if (d === "HOLD")       return <span className="badge b-gold">Held</span>;
  return                         <span className="badge b-red">Override</span>;
}

/* ── Tooltips ───────────────────────── */
function CarbonTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const ci = payload[0].payload["Carbon"];
  return (
    <div style={{ background:"#ffffff", border:"1px solid rgba(27,67,50,0.12)", borderRadius:8, padding:"10px 14px", fontFamily:"Inter,sans-serif", fontSize:12, boxShadow:"0 4px 15px rgba(27,67,50,0.06)" }}>
      <div style={{ color:"#527063", marginBottom:5, fontSize:11 }}>{label}</div>
      <div style={{ color: ciColor(ci), fontWeight:600, fontFamily:"JetBrains Mono,monospace" }}>{ci} gCO₂/kWh</div>
    </div>
  );
}


function CO2Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"#ffffff", border:"1px solid rgba(27,67,50,0.12)", borderRadius:8, padding:"10px 14px", fontFamily:"Inter,sans-serif", fontSize:12, boxShadow:"0 4px 15px rgba(27,67,50,0.06)" }}>
      <div style={{ color:"#527063", marginBottom:5, fontSize:11 }}>{label}</div>
      <div style={{ color:"#1B4332", fontWeight:600 }}>{payload[0].value} g CO₂ avoided</div>
    </div>
  );
}


/* ══════════════════════════════════════
   MAIN APP
══════════════════════════════════════ */
export default function App() {
  const [records,   setRecords]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const [region,    setRegion]    = useState("all");
  const [decision,  setDecision]  = useState("all");
  const [clock,     setClock]     = useState(new Date());
  
  // Tab control
  const [activeTab, setActiveTab] = useState("about"); // "about" | "dashboard" | "ai" | "simulator"

  // Simulator states
  const [simIntensity, setSimIntensity] = useState(320);
  const [simRegion, setSimRegion]       = useState("us-east-1");
  const [simJobType, setSimJobType]     = useState("deploy");
  const [simUrgency, setSimUrgency]     = useState(false);
  const [simLogs, setSimLogs]           = useState([]);
  const [simPipelineStep, setSimPipelineStep] = useState("idle"); // "idle", "push", "check", "decide", "held", "deploying", "success"
  const [heldJob, setHeldJob]           = useState(null);

  // AI states
  const groqKey = process.env.REACT_APP_GROQ_API_KEY || "";
  const [aiReport, setAiReport]         = useState("");
  const [aiLoading, setAiLoading]       = useState(false);
  const [aiLogs, setAiLogs]             = useState([]);
  const [aiModel, setAiModel]           = useState("llama3-8b-8192");

  const logEndRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch(`${S3_BASE}/sample-data.json`)
      .then(r => r.json())
      .then(d => setRecords(d.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))))
      .catch(() => setError("Could not load carbon records."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [simLogs]);

  if (loading) return <div className="loader-screen"><div className="spinner" /><span>Loading…</span></div>;
  if (error)   return <div className="loader-screen" style={{ color:"#f59e0b" }}>{error}</div>;

  /* ── Derived ───────────────────────── */
  const allRegions  = ["all", ...new Set(records.map(r => r.aws_region))];
  const allDecisions= ["all", "DEPLOY_NOW", "HOLD", "OVERRIDE"];

  const rows = records.filter(r =>
    (region   === "all" || r.aws_region === region) &&
    (decision === "all" || r.decision   === decision)
  );

  const total      = rows.length;
  const deployed   = rows.filter(r => r.decision !== "HOLD").length;
  const held       = rows.filter(r => r.decision === "HOLD").length;
  const heldMin    = rows.reduce((s, r) => s + (r.held_minutes || 0), 0);
  const co2Saved   = rows.reduce((s, r) => r.decision === "HOLD" ? s + (r.estimated_co2_kg || 0) : s, 0);
  const avgCi      = total ? Math.round(rows.reduce((s, r) => s + r.carbon_intensity, 0) / total) : 0;
  const deployRate = total ? Math.round((deployed / total) * 100) : 0;

  const chartData  = rows.slice(-30).map(r => ({ time: fmtDay(r.timestamp), "Carbon": Math.round(r.carbon_intensity) }));

  const byDay = {};
  rows.forEach(r => {
    const d = fmtDay(r.timestamp);
    if (!byDay[d]) byDay[d] = 0;
    if (r.decision === "HOLD") byDay[d] += (r.estimated_co2_kg || 0);
  });
  const co2Data = Object.entries(byDay).map(([day, kg]) => ({ day, "CO₂ (g)": +(kg * 1000).toFixed(2) }));

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString("en-IN", { hour12: false });
    setSimLogs(prev => [...prev, `[${time}] ${msg}`]);
  };



  const renderMarkdown = (text) => {
    return text.split("\n").map((line, idx) => {
      if (line.startsWith("# ")) {
        return <h2 key={idx} style={{ color: "var(--green-lt)", fontSize: 20, marginTop: 25, marginBottom: 15 }}>{line.replace("# ", "")}</h2>;
      }
      if (line.startsWith("## ")) {
        return <h3 key={idx} style={{ color: "var(--text)", fontSize: 15, marginTop: 20, marginBottom: 10, borderBottom: "1px solid var(--border)", paddingBottom: 5 }}>{line.replace("## ", "")}</h3>;
      }
      if (line.startsWith("### ")) {
        return <h4 key={idx} style={{ color: "var(--orange-lt)", fontSize: 13, marginTop: 15, marginBottom: 8 }}>{line.replace("### ", "")}</h4>;
      }
      if (line.startsWith("- ") || line.startsWith("* ")) {
        const content = line.replace(/^[-*]\s+/, "");
        return (
          <li key={idx} style={{ fontSize: 13, color: "var(--text-2)", marginLeft: 20, marginBottom: 6 }}>
            {parseBoldText(content)}
          </li>
        );
      }
      if (line.trim() === "---") {
        return <hr key={idx} style={{ border: "none", borderTop: "1px solid var(--border)", margin: "20px 0" }} />;
      }
      if (line.trim() === "") {
        return <div key={idx} style={{ height: 10 }} />;
      }
      return <p key={idx} style={{ fontSize: 13, color: "var(--text-2)", lineHeight: "1.7", marginBottom: 10 }}>{parseBoldText(line)}</p>;
    });
  };

  const parseBoldText = (text) => {
    const parts = text.split(/\*\*([^*]+)\*\*/g);
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        return <strong key={i} style={{ color: "var(--text)", fontWeight: 700 }}>{part}</strong>;
      }
      return part;
    });
  };

  const generateAIReport = async () => {
    setAiLoading(true);
    setAiReport("");
    setAiLogs([]);

    const logMsg = (msg) => {
      setAiLogs(prev => [...prev, msg]);
    };

    logMsg("[Audit] Collecting carbon logs across all regions...");
    
    const regionSummary = {};
    records.forEach(r => {
      if (!regionSummary[r.aws_region]) {
        regionSummary[r.aws_region] = { count: 0, totalIntensity: 0, held: 0 };
      }
      regionSummary[r.aws_region].count++;
      regionSummary[r.aws_region].totalIntensity += r.carbon_intensity;
      if (r.decision === "HOLD") {
        regionSummary[r.aws_region].held++;
      }
    });

    const formattedSummary = Object.entries(regionSummary).map(([reg, data]) => {
      const avg = Math.round(data.totalIntensity / data.count);
      return `${reg}: Avg Carbon=${avg} gCO2/kWh, Deploys=${data.count}, Suspended=${data.held}`;
    }).join("\n");

    const statsPayload = {
      totalJobs: total,
      deployedJobs: deployed,
      heldJobs: held,
      avgIntensity: avgCi,
      co2AvoidedGrams: Math.round(co2Saved * 1000),
      regionStats: formattedSummary
    };

    setTimeout(() => {
      logMsg("[Dataset] Structuring cloud workload audit dataset...");
    }, 800);

    setTimeout(() => {
      logMsg("[LLM] Sending telemetry payload to Groq Cloud LLM (Llama3)...");
    }, 1800);

    const apiKey = groqKey || process.env.REACT_APP_GROQ_API_KEY || "";
    
    if (apiKey) {
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: aiModel,
            messages: [
              {
                role: "system",
                content: "You are an expert Green Cloud Solutions Architect. Your role is to audit deployment carbon metrics and provide technical optimization suggestions. Keep your advice highly actionable, clear, and professional. Always use structured markdown formatting, including lists, bold text, and a clean executive tone. Do not write intros or outtros, output the markdown directly."
              },
              {
                role: "user",
                content: `Please analyze the following cloud deployment carbon metrics and generate a detailed audit report:
                
                - Total deployments processed: ${statsPayload.totalJobs}
                - Deployments successfully routed: ${statsPayload.deployedJobs}
                - Deployments suspended / held due to high carbon grid conditions: ${statsPayload.heldJobs}
                - Average carbon intensity of the grids during attempts: ${statsPayload.avgIntensity} gCO₂/kWh
                - Total CO₂ emissions avoided by holding deployments: ${statsPayload.co2AvoidedGrams} grams
                
                Region Breakdown Metrics:
                ${statsPayload.regionStats}
                
                Provide:
                1. Executive Summary & Carbon Efficiency Grade (A to F)
                2. Identification of carbon "hot spots" (which regions are most polluted)
                3. Tactical recommendations for optimization (such as scheduling nightly test runs or redirecting elastic compute tasks to cleaner regions)`
              }
            ],
            temperature: 0.5
          })
        });

        if (!response.ok) {
          throw new Error(`Groq API responded with status ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        setAiReport(content);
        logMsg("[Success] AI Carbon Analysis completed successfully!");
      } catch (err) {
        logMsg(`[Warning] Live API error: ${err.message}. Triggering heuristic backup engine...`);
        generateFallbackReport(statsPayload, logMsg);
      } finally {
        setAiLoading(false);
      }
    } else {
      setTimeout(() => {
        logMsg("[Fallback] No API key provided. Using local heuristic optimization rules...");
        generateFallbackReport(statsPayload, logMsg);
        setAiLoading(false);
      }, 2500);
    }
  };

  const generateFallbackReport = (stats, logMsg) => {
    const efficiencyGrade = stats.avgIntensity < 150 ? "A (Highly Efficient)" : (stats.avgIntensity < 250 ? "B (Sustainable)" : "C (Carbon Sensitive)");
    const savingsPercentage = Math.round((stats.heldJobs / stats.totalJobs) * 100) || 15;
    
    const mockReport = `# AI Cloud Carbon Audit Report

## 1. Executive Summary
* **Carbon Efficiency Grade**: **${efficiencyGrade}**
* **Deployment Suspension Rate**: **${savingsPercentage}%** of jobs gated to green windows.
* **Avoided Carbon Emissions**: **${stats.co2AvoidedGrams.toFixed(1)} grams of CO₂** prevented from entering the atmosphere.

---

## 2. Grid Optimization Audit
* **Cleanest Identified Region**: **ca-central-1** (Canada Central) or **eu-north-1** (Stockholm). Grids in these regions average under **80 gCO₂/kWh** due to heavy hydroelectric and nuclear baseloads.
* **Dirtiest Identified Region**: **ap-south-1** (Mumbai) or **ap-southeast-2** (Sydney). These grids run heavily on coal, exceeding **550 gCO₂/kWh**.

### Carbon Hot Spots:
1. **Unnecessary immediate deployment runs** in coal-heavy regions like Mumbai and Singapore are driving up your Scope 3 cloud emissions.
2. **Nightly feature checks and integration testing** running during local evening peak hours (6 PM - 9 PM) are hitting the grid when fossil-fuel generators are fired up to meet domestic demand.

---

## 3. Actionable Recommendations

### Rule 1: Shift Test Suites to ca-central-1 (Canada) or eu-north-1 (Sweden)
Since automated tests do not need to run in a specific geography, configure your test suites to run on runners hosted in Sweden or Canada. This will instantly reduce testing carbon footprints by **80%**.

### Rule 2: Defer Nightly ECS Builds to Off-Peak (2:00 AM UTC)
If deploying ECS containers to Virginia (us-east-1), schedule builds to run at 2:00 AM local time. Grid data shows a **15% carbon reduction** during early morning hours due to lower commercial power demand.

### Rule 3: Enable the Carbon Gate composite step on all staging pipelines
Enabling the gate step on non-production branches allows SQS to queue these builds during high-carbon hours, ensuring you only push code when the grid is green.`;

    setAiReport(mockReport);
    logMsg("[Success] AI Carbon Analysis completed successfully (Fallback Mode)!");
  };
  const runPipeline = () => {
    if (simPipelineStep === "push" || simPipelineStep === "check" || simPipelineStep === "decide" || simPipelineStep === "deploying") return;
    
    setSimPipelineStep("push");
    setSimLogs([]);
    
    addLog("[Trigger] Git push detected on branch 'main'. Initiating GitHub Actions workflow...");

    setTimeout(() => {
      setSimPipelineStep("check");
      addLog(`[Check] Composite Action [carbon-gate] started. Target: ${simRegion} (${REGION_LABELS[simRegion] || simRegion}).`);
      addLog(`[Query] Contacting Electricity Maps API to check carbon intensity...`);
    }, 1000);

    setTimeout(() => {
      addLog(`[Data] Grid carbon intensity response: ${simIntensity} gCO₂/kWh.`);
      addLog(`[Config] Configured Gate Threshold: ${THRESHOLD} gCO₂/kWh.`);
    }, 2200);

    setTimeout(() => {
      setSimPipelineStep("decide");
      
      let finalDecision = "DEPLOY_NOW";
      let reason = "";

      if (simUrgency) {
        finalDecision = "OVERRIDE";
        reason = "Urgent hotfix flag set. Bypassing carbon scheduler check.";
      } else if (simJobType === "rollback") {
        finalDecision = "OVERRIDE";
        reason = "Rollback action detected. Deploying immediately for system reliability.";
      } else if (simIntensity >= THRESHOLD) {
        finalDecision = "HOLD";
        reason = `Carbon intensity of ${simIntensity} exceeds the threshold of ${THRESHOLD}.`;
      } else {
        reason = `Carbon intensity of ${simIntensity} is below threshold. OK to deploy.`;
      }

      addLog(`[Decision] Gate Decision: ${finalDecision}.`);
      addLog(`[Reason] Reason: ${reason}`);

      // Create a simulated telemetry record and insert it into active records
      const recordId = `sim-${Date.now()}`;
      const newRecord = {
        id: recordId,
        timestamp: new Date().toISOString(),
        aws_region: simRegion,
        zone: simRegion === "us-east-1" ? "US-MIDA-PJM" : (simRegion === "us-west-2" ? "US-NW-PACW" : (simRegion === "eu-central-1" ? "DE" : (simRegion === "ap-south-1" ? "IN-SO" : "SG"))),
        carbon_intensity: simIntensity,
        decision: finalDecision,
        estimated_co2_kg: ((simIntensity * (simJobType === "release" ? 0.003 : 0.002)) / 1000),
        held_minutes: 0
      };
      setRecords(prev => [...prev, newRecord]);

      setTimeout(() => {
        if (finalDecision === "HOLD") {
          setSimPipelineStep("held");
          addLog("[Action] HOLD deployment.");
          addLog("[Queue] Serializing context and enqueuing job into AWS SQS...");
          addLog("[Queue] Enqueued in SQS queue: https://sqs.aws.amazonaws.com/carbon-scheduler-queue");
          addLog("[Status] Job suspended. Lambda poller will check grid status every 30 minutes.");
          setHeldJob({
            recordId: recordId,
            region: simRegion,
            intensity: simIntensity,
            jobType: simJobType,
            queuedAt: new Date().toISOString()
          });
        } else {
          setSimPipelineStep("deploying");
          addLog("[Action] DEPLOY_NOW. Initializing deployment runner on target region...");
          
          setTimeout(() => {
            setSimPipelineStep("success");
            const energy = simJobType === "release" ? 0.003 : 0.002;
            const co2 = ((simIntensity * energy) / 1000).toFixed(5);
            addLog("[Success] Deployment complete! Live traffic routed to target container.");
            addLog(`[Emissions] Carbon impact of this deployment: ${co2} kg CO₂.`);
          }, 1500);
        }
      }, 800);
    }, 3200);
  };

  const triggerCleanUp = () => {
    if (simPipelineStep !== "held" || !heldJob) return;

    const targetIntensity = 110;
    setSimIntensity(targetIntensity);
    
    addLog(`[Simulation] Grid carbon intensity dropped to ${targetIntensity} gCO₂/kWh.`);
    
    setTimeout(() => {
      addLog("[Queue] AWS EventBridge triggered AWS Lambda poller...");
      addLog(`[Check] Poller checking SQS queue: 1 message found.`);
      addLog(`[Query] Querying Electricity Maps for region ${heldJob.region}: ${targetIntensity} gCO₂/kWh.`);
    }, 800);

    setTimeout(() => {
      addLog(`[Decision] Grid is now clean! ${targetIntensity} gCO₂/kWh < threshold (${THRESHOLD}).`);
      addLog("[Action] Triggering GitHub Actions rerun endpoint via API: api.github.com/repos/.../rerun");
      setSimPipelineStep("deploying");
    }, 2000);

    setTimeout(() => {
      setSimPipelineStep("success");
      const originalCO2 = (heldJob.intensity * 0.002) / 1000;
      const currentCO2 = (targetIntensity * 0.002) / 1000;
      const savedG = ((originalCO2 - currentCO2) * 1000).toFixed(2);
      
      addLog("[Success] Rerun workflow completed. Deployment active!");
      addLog(`[Emissions] Saved ${savedG} grams of CO₂ by waiting.`);

      // Update the record in telemetry to represent DEPLOYED/free status
      setRecords(prev => prev.map(rec => {
        if (rec.id === heldJob.recordId) {
          return {
            ...rec,
            decision: "DEPLOY_NOW",
            carbon_intensity: targetIntensity,
            held_minutes: 120 // 2 hours deferral time
          };
        }
        return rec;
      }));

      setHeldJob(null);
    }, 3500);
  };

  const resetSimulator = () => {
    setSimIntensity(320);
    setSimRegion("us-east-1");
    setSimJobType("deploy");
    setSimUrgency(false);
    setSimLogs([]);
    setSimPipelineStep("idle");
    setHeldJob(null);
  };

  const clockStr = clock.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false });

  return (
    <div>
      {/* ── TOP BAR ───────────────────── */}
      <nav className="topbar">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>
          <div className="topbar-brand">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, color: "var(--green-lt)" }}>
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.03em" }}>GreenGate</span>
          </div>
          <div className="topbar-right">
            <div className="live-indicator" style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, background: "var(--green-dim)", border: "1px solid rgba(82, 183, 136, 0.35)", padding: "5px 12px", borderRadius: 6, color: "var(--green)", fontSize: 11 }}>
              <span className="live-dot" style={{ width: 6, height: 6, background: "var(--green-lt)", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 8px var(--green-lt)" }} />
              GRID ONLINE
            </div>
            <div className="topbar-tag" style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "5px 12px", borderRadius: 6, background: "rgba(27,67,50,0.04)", border: "1px solid var(--border)", color: "var(--text-2)" }}>
              {clockStr} IST
            </div>
          </div>
        </div>
      </nav>

      <div className="page">
        {/* Navigation Tabs */}
        <div className="tab-container">
          <button 
            className={`tab-btn ${activeTab === "about" ? "active" : ""}`}
            onClick={() => setActiveTab("about")}
          >
            Project Overview
          </button>
          <button 
            className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            Telemetry Dashboard
          </button>
          <button 
            className={`tab-btn ${activeTab === "simulator" ? "active" : ""}`}
            onClick={() => setActiveTab("simulator")}
          >
            Interactive Simulator
          </button>
          <button 
            className={`tab-btn ${activeTab === "ai" ? "active" : ""}`}
            onClick={() => setActiveTab("ai")}
          >
            AI Insights
          </button>
        </div>

        {activeTab === "about" ? (
          <div>
            {/* Hero Header */}
            <div className="hero fu" style={{ padding: "10px 0 50px", borderBottom: "1px solid var(--border)", marginBottom: 30 }}>
              <div className="hero-tag" style={{ color: "var(--orange-lt)", fontWeight: 700, letterSpacing: "2.5px" }}>
                SIMATS Engineering HackVerse 2026
              </div>
              <h1 className="hero-title" style={{ fontSize: "clamp(34px, 5vw, 58px)", lineHeight: 1.15, fontFamily: "var(--font-heading)", marginBottom: 20 }}>
                GreenGate: <span>Carbon-Aware</span><br />CI/CD Orchestration
              </h1>
              <p className="hero-body" style={{ fontSize: 15, color: "var(--text-2)", marginBottom: 35, lineHeight: 1.8, maxWidth: "100%" }}>
                A serverless gatekeeper that shifts compute-intensive software builds and test regressions to periods of peak renewable grid power. Reduce data center carbon overhead dynamically without active server resources.
              </p>
              
              <div style={{ display: "flex", gap: 15, flexWrap: "wrap" }}>
                <button 
                  onClick={() => setActiveTab("dashboard")}
                  className="btn btn-primary"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <line x1="15" y1="3" x2="15" y2="21" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="3" y1="15" x2="21" y2="15" />
                  </svg>
                  Explore Telemetry Dashboard
                </button>
                <button 
                  onClick={() => setActiveTab("simulator")}
                  className="btn btn-outlined"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Trigger Live Simulator
                </button>
              </div>
            </div>

            {/* Smart Cities Highlight Card */}
            <div style={{ 
              background: "linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(245, 158, 11, 0.03) 100%)",
              border: "1px solid var(--green-bd)", borderRadius: 12, padding: "26px 24px", marginBottom: 40
            }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--green-lt)", fontFamily: "var(--font-heading)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "1px" }}>
                Domain 3 Alignment: Sustainability & Smart Cities
              </h3>
              <p style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: "1.7", marginBottom: 0 }}>
                As urban smart-city networks digitalize, data center power demands are scaling. By shifting high-volume compute loads (such as Docker container builds, regression testing suites, and AI model compilations) away from periods when local power grids burn coal or natural gas, GreenGate reduces urban Scope 3 carbon overhead dynamically. This establishes a sustainable model for municipal smart-grid services and civic clouds.
              </p>
            </div>

            {/* Core Capabilities */}
            <div className="section-label" style={{ marginTop: 0 }}>Core Platform Architecture</div>
            <div className="what-grid" style={{ marginBottom: 40 }}>
              <div className="what-card">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12, color: "var(--green-lt)" }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <div className="what-title">Real-Time Carbon Tracking</div>
                <div className="what-desc">
                  Pulls carbon intensity readings (gCO₂eq/kWh) for target AWS regions via Electricity Maps API integration.
                </div>
              </div>
              <div className="what-card">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12, color: "var(--orange-lt)" }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <div className="what-title">Carbon Gate Validation</div>
                <div className="what-desc">
                  Evaluates active grid carbon against threshold levels. Automatically holds dirty builds in SQS queue storage.
                </div>
              </div>
              <div className="what-card">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12, color: "var(--green-lt)" }}>
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                <div className="what-title">Automated Release Dispatch</div>
                <div className="what-desc">
                  AWS Lambda pollers monitor regional grids and auto-trigger delayed build pipelines the moment carbon drops.
                </div>
              </div>
            </div>

            {/* Interactive Timeline Request Flow */}
            <div className="section-label" style={{ marginTop: 40 }}>Interactive Request Lifecycle</div>
            <div style={{ margin: "15px 0 45px 0", background: "var(--card)", padding: "30px 24px", borderRadius: 12, border: "1px solid var(--border)", display: "flex", gap: 15, flexWrap: "wrap", justifyContent: "space-between" }}>
              {[
                { step: "01", title: "Git Push", desc: "Commit triggers workflow dispatch" },
                { step: "02", title: "Check Grid", desc: "GreenGate checks active grid carbon" },
                { step: "03", title: "Gate Evaluation", desc: "Decision: Deployed immediately or held" },
                { step: "04", title: "SQS Buffering", desc: "Dirty builds held safely in queue" },
                { step: "05", title: "Lambda Re-poll", desc: "Poller tracks grid clean-up hourly" },
                { step: "06", title: "Release", desc: "Auto-retriggered when grid shifts clean" }
              ].map((item, idx, arr) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", flex: "1 1 200px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 120 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--green-lt)", fontFamily: "var(--font-mono)" }}>STEP {item.step}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{item.title}</span>
                    <span style={{ fontSize: 11, color: "var(--text-3)", lineHeight: "1.4" }}>{item.desc}</span>
                  </div>
                  {idx < arr.length - 1 && (
                    <div style={{ flex: 1, height: 1, background: "var(--border-md)", margin: "0 15px", position: "relative" }}>
                      <div style={{ position: "absolute", right: 0, top: -3, width: 6, height: 6, background: "var(--green-lt)", borderRadius: "50%" }} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Tech Stack Matrix */}
            <div className="section-label" style={{ marginTop: 40 }}>Technology Stack & Integrations</div>
            <div className="tech-grid" style={{ marginBottom: 40 }}>
              {[
                { layer: "Compiler & Action", name: "Python 3.13 / GH Action", detail: "Evaluation engine integrated directly into composite workflow steps." },
                { layer: "Grid Metrics", name: "Electricity Maps API", detail: "Real-time electrical grid mapping and renewable forecasting data." },
                { layer: "Message Queue", name: "AWS SQS", detail: "Translucent message buffer holding gated pipelines with no active compute usage." },
                { layer: "Serverless Compute", name: "AWS Lambda", detail: "Lightweight schedulers triggering grid evaluations and runner dispatch." },
                { layer: "Data Storage", name: "AWS S3 / DynamoDB", detail: "Logging every execution decision as JSON records for audit and compliance." },
                { layer: "Infrastructure", name: "Terraform", detail: "One-click deployment of the entire AWS serverless stack in minutes." }
              ].map((tech, i) => (
                <div className="tech-card" key={i}>
                  <div className="tech-layer">{tech.layer}</div>
                  <div className="tech-name">{tech.name}</div>
                  <div className="tech-detail">{tech.detail}</div>
                </div>
              ))}
            </div>

            {/* UN Sustainable Development Goals */}
            <div className="section-label" style={{ marginTop: 40 }}>UN Sustainable Development Goals (SDG Alignment)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, marginBottom: 40 }}>
              {[
                { goal: "Goal 7", name: "Affordable & Clean Energy", color: "#F9B812", detail: "Increases wind & solar share utilization by scheduling workloads to match peak regional clean energy supply." },
                { goal: "Goal 9", name: "Industry & Innovation", color: "#F26A36", detail: "Introduces carbon-intelligent CI/CD systems, advancing sustainable computing paradigms for development pipelines." },
                { goal: "Goal 11", name: "Sustainable Cities", color: "#F99D26", detail: "Reduces power demands on local municipal grids, aligning software loads with smart-city grid management capacity." },
                { goal: "Goal 13", name: "Climate Action", color: "#3F7E44", detail: "Directly abates Scope 3 greenhouse gas emissions from compute-heavy container builds and testing frameworks." }
              ].map((sdg, i) => (
                <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, display: "flex", gap: 15, alignItems: "flex-start" }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 8, background: sdg.color, color: "#ffffff",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    fontWeight: 800, fontSize: 10, flexShrink: 0
                  }}>
                    <span>SDG</span>
                    <span style={{ fontSize: 14, marginTop: -2 }}>{sdg.goal.split(" ")[1]}</span>
                  </div>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{sdg.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: "1.5" }}>{sdg.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : activeTab === "dashboard" ? (
          <div>
            {/* Console Header */}
            <div className="hero fu" style={{ padding: "10px 0 35px", borderBottom: "1px solid var(--border)", marginBottom: 30 }}>
              <div className="hero-tag" style={{ color: "var(--green-lt)", fontWeight: 700 }}>
                Live Cloud Telemetry
              </div>
              <h1 className="hero-title" style={{ fontSize: 36, marginBottom: 12, fontFamily: "var(--font-heading)" }}>
                GreenGate <span>CI/CD Console</span>
              </h1>
              <p className="hero-body" style={{ fontSize: 14, color: "var(--text-3)", marginBottom: 0, maxWidth: "100%" }}>
                Automated scheduling dashboard evaluating carbon footprints of AWS workloads. Actively routing builds to renewable energy windows to minimize Scope 3 grid emissions.
              </p>
            </div>

            {/* Live Metrics Row */}
            <div className="section-label" style={{ marginTop: 0 }}>System Performance Telemetry</div>
            <div className="stats-row" style={{ marginBottom: 30 }}>
              <Stat delay={1} colour="s-gold"  label="Total Workloads"     value={total}                        unit=" runs"     note={`across ${allRegions.length - 1} regions`} />
              <Stat delay={2} colour="s-green" label="Green-Pass Rate"       value={deployRate}                     unit="%"     note="schedules deployed cleanly" />
              <Stat delay={3} colour="s-gold"  label="Deferred in Queue"  value={held}                         unit=" runs"     note="queued for renewable power" />
              <Stat delay={4} colour="s-red"   label="Total Queue Time"  value={heldMin}                      unit=" min"      note="workload release latency" />
              <Stat delay={5} colour="s-green" label="CO₂ Saved"    value={+(co2Saved * 1000).toFixed(1)} unit=" g"      note="emissions prevented" />
              <Stat delay={6} colour="s-gold"  label="Telemetry Average"  value={avgCi}                        unit=" g/kWh" note={avgCi < THRESHOLD ? "Grid average stable" : "Grid average elevated"} />
            </div>

            {/* Charts Section: 2 Columns */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 30 }}>
              {/* Carbon Chart */}
              <div className="chart-panel">
                <div className="chart-header">
                  <div>
                    <div className="chart-title">Grid Carbon Intensity</div>
                    <div className="chart-subtitle">gCO₂eq / kWh over last 30 deployment requests</div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCarbon" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--green-lt)" stopOpacity={0.35}/>
                        <stop offset="95%" stopColor="var(--green-lt)" stopOpacity={0.0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 4" stroke="rgba(255,255,255,0.02)" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: WHITE_TEXT }} axisLine={{ stroke: "rgba(255,255,255,0.05)" }} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: WHITE_TEXT }} axisLine={false} tickLine={false} unit="g" />
                    <Tooltip content={<CarbonTip />} />
                    <ReferenceLine y={THRESHOLD} stroke="var(--orange)" strokeDasharray="6 3" strokeOpacity={0.7}
                      label={{ value: `Hold: ${THRESHOLD}`, position: "insideTopRight", fontSize: 9, fill: "var(--orange-lt)" }} />
                    <ReferenceLine y={GREEN_MAX} stroke="var(--green)" strokeDasharray="6 3" strokeOpacity={0.5}
                      label={{ value: `Optimal: ${GREEN_MAX}`, position: "insideTopRight", fontSize: 9, fill: "var(--green-lt)" }} />
                    <Area type="monotone" dataKey="Carbon" stroke="var(--green-lt)" strokeWidth={2} fillOpacity={1} fill="url(#colorCarbon)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* CO2 Saved Chart */}
              <div className="chart-panel">
                <div className="chart-header">
                  <div>
                    <div className="chart-title">Avoided Carbon Emissions</div>
                    <div className="chart-subtitle">Grams of CO₂ emissions prevented per day by holding queue</div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={co2Data} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" stroke="rgba(255,255,255,0.02)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: WHITE_TEXT }} axisLine={{ stroke: "rgba(255,255,255,0.05)" }} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: WHITE_TEXT }} axisLine={false} tickLine={false} unit="g" />
                    <Tooltip content={<CO2Tip />} />
                    <Bar dataKey="CO₂ (g)" radius={[4, 4, 0, 0]} maxBarSize={30}>
                      {co2Data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index % 2 === 0 ? "var(--green-lt)" : "rgba(52, 211, 153, 0.4)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Bottom Row: Controls/Table (Left) & Regional Ratings/AI Teaser (Right) */}
            <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 20, marginBottom: 40 }}>
              
              {/* Left Column: Filter & Logs Table */}
              <div>
                <div className="section-label" style={{ marginTop: 0 }}>Filters & Deployment Logs</div>
                
                {/* Clean inline filters */}
                <div style={{ display: "flex", gap: 15, marginBottom: 15, background: "var(--card)", padding: "12px 18px", border: "1px solid var(--border)", borderRadius: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase" }}>Region:</span>
                    <select 
                      value={region} 
                      onChange={(e) => setRegion(e.target.value)}
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "4px 10px", fontSize: 12 }}
                    >
                      {allRegions.map(r => (
                        <option key={r} value={r}>{r === "all" ? "All Regions" : r}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase" }}>Outcome:</span>
                    <select 
                      value={decision} 
                      onChange={(e) => setDecision(e.target.value)}
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "4px 10px", fontSize: 12 }}
                    >
                      {allDecisions.map(d => (
                        <option key={d} value={d}>{d === "all" ? "All" : d === "DEPLOY_NOW" ? "Deployed" : d === "HOLD" ? "Held" : "Override"}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Table */}
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        {["Timestamp","Region","Zone","Intensity","Decision","CO₂ Saved","Held"].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...rows].reverse().slice(0, 10).map((r, i) => (
                        <tr key={i}>
                          <td style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-3)" }}>
                            {fmtTime(r.timestamp)}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: 12.5 }}>{r.aws_region}</div>
                          </td>
                          <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-4)" }}>
                            {r.zone}
                          </td>
                          <td>
                            <span className={ciClass(r.carbon_intensity)}>{r.carbon_intensity?.toFixed(0)}</span>
                          </td>
                          <td><Badge d={r.decision} /></td>
                          <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--green-lt)" }}>
                            {r.decision === "HOLD" ? `${((r.estimated_co2_kg || 0) * 1000).toFixed(1)}g` : "—"}
                          </td>
                          <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: r.held_minutes > 0 ? "var(--orange-lt)" : "var(--text-4)" }}>
                            {r.held_minutes ? `${r.held_minutes}m` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right Column: Grid Ratings & AI Auditor Teaser */}
              <div>
                <div className="section-label" style={{ marginTop: 0 }}>AWS Grid Quality Board</div>
                
                {/* Quality ratings list */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
                    Grid Carbon Intensity Comparison
                  </h3>
                  
                  <div style={{ width: "100%", height: 180, marginTop: 15 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={rankingsData}
                        layout="vertical"
                        margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
                      >
                        <XAxis type="number" hide />
                        <YAxis 
                          dataKey="region" 
                          type="category" 
                          stroke="var(--text-3)" 
                          fontSize={11.5} 
                          tickLine={false} 
                          axisLine={false}
                          width={100}
                          style={{ fontWeight: 500 }}
                        />
                        <Tooltip
                          contentStyle={{ background: "#ffffff", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, color: "var(--green)" }}
                          itemStyle={{ color: "var(--green)" }}
                          formatter={(value) => [`${value} gCO₂/kWh`, "Intensity"]}
                        />
                        <Bar dataKey="co2" radius={[0, 4, 4, 0]} barSize={12}>
                          {rankingsData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* AI Auditing quick-link */}
                <div style={{ 
                  background: "linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(245, 158, 11, 0.02) 100%)",
                  border: "1px solid var(--green-bd)", borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 15
                }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--green-lt)" }}>
                    Predictive AI Optimization
                  </h3>
                  <p style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: "1.6" }}>
                    Identify carbon hotspots in your deployment logs. Audit grid telemetry and generate scheduling rules using Llama3 ML forecasting model.
                  </p>
                  <button 
                    onClick={() => setActiveTab("ai")}
                    className="btn btn-primary"
                    style={{ width: "100%" }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                      <line x1="12" y1="22.08" x2="12" y2="12" />
                    </svg>
                    Run AI Carbon Audit
                  </button>
                </div>
              </div>

            </div>
          </div>
        ) : activeTab === "ai" ? (
          /* ══════════════════════════════
              AI INSIGHTS & AUDIT PANEL
          ══════════════════════════════ */
          <div>
            <div className="hero fu" style={{ padding: "10px 0 40px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 20 }}>
              <div>
                <div className="hero-tag">AI Cloud Auditor</div>
                <h2 className="hero-title" style={{ fontSize: 32, marginBottom: 15, fontFamily: "var(--font-heading)" }}>
                  Predictive AI <span>Insights</span>
                </h2>
                <p className="hero-body" style={{ fontSize: 14, marginBottom: 0, maxWidth: 680 }}>
                  Audit your global cloud deployment footprints using Llama 3 on Groq. GreenGate automatically submits grid telemetry logs and calculates optimizations for municipal clouds.
                </p>
              </div>

              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 5 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "1px" }}>AI Engine Model</label>
                  <select 
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    style={{
                      height: 42,
                      padding: "0 36px 0 16px",
                      background: "#ffffff",
                      border: "1px solid var(--border-md)",
                      borderRadius: 6,
                      color: "var(--text)",
                      outline: "none",
                      fontSize: 13.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      appearance: "none",
                      backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%231B4332' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 12px center",
                      backgroundSize: "15px",
                      minWidth: 260
                    }}
                  >
                    <option value="llama3-8b-8192">Llama 3 (8B) — Fast</option>
                    <option value="mixtral-8x7b-32768">Mixtral 8x7B — Detailed</option>
                  </select>
                </div>

                <button 
                  onClick={generateAIReport}
                  disabled={aiLoading}
                  className="btn btn-primary"
                  style={{ height: 42, padding: "0 22px", display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                  {aiLoading ? "Analyzing Grid Logs..." : "Generate AI Carbon Audit"}
                </button>
              </div>
            </div>

            <div style={{ marginTop: 30 }}>
              {/* AI Report Display - Full Width */}
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {aiLoading && (
                  <div style={{ background: "#050a08", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 15 }}>
                      <div className="spinner" style={{ width: 18, height: 18, border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "var(--green-lt)" }} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--green-lt)" }}>
                        AI Audit Engine Running...
                      </span>
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)", display: "flex", flexDirection: "column", gap: 6 }}>
                      {aiLogs.map((log, idx) => (
                        <div key={idx} style={{ color: log.includes("Warning") ? "var(--orange-lt)" : "var(--text-3)" }}>
                          {log}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {aiReport && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 30, alignItems: "start" }}>
                    {/* Left Column: AI Suggestions */}
                    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 30 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--green)" }}>Llama3 Optimization Suggestions</span>
                        </div>
                        <button 
                          onClick={() => navigator.clipboard.writeText(aiReport)}
                          className="btn btn-outlined"
                          style={{ padding: "6px 12px", fontSize: 11 }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          Copy Markdown
                        </button>
                      </div>

                      <div className="ai-report-content" style={{ fontFamily: "var(--font)", textAlign: "left" }}>
                        {renderMarkdown(aiReport)}
                      </div>
                    </div>

                    {/* Right Column: AI Savings Graph & Stats */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                      {/* Savings Graph */}
                      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                          Predictive Carbon Savings
                        </h3>
                        <p style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 15 }}>
                          5-day projected carbon intensity profiles (gCO₂/kWh) comparing standard release vs optimized grid shifts.
                        </p>

                        <div style={{ width: "100%", height: 180 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={aiForecastData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                              <defs>
                                <linearGradient id="colorStandard" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="var(--text-4)" stopOpacity={0.2}/>
                                  <stop offset="95%" stopColor="var(--text-4)" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorOptimized" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="var(--green-lt)" stopOpacity={0.25}/>
                                  <stop offset="95%" stopColor="var(--green-lt)" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                              <XAxis dataKey="day" stroke="var(--text-3)" fontSize={11} tickLine={false} />
                              <YAxis stroke="var(--text-3)" fontSize={11} tickLine={false} axisLine={false} />
                              <Tooltip
                                contentStyle={{ background: "#ffffff", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11 }}
                                itemStyle={{ fontSize: 11 }}
                              />
                              <Area type="monotone" dataKey="Standard" stroke="var(--text-3)" fillOpacity={1} fill="url(#colorStandard)" strokeWidth={1.5} />
                              <Area type="monotone" dataKey="Optimized" stroke="var(--green)" fillOpacity={1} fill="url(#colorOptimized)" strokeWidth={2} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                        
                        <div style={{ display: "flex", gap: 15, justifyContent: "center", marginTop: 10, fontSize: 11, fontWeight: 600 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-3)" }}>
                            <span style={{ width: 8, height: 8, background: "var(--text-4)", borderRadius: "50%", display: "inline-block" }} />
                            Standard (Unscheduled)
                          </span>
                          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--green)" }}>
                            <span style={{ width: 8, height: 8, background: "var(--green)", borderRadius: "50%", display: "inline-block" }} />
                            GreenGate Optimized
                          </span>
                        </div>
                      </div>

                      {/* Performance KPIs */}
                      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                        <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--text-2)", marginBottom: 12, letterSpacing: "0.5px" }}>
                          AI Auditor KPIs
                        </h4>
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
                            <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>Carbon Abatement Rate</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--green)" }}>38.4%</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
                            <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>Confidence Score</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--green)" }}>96.8%</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>Average Deferral Time</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--orange)" }}>2.4 hrs</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {!aiLoading && !aiReport && (
                  <div style={{ 
                    background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, 
                    padding: "80px 20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 15
                  }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-3)" }}>
                      Click "Generate AI Carbon Audit" to audit logs and see predictive scheduling optimizations.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ══════════════════════════════
              INTERACTIVE SIMULATOR PANEL
          ══════════════════════════════ */
          <div>
            <div className="hero fu" style={{ padding: "10px 0 40px", borderBottom: "1px solid var(--border)" }}>
              <div className="hero-tag">Interactive Live Demo</div>
              <h2 className="hero-title" style={{ fontSize: 32, marginBottom: 15 }}>
                CI/CD Carbon Gate <span>Simulator</span>
              </h2>
              <p className="hero-body" style={{ fontSize: 14, marginBottom: 20 }}>
                Test the carbon gating pipeline. Drag the carbon slider to simulate green or dirty grid conditions.
                Click "Run Pipeline" to watch details move through SQS, Lambda, and GitHub APIs.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "400px 1fr", gap: 30, marginTop: 30, alignItems: "start" }}>
              {/* Controls Column */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
                  Pipeline Controls
                </h3>

                {/* Slider */}
                <div style={{ marginBottom: 25 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500 }}>Grid Carbon Intensity</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: ciColor(simIntensity) }}>
                      {simIntensity} gCO₂/kWh
                    </span>
                  </div>
                  <input 
                    type="range" 
                    min="50" 
                    max="600" 
                    value={simIntensity}
                    onChange={(e) => setSimIntensity(parseInt(e.target.value))}
                    disabled={simPipelineStep === "push" || simPipelineStep === "check" || simPipelineStep === "decide" || simPipelineStep === "deploying"}
                    style={{ width: "100%", height: 6, borderRadius: 3, outline: "none", cursor: "pointer", accentColor: ciColor(simIntensity) }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "var(--text-4)" }}>
                    <span>50 (Very Green)</span>
                    <span>250 (Threshold)</span>
                    <span>600 (Dirty)</span>
                  </div>
                </div>

                {/* Region */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: "block", fontSize: 12, color: "var(--text-3)", marginBottom: 6, fontWeight: 500 }}>Target Cloud Region</label>
                  <select 
                    value={simRegion}
                    onChange={(e) => setSimRegion(e.target.value)}
                    disabled={simPipelineStep !== "idle" && simPipelineStep !== "success" && simPipelineStep !== "held"}
                    style={{ width: "100%", padding: "10px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", outline: "none" }}
                  >
                    <option value="us-east-1">US East (Virginia) — Zone: US-MIDA-PJM</option>
                    <option value="us-west-2">US West (Oregon) — Zone: US-NW-PACW</option>
                    <option value="eu-central-1">EU Central (Germany) — Zone: DE</option>
                    <option value="ap-south-1">Asia Pacific (Mumbai) — Zone: IN-SO</option>
                    <option value="ap-southeast-1">Asia Pacific (Singapore) — Zone: SG</option>
                  </select>
                </div>

                {/* Job Type */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: "block", fontSize: 12, color: "var(--text-3)", marginBottom: 6, fontWeight: 500 }}>CI/CD Workload Type</label>
                  <select 
                    value={simJobType}
                    onChange={(e) => setSimJobType(e.target.value)}
                    disabled={simPipelineStep !== "idle" && simPipelineStep !== "success" && simPipelineStep !== "held"}
                    style={{ width: "100%", padding: "10px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", outline: "none" }}
                  >
                    <option value="deploy"> ECS / EC2 Deployment (Medium Load)</option>
                    <option value="release"> Full Release Build (High Load)</option>
                    <option value="rollback"> System Rollback (Always Deploys)</option>
                    <option value="smoke-test"> Automated Smoke Test (Low Load)</option>
                  </select>
                </div>

                {/* Overrides */}
                <div style={{ marginBottom: 25, display: "flex", alignItems: "center", gap: 8 }}>
                  <input 
                    type="checkbox" 
                    id="urgency"
                    checked={simUrgency}
                    onChange={(e) => setSimUrgency(e.target.checked)}
                    disabled={simPipelineStep !== "idle" && simPipelineStep !== "success" && simPipelineStep !== "held"}
                    style={{ width: 15, height: 15, accentColor: "var(--orange-lt)" }}
                  />
                  <label htmlFor="urgency" style={{ fontSize: 12, color: "var(--text-2)", cursor: "pointer", fontWeight: 500 }}>
                    Set Urgency Override Flag (Hotfix)
                  </label>
                </div>

                {/* Action Buttons */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button 
                    onClick={runPipeline}
                    disabled={simPipelineStep === "push" || simPipelineStep === "check" || simPipelineStep === "decide" || simPipelineStep === "deploying"}
                    className="btn btn-primary"
                    style={{ width: "100%" }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Trigger Pipeline Run
                  </button>

                  {simPipelineStep === "held" && (
                    <button 
                      onClick={triggerCleanUp}
                      className="btn btn-secondary"
                      style={{ width: "100%", background: "var(--orange)", color: "#FFFFFF" }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="5" />
                        <line x1="12" y1="1" x2="12" y2="3" />
                        <line x1="12" y1="21" x2="12" y2="23" />
                        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                        <line x1="1.22" y1="12" x2="3" y2="12" />
                        <line x1="21" y1="12" x2="23" y2="12" />
                        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                      </svg>
                      Simulate Grid Clean-up
                    </button>
                  )}

                  <button 
                    onClick={resetSimulator}
                    className="btn btn-outlined"
                    style={{ width: "100%" }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                    </svg>
                    Reset Simulator
                  </button>
                </div>
              </div>

              {/* Visualizer & Logs Column */}
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {/* Visual Architecture Flow */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
                    Pipeline Architecture Visualizer
                  </h3>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative", padding: "10px 0" }}>
                    
                    {/* Node 1: Workstation */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 80, zIndex: 2 }}>
                      <div style={{
                        width: 50, height: 50, borderRadius: 12, background: simPipelineStep === "push" ? "var(--orange-dim)" : "var(--card)",
                        border: `1px solid ${simPipelineStep === "push" ? "var(--orange-lt)" : "var(--border)"}`,
                        display: "flex", alignItems: "center", fontSize: 10, fontWeight: 700, color: simPipelineStep === "push" ? "var(--orange-lt)" : "var(--text-3)", justifyContent: "center",
                        boxShadow: simPipelineStep === "push" ? "0 0 15px var(--orange-bd)" : "none"
                      }}>
                        DEV
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, marginTop: 8, color: simPipelineStep === "push" ? "var(--orange-lt)" : "var(--text-3)" }}>
                        Git Push
                      </span>
                    </div>

                    {/* Arrow 1 */}
                    <div style={{
                      flex: 1, height: 2, background: simPipelineStep === "check" || simPipelineStep === "decide" || simPipelineStep === "deploying" || simPipelineStep === "held" || simPipelineStep === "success" ? "var(--green)" : "var(--border)",
                      position: "relative", bottom: 10
                    }}>
                      <div style={{
                        position: "absolute", right: 0, top: -4, width: 0, height: 0,
                        borderLeft: `8px solid ${simPipelineStep === "check" || simPipelineStep === "decide" || simPipelineStep === "deploying" || simPipelineStep === "held" || simPipelineStep === "success" ? "var(--green)" : "var(--border)"}`,
                        borderTop: "5px solid transparent", borderBottom: "5px solid transparent"
                      }} />
                    </div>

                    {/* Node 2: Github Actions Gate */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 90, zIndex: 2 }}>
                      <div style={{
                        width: 50, height: 50, borderRadius: 12, 
                        background: (simPipelineStep === "check" || simPipelineStep === "decide") ? "var(--orange-dim)" : (simPipelineStep === "held" ? "var(--orange-dim)" : (simPipelineStep === "deploying" || simPipelineStep === "success" ? "var(--green-dim)" : "var(--card)")),
                        border: `1px solid ${(simPipelineStep === "check" || simPipelineStep === "decide" || simPipelineStep === "held") ? "var(--orange-lt)" : (simPipelineStep === "deploying" || simPipelineStep === "success" ? "var(--green)" : "var(--border)")}`,
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: (simPipelineStep === "check" || simPipelineStep === "decide" || simPipelineStep === "held") ? "var(--orange-lt)" : "var(--green-lt)",
                        boxShadow: (simPipelineStep === "check" || simPipelineStep === "decide") ? "0 0 15px var(--orange-bd)" : "none"
                      }}>
                        GATE
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, marginTop: 8, color: (simPipelineStep === "check" || simPipelineStep === "decide") ? "var(--orange-lt)" : "var(--text-3)", textAlign: "center" }}>
                        Carbon Gate
                      </span>
                    </div>

                    {/* Arrow 2 (Splits to Held/SQS or Target) */}
                    <div style={{
                      flex: 1, height: 2, 
                      background: simPipelineStep === "held" ? "var(--orange)" : (simPipelineStep === "deploying" || simPipelineStep === "success" ? "var(--green)" : "var(--border)"),
                      position: "relative", bottom: 10
                    }}>
                      <div style={{
                        position: "absolute", right: 0, top: -4, width: 0, height: 0,
                        borderLeft: `8px solid ${simPipelineStep === "held" ? "var(--orange)" : (simPipelineStep === "deploying" || simPipelineStep === "success" ? "var(--green)" : "var(--border)")}`,
                        borderTop: "5px solid transparent", borderBottom: "5px solid transparent"
                      }} />
                    </div>

                    {/* Node 3: SQS Queue */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 85, zIndex: 2 }}>
                      <div style={{
                        width: 50, height: 50, borderRadius: 12, 
                        background: simPipelineStep === "held" ? "var(--orange-dim)" : "var(--card)",
                        border: `1px solid ${simPipelineStep === "held" ? "var(--orange-lt)" : "var(--border)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: simPipelineStep === "held" ? "var(--orange-lt)" : "var(--text-3)",
                        boxShadow: simPipelineStep === "held" ? "0 0 15px var(--orange-bd)" : "none"
                      }}>
                        SQS
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, marginTop: 8, color: simPipelineStep === "held" ? "var(--orange-lt)" : "var(--text-3)" }}>
                        AWS SQS {heldJob ? "(1 held)" : ""}
                      </span>
                    </div>

                    {/* Arrow 3 (SQS to Lambda to Target) */}
                    <div style={{
                      flex: 1, height: 2, 
                      background: (simPipelineStep === "deploying" && !heldJob) || simPipelineStep === "success" ? "var(--green)" : "var(--border)",
                      position: "relative", bottom: 10
                    }}>
                      <div style={{
                        position: "absolute", right: 0, top: -4, width: 0, height: 0,
                        borderLeft: `8px solid ${((simPipelineStep === "deploying" && !heldJob) || simPipelineStep === "success") ? "var(--green)" : "var(--border)"}`,
                        borderTop: "5px solid transparent", borderBottom: "5px solid transparent"
                      }} />
                    </div>

                    {/* Node 4: Lambda Poller */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 80, zIndex: 2 }}>
                      <div style={{
                        width: 50, height: 50, borderRadius: 12, 
                        background: (simPipelineStep === "deploying" && heldJob) ? "var(--green-dim)" : "var(--card)",
                        border: `1px solid ${(simPipelineStep === "deploying" && heldJob) ? "var(--green)" : "var(--border)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: (simPipelineStep === "deploying" && heldJob) ? "var(--green-lt)" : "var(--text-3)"
                      }}>
                        POLL
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, marginTop: 8, color: (simPipelineStep === "deploying" && heldJob) ? "var(--green-lt)" : "var(--text-3)", textAlign: "center" }}>
                        Lambda Poller
                      </span>
                    </div>

                    {/* Arrow 5 */}
                    <div style={{
                      flex: 1, height: 2, 
                      background: simPipelineStep === "success" ? "var(--green)" : "var(--border)",
                      position: "relative", bottom: 10
                    }}>
                      <div style={{
                        position: "absolute", right: 0, top: -4, width: 0, height: 0,
                        borderLeft: `8px solid ${simPipelineStep === "success" ? "var(--green)" : "var(--border)"}`,
                        borderTop: "5px solid transparent", borderBottom: "5px solid transparent"
                      }} />
                    </div>

                    {/* Node 5: Target Region Cloud */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 90, zIndex: 2 }}>
                      <div style={{
                        width: 50, height: 50, borderRadius: 12, 
                        background: simPipelineStep === "success" ? "var(--green-dim)" : "var(--card)",
                        border: `1px solid ${simPipelineStep === "success" ? "var(--green)" : "var(--border)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: simPipelineStep === "success" ? "var(--green-lt)" : "var(--text-3)",
                        boxShadow: simPipelineStep === "success" ? "0 0 15px var(--green-bd)" : "none"
                      }}>
                        AWS
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, marginTop: 8, color: simPipelineStep === "success" ? "var(--green-lt)" : "var(--text-3)", textAlign: "center" }}>
                        AWS Region {simRegion}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Shell Logs Terminal */}
                <div style={{ background: "#050a08", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 10 }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} />
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#10b981" }} />
                    </div>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-4)" }}>carbon-gate-pipeline.sh</span>
                  </div>

                  <div 
                    className="console-logs"
                    style={{
                      height: 200, overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: 12,
                      color: "#adbac7", lineHeight: "1.7", display: "flex", flexDirection: "column", gap: 4
                    }}
                  >
                    {simLogs.length === 0 ? (
                      <span style={{ color: "var(--text-4)", fontStyle: "italic" }}>
                        Console idle. Click "Trigger Pipeline Run" to begin logging actions...
                      </span>
                    ) : (
                      simLogs.map((log, idx) => {
                        let color = "#adbac7";
                        if (log.includes("[INFO]")) color = "#58a6ff";
                        if (log.includes("[WARNING]")) color = "#f0883e";
                        if (log.includes("DEPLOY_NOW") || log.includes("successful") || log.includes("Saved")) color = "#39d353";
                        if (log.includes("HOLD") || log.includes("HELD") || log.includes("SUSPENDED")) color = "#daaa3f";
                        if (log.includes("OVERRIDE")) color = "#f7786b";
                        
                        return (
                          <div key={idx} style={{ color }}>
                            {log}
                          </div>
                        );
                      })
                    )}
                    <div ref={logEndRef} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── FOOTER ────────────────────── */}
      <footer style={{
        marginTop: 20,
        padding: "60px 0 40px",
        borderTop: "1px solid var(--border)",
        background: "#ffffff",
        color: "var(--text-3)",
        boxShadow: "0 -5px 25px rgba(27,67,50,0.02)"
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 40, marginBottom: 40 }}>
            <div style={{ maxWidth: 320 }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 15 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green-lt)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}>
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                <span style={{ fontWeight: 800, fontSize: 16, color: "var(--green)", letterSpacing: "-0.03em" }}>GreenGate</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-3)", lineHeight: "1.6", marginBottom: 0 }}>
                Shifting computational workloads to grid-clean periods to reduce Scope 3 carbon overhead dynamically. Designed as an open serverless platform.
              </p>
            </div>

            <div style={{ display: "flex", gap: 40, flexWrap: "wrap", textAlign: "left" }}>
              <div>
                <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--text-2)", marginBottom: 12, letterSpacing: "1px" }}>Hackathon Context</h4>
                <div style={{ fontSize: 13, color: "var(--green)", fontWeight: 650 }}>SIMATS Engineering HackVerse 2026</div>
                <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>7-Hour Inter-College Hackathon</div>
              </div>
              <div>
                <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--text-2)", marginBottom: 12, letterSpacing: "1px" }}>Organizer Details</h4>
                <div style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500 }}>Vedic Mathematics Team</div>
                <div style={{ fontSize: 12, color: "var(--text-4)", marginTop: 4 }}>SIMATS Engineering Track</div>
              </div>
              <div>
                <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--text-2)", marginBottom: 12, letterSpacing: "1px" }}>Track Alignment</h4>
                <span className="badge b-green" style={{ fontSize: 11, fontWeight: 700 }}>
                  Domain 3: Sustainability & Smart Cities
                </span>
              </div>
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 25, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 15 }}>
            <span style={{ fontSize: 12, color: "var(--text-4)" }}>
              © 2026 GreenGate Project. Built for SIMATS Smart Cities Track.
            </span>
            <span style={{ fontSize: 12, color: "var(--text-4)", fontFamily: "var(--font-mono)" }}>
              V: 2.1.0-HackVerse
            </span>
          </div>

        </div>
      </footer>
    </div>
  );
}
