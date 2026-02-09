/**
 * X API Usage Tracking & Budget Controls.
 *
 * Wraps GET /2/usage/tweets for real cost data (not estimates).
 * Adds local budget tracking with configurable spending limits and alerts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = "https://api.x.com/2";
const DATA_DIR = join(import.meta.dir, "..", "data");
const BUDGET_PATH = join(DATA_DIR, "budget.json");

function getToken(): string {
  if (process.env.X_BEARER_TOKEN) return process.env.X_BEARER_TOKEN;
  try {
    const envFile = readFileSync(
      `${process.env.HOME}/.config/env/global.env`,
      "utf-8"
    );
    const match = envFile.match(/X_BEARER_TOKEN=["']?([^"'\n]+)/);
    if (match) return match[1];
  } catch {}
  throw new Error("X_BEARER_TOKEN not found");
}

// --- Types ---

export interface DailyUsage {
  date: string; // YYYY-MM-DD
  postReads: number;
  estimatedCost: number; // postReads * $0.005
}

export interface UsageResponse {
  dailyUsage: DailyUsage[];
  totalPostReads: number;
  totalEstimatedCost: number;
  period: { start: string; end: string };
}

export interface BudgetConfig {
  /** Daily spending limit in USD. 0 = unlimited. */
  dailyLimitUsd: number;
  /** Monthly (30-day rolling) spending limit in USD. 0 = unlimited. */
  monthlyLimitUsd: number;
  /** Warn when daily spend exceeds this percentage of daily limit (0-1). */
  warnThreshold: number;
  /** Track local cost accumulation (updated after each API call). */
  localTracking: {
    today: string; // YYYY-MM-DD
    todayPostReads: number;
    todayCost: number;
    rollingPostReads: number; // 30-day rolling
    rollingCost: number;
    lastReset: string; // ISO timestamp
  };
}

const DEFAULT_BUDGET: BudgetConfig = {
  dailyLimitUsd: 0,
  monthlyLimitUsd: 0,
  warnThreshold: 0.8,
  localTracking: {
    today: new Date().toISOString().split("T")[0],
    todayPostReads: 0,
    todayCost: 0,
    rollingPostReads: 0,
    rollingCost: 0,
    lastReset: new Date().toISOString(),
  },
};

// --- Budget persistence ---

export function loadBudget(): BudgetConfig {
  if (!existsSync(BUDGET_PATH)) return { ...DEFAULT_BUDGET };
  try {
    const raw = JSON.parse(readFileSync(BUDGET_PATH, "utf-8"));
    // Reset daily counters if it's a new day
    const today = new Date().toISOString().split("T")[0];
    if (raw.localTracking?.today !== today) {
      raw.localTracking = {
        ...raw.localTracking,
        today,
        todayPostReads: 0,
        todayCost: 0,
      };
    }
    return raw;
  } catch {
    return { ...DEFAULT_BUDGET };
  }
}

export function saveBudget(budget: BudgetConfig): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(BUDGET_PATH, JSON.stringify(budget, null, 2));
}

/**
 * Record local API usage (called after each search/profile/etc).
 * Returns warning message if approaching or exceeding budget.
 */
