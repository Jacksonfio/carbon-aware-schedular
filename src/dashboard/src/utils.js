/* 
  Dashboard utility functions for error handling, data loading, and formatting.
  Provides robust error boundaries and fallback UI for production reliability.
*/

/**
 * Error boundary component for catching React errors
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Dashboard error:", error, errorInfo);
    // Could send to error logging service here
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "20px",
          backgroundColor: "#fee2e2",
          border: "1px solid #fecaca",
          borderRadius: "6px",
          color: "#dc2626",
          fontFamily: "monospace",
        }}>
          <h2>⚠️ Dashboard Error</h2>
          <p>Failed to load dashboard. Please refresh the page.</p>
          <details>
            <summary>Error details</summary>
            <pre style={{ marginTop: "10px", overflow: "auto" }}>
              {this.state.error?.toString()}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Fetch carbon records from S3 with retry logic and error handling
 */
export async function fetchCarbonRecords(s3Base, maxRetries = 3) {
  const records = [];
  const errors = [];
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${s3Base}carbon-logs/index.json`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      const waitTime = Math.pow(2, attempt);
      console.warn(
        `Failed to fetch records (attempt ${attempt}/${maxRetries}): ${error.message}. ` +
        `Retrying in ${waitTime}s...`
      );
      errors.push(error);
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
      }
    }
  }
  
  console.error("Failed to fetch carbon records after all retries:", errors);
  return { records: [], error: errors[errors.length - 1]?.message };
}

/**
 * Aggregate carbon data by region with error handling
 */
export function aggregateCarbonByRegion(records, timeRange) {
  if (!Array.isArray(records)) {
    console.error("Invalid records format:", records);
    return {};
  }
  
  const now = new Date();
  const cutoff = new Date(now.getTime() - timeRange);
  
  const aggregated = {};
  
  for (const record of records) {
    try {
      const recordDate = new Date(record.timestamp);
      if (recordDate < cutoff) continue;
      
      const region = record.aws_region || "unknown";
      if (!aggregated[region]) {
        aggregated[region] = {
          region,
          count: 0,
          avgCi: 0,
          minCi: Infinity,
          maxCi: -Infinity,
          holds: 0,
          totalCo2: 0,
        };
      }
      
      const stat = aggregated[region];
      const ci = record.carbon_intensity || 0;
      
      stat.count++;
      stat.avgCi = (stat.avgCi * (stat.count - 1) + ci) / stat.count;
      stat.minCi = Math.min(stat.minCi, ci);
      stat.maxCi = Math.max(stat.maxCi, ci);
      stat.holds += record.decision === "HOLD" ? 1 : 0;
      stat.totalCo2 += record.estimated_co2_kg || 0;
    } catch (error) {
      console.warn("Error aggregating record:", record, error);
      continue;
    }
  }
  
  // Clean up Infinity values
  for (const region of Object.keys(aggregated)) {
    const stat = aggregated[region];
    if (!isFinite(stat.minCi)) stat.minCi = 0;
    if (!isFinite(stat.maxCi)) stat.maxCi = 0;
  }
  
  return aggregated;
}

/**
 * Calculate CO₂ savings based on optimal deployment timing
 */
export function calculateSavings(records, greenThreshold = 150, holdThreshold = 250) {
  if (!Array.isArray(records)) return { totalKg: 0, percentage: 0 };
  
  let holdCount = 0;
  let totalSavedKg = 0;
  let totalKg = 0;
  
  for (const record of records) {
    try {
      const co2 = record.estimated_co2_kg || 0;
      totalKg += co2;
      
      if (record.decision === "HOLD") {
        holdCount++;
        // Estimate savings assuming deployment would have been on a 25% dirtier grid
        totalSavedKg += co2 * 0.25;
      }
    } catch (error) {
      console.warn("Error calculating savings for record:", record, error);
      continue;
    }
  }
  
  const savedPercentage = totalKg > 0 ? (totalSavedKg / totalKg) * 100 : 0;
  
  return {
    totalKg: Math.round(totalSavedKg * 1000) / 1000,
    percentage: Math.round(savedPercentage * 10) / 10,
    holdCount,
  };
}

/**
 * Format numbers with appropriate precision
 */
export function formatNumber(value, decimals = 1) {
  if (typeof value !== "number" || !isFinite(value)) {
    return "N/A";
  }
  return value.toFixed(decimals);
}

/**
 * Get color based on carbon intensity
 */
export function getCarbonColor(ci, greenThreshold = 150, holdThreshold = 250) {
  if (ci < greenThreshold) return "#6ee7b7";  // green
  if (ci < holdThreshold) return "#fbbf24";   // amber
  return "#f87171";                            // red
}