export function recordUsage(postReads: number): string | null {
  const budget = loadBudget();
  const cost = postReads * 0.005;
  const today = new Date().toISOString().split("T")[0];

  // Reset daily if new day
  if (budget.localTracking.today !== today) {
    budget.localTracking.today = today;
    budget.localTracking.todayPostReads = 0;
    budget.localTracking.todayCost = 0;
  }

  budget.localTracking.todayPostReads += postReads;
  budget.localTracking.todayCost += cost;
  budget.localTracking.rollingPostReads += postReads;
  budget.localTracking.rollingCost += cost;

  saveBudget(budget);

  // Check limits
  if (
    budget.dailyLimitUsd > 0 &&
    budget.localTracking.todayCost >= budget.dailyLimitUsd
  ) {
    return `⚠️ DAILY BUDGET EXCEEDED: $${budget.localTracking.todayCost.toFixed(2)} / $${budget.dailyLimitUsd.toFixed(2)}`;
  }

  if (
    budget.dailyLimitUsd > 0 &&
    budget.localTracking.todayCost >=
      budget.dailyLimitUsd * budget.warnThreshold
  ) {
    return `⚡ Budget warning: $${budget.localTracking.todayCost.toFixed(2)} / $${budget.dailyLimitUsd.toFixed(2)} daily limit (${Math.round((budget.localTracking.todayCost / budget.dailyLimitUsd) * 100)}%)`;
  }

  if (
    budget.monthlyLimitUsd > 0 &&
    budget.localTracking.rollingCost >= budget.monthlyLimitUsd
  ) {
    return `⚠️ MONTHLY BUDGET EXCEEDED: $${budget.localTracking.rollingCost.toFixed(2)} / $${budget.monthlyLimitUsd.toFixed(2)}`;
  }

  return null;
}

/**
 * Check if a request should be blocked due to budget limits.
 * Returns error message if blocked, null if allowed.
 */
export function checkBudget(estimatedPostReads: number): string | null {
  const budget = loadBudget();
  const estimatedCost = estimatedPostReads * 0.005;

  if (
    budget.dailyLimitUsd > 0 &&
    budget.localTracking.todayCost + estimatedCost > budget.dailyLimitUsd
  ) {
    return `🛑 Request blocked: would exceed daily budget ($${budget.localTracking.todayCost.toFixed(2)} + ~$${estimatedCost.toFixed(2)} > $${budget.dailyLimitUsd.toFixed(2)} limit). Use 'usage budget set-daily 0' to remove limit.`;
  }

  if (
    budget.monthlyLimitUsd > 0 &&
    budget.localTracking.rollingCost + estimatedCost >
      budget.monthlyLimitUsd
  ) {
    return `🛑 Request blocked: would exceed monthly budget ($${budget.localTracking.rollingCost.toFixed(2)} + ~$${estimatedCost.toFixed(2)} > $${budget.monthlyLimitUsd.toFixed(2)} limit). Use 'usage budget set-monthly 0' to remove limit.`;
  }

  return null;
}

// --- X API Usage endpoint ---

/**
 * Fetch real usage data from X API.
 * GET /2/usage/tweets — returns daily post consumption.
 */
export async function fetchUsage(opts: {
  days?: number;
}): Promise<UsageResponse> {
  const token = getToken();
  const days = opts.days || 7;
  const endTime = new Date();
  const startTime = new Date(Date.now() - days * 86_400_000);

  // The usage endpoint uses different params
  const url = `${BASE}/usage/tweets?start_time=${startTime.toISOString()}&end_time=${endTime.toISOString()}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 429) {
    throw new Error("Rate limited on usage endpoint. Try again shortly.");
  }

  if (!res.ok) {
    const body = await res.text();
    // If usage endpoint isn't available, fall back to local tracking
    if (res.status === 403 || res.status === 404) {
      return fallbackLocalUsage(days);
    }
    throw new Error(`Usage API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return parseUsageResponse(data, startTime, endTime);
}

function parseUsageResponse(
  data: any,
  startTime: Date,
  endTime: Date
): UsageResponse {
  // X API usage response format: { data: { daily_project_usage: [...] } }
  const dailyUsage: DailyUsage[] = [];
  let totalPostReads = 0;

  const dailyData = data?.data?.daily_project_usage || data?.data || [];

  for (const day of dailyData) {
    // Each day has an array of app usage
    const appUsages = day?.usage || [];
    let dayReads = 0;

    for (const app of appUsages) {
      dayReads += app?.tweets || 0;
    }

    const date = day?.date
      ? new Date(day.date).toISOString().split("T")[0]
      : "unknown";

    dailyUsage.push({
      date,
      postReads: dayReads,
      estimatedCost: dayReads * 0.005,
    });

    totalPostReads += dayReads;
  }

  return {
    dailyUsage,
    totalPostReads,
    totalEstimatedCost: totalPostReads * 0.005,
    period: {
      start: startTime.toISOString().split("T")[0],
      end: endTime.toISOString().split("T")[0],
    },
  };
}

function fallbackLocalUsage(days: number): UsageResponse {
  const budget = loadBudget();
  const today = new Date().toISOString().split("T")[0];

  return {
    dailyUsage: [
      {
        date: today,
        postReads: budget.localTracking.todayPostReads,
        estimatedCost: budget.localTracking.todayCost,
      },
    ],
    totalPostReads: budget.localTracking.rollingPostReads,
    totalEstimatedCost: budget.localTracking.rollingCost,
    period: {
      start: budget.localTracking.lastReset.split("T")[0],
      end: today,
    },
  };
}

// --- Formatters ---

export function formatUsageTelegram(usage: UsageResponse): string {
  const budget = loadBudget();
  let out = `📊 X API Usage (${usage.period.start} → ${usage.period.end})\n\n`;

  out += `Total reads: ${usage.totalPostReads.toLocaleString()}\n`;
  out += `Est. cost: $${usage.totalEstimatedCost.toFixed(2)}\n\n`;

  if (usage.dailyUsage.length > 0) {
    out += `Daily breakdown:\n`;
    for (const day of usage.dailyUsage.slice(-7)) {
      const bar = "█".repeat(
        Math.min(Math.ceil(day.postReads / 100), 20)
      );
      out += `  ${day.date}: ${day.postReads.toLocaleString()} reads (~$${day.estimatedCost.toFixed(2)}) ${bar}\n`;
    }
  }

  // Budget info
  if (budget.dailyLimitUsd > 0 || budget.monthlyLimitUsd > 0) {
    out += `\nBudget:\n`;
    if (budget.dailyLimitUsd > 0) {
      const pct = Math.round(
        (budget.localTracking.todayCost / budget.dailyLimitUsd) * 100
      );
      out += `  Daily: $${budget.localTracking.todayCost.toFixed(2)} / $${budget.dailyLimitUsd.toFixed(2)} (${pct}%)\n`;
    }
    if (budget.monthlyLimitUsd > 0) {
      const pct = Math.round(
        (budget.localTracking.rollingCost / budget.monthlyLimitUsd) * 100
      );
      out += `  Monthly: $${budget.localTracking.rollingCost.toFixed(2)} / $${budget.monthlyLimitUsd.toFixed(2)} (${pct}%)\n`;
    }
  }

  return out;
}

export function formatUsageMarkdown(usage: UsageResponse): string {
  const budget = loadBudget();
  let out = `# X API Usage Report\n\n`;
  out += `**Period:** ${usage.period.start} → ${usage.period.end}\n`;
  out += `**Total post reads:** ${usage.totalPostReads.toLocaleString()}\n`;
  out += `**Estimated cost:** $${usage.totalEstimatedCost.toFixed(2)}\n\n`;

  if (usage.dailyUsage.length > 0) {
    out += `## Daily Breakdown\n\n`;
    out += `| Date | Post Reads | Est. Cost |\n`;
    out += `|------|-----------|----------|\n`;
    for (const day of usage.dailyUsage) {
      out += `| ${day.date} | ${day.postReads.toLocaleString()} | $${day.estimatedCost.toFixed(2)} |\n`;
    }
    out += `\n`;
  }

  if (budget.dailyLimitUsd > 0 || budget.monthlyLimitUsd > 0) {
    out += `## Budget Status\n\n`;
    if (budget.dailyLimitUsd > 0) {
      out += `- **Daily limit:** $${budget.localTracking.todayCost.toFixed(2)} / $${budget.dailyLimitUsd.toFixed(2)}\n`;
    }
    if (budget.monthlyLimitUsd > 0) {
      out += `- **Monthly limit:** $${budget.localTracking.rollingCost.toFixed(2)} / $${budget.monthlyLimitUsd.toFixed(2)}\n`;
    }
  }

  return out;
}
