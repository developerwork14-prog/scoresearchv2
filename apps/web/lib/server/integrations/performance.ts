import { integrationStore } from "./store";
import type { CombinedInsight, DashboardMetric, DashboardTableRow, DateRange, IntegrationProvider, MetricRow, PerformanceDashboard } from "./types";
import { toPublicConnection } from "./types";
import { previousDays } from "./date";

function numberMetric(row: MetricRow, key: string) {
  const value = row.metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sum(rows: MetricRow[], key: string) {
  return rows.reduce((total, row) => total + numberMetric(row, key), 0);
}

function avg(rows: MetricRow[], key: string) {
  if (!rows.length) return 0;
  return rows.reduce((total, row) => total + numberMetric(row, key), 0) / rows.length;
}

function change(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function topRows(rows: MetricRow[], key: string, limit = 10): DashboardTableRow[] {
  const groups = new Map<string, { value: number; secondary: number }>();
  for (const row of rows) {
    const current = groups.get(row.dimensionValue) ?? { value: 0, secondary: 0 };
    current.value += numberMetric(row, key);
    current.secondary += numberMetric(row, "impressions") || numberMetric(row, "sessions") || numberMetric(row, "screenPageViews");
    groups.set(row.dimensionValue, current);
  }
  return [...groups.entries()]
    .map(([label, values]) => ({ label, value: Math.round(values.value), secondary: Math.round(values.secondary) }))
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, limit);
}

function dailyTrend(rows: MetricRow[], metrics: string[]) {
  const dailyRows = rows.filter((row) => row.dimensionType === "daily");
  const groups = new Map<string, Record<string, number | string>>();
  for (const row of dailyRows) {
    const item = groups.get(row.date) ?? { date: row.date };
    for (const metric of metrics) item[metric] = Number(item[metric] ?? 0) + numberMetric(row, metric);
    groups.set(row.date, item);
  }
  return [...groups.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function splitComparison(rows: MetricRow[]) {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const midpoint = Math.floor(dates.length / 2);
  const previousDates = new Set(dates.slice(0, midpoint));
  return {
    previous: rows.filter((row) => previousDates.has(row.date)),
    current: rows.filter((row) => !previousDates.has(row.date))
  };
}

export async function performanceDashboard(input: {
  userId: string;
  projectId: string;
  provider: IntegrationProvider;
  range?: DateRange;
}): Promise<PerformanceDashboard> {
  const range = input.range ?? previousDays(90);
  const [connection, rows] = await Promise.all([
    integrationStore.getConnection(input.userId, input.projectId, input.provider),
    integrationStore.getMetrics(input.userId, input.projectId, input.provider, range.startDate, range.endDate)
  ]);
  const { current, previous } = splitComparison(rows.filter((row) => row.dimensionType === "daily"));

  if (input.provider === "GOOGLE_SEARCH_CONSOLE") {
    const clicks = sum(current, "clicks");
    const impressions = sum(current, "impressions");
    const prevClicks = sum(previous, "clicks");
    const prevImpressions = sum(previous, "impressions");
    const queryRows = rows.filter((row) => row.dimensionType === "query");
    const pageRows = rows.filter((row) => row.dimensionType === "page");
    return {
      provider: input.provider,
      projectId: input.projectId,
      connection: connection ? toPublicConnection(connection) : undefined,
      range,
      metrics: [
        metric("Total clicks", clicks, prevClicks),
        metric("Total impressions", impressions, prevImpressions),
        metric("Average CTR", impressions ? clicks / impressions : 0, prevImpressions ? prevClicks / prevImpressions : 0, true),
        metric("Average position", avg(current, "position"), avg(previous, "position"))
      ],
      trends: dailyTrend(rows, ["clicks", "impressions", "position"]),
      tables: {
        "Top queries": topRows(queryRows, "clicks"),
        "Top pages": topRows(pageRows, "clicks"),
        "Top countries": topRows(rows.filter((row) => row.dimensionType === "country"), "clicks"),
        "Device distribution": topRows(rows.filter((row) => row.dimensionType === "device"), "clicks"),
        "Low CTR, high impression queries": lowCtrQueries(queryRows),
        "Keywords positions 4 to 20": queryRows.filter((row) => numberMetric(row, "position") >= 4 && numberMetric(row, "position") <= 20).slice(0, 10).map((row) => ({ label: row.dimensionValue, value: Number(numberMetric(row, "position").toFixed(1)), secondary: Math.round(numberMetric(row, "impressions")) }))
      },
      unsupported: [{ label: "searchAppearance", reason: "Stored when requested from Search Console, but not all properties expose this dimension reliably." }]
    };
  }

  if (input.provider === "GOOGLE_ANALYTICS") {
    const activeUsers = sum(current, "activeUsers");
    const prevActiveUsers = sum(previous, "activeUsers");
    return {
      provider: input.provider,
      projectId: input.projectId,
      connection: connection ? toPublicConnection(connection) : undefined,
      range,
      metrics: [
        metric("Active users", activeUsers, prevActiveUsers),
        metric("New users", sum(current, "newUsers"), sum(previous, "newUsers")),
        metric("Sessions", sum(current, "sessions"), sum(previous, "sessions")),
        metric("Engagement rate", avg(current, "engagementRate"), avg(previous, "engagementRate"), true),
        metric("Views", sum(current, "screenPageViews"), sum(previous, "screenPageViews")),
        metric("Key events", sum(current, "keyEvents"), sum(previous, "keyEvents"))
      ],
      trends: dailyTrend(rows, ["activeUsers", "sessions", "screenPageViews", "keyEvents"]),
      tables: {
        "Organic landing pages": topRows(rows.filter((row) => row.dimensionType === "landing_page"), "sessions"),
        "Source / medium": topRows(rows.filter((row) => row.dimensionType === "traffic_source"), "sessions"),
        "Device performance": topRows(rows.filter((row) => row.dimensionType === "device"), "sessions"),
        "Country performance": topRows(rows.filter((row) => row.dimensionType === "geo"), "activeUsers")
      },
      unsupported: []
    };
  }

  return {
    provider: input.provider,
    projectId: input.projectId,
    connection: connection ? toPublicConnection(connection) : undefined,
    range,
    metrics: [
      metric("Clicks", sum(current, "clicks"), sum(previous, "clicks")),
      metric("Impressions", sum(current, "impressions"), sum(previous, "impressions")),
      metric("CTR", avg(current, "ctr"), avg(previous, "ctr"), true),
      metric("Average position", avg(current, "position"), avg(previous, "position"))
    ],
    trends: dailyTrend(rows, ["clicks", "impressions", "position"]),
    tables: {
      "Top queries": topRows(rows.filter((row) => row.dimensionType === "query"), "clicks"),
      "Top pages": topRows(rows.filter((row) => row.dimensionType === "page"), "clicks"),
      "Crawl activity": topRows(rows.filter((row) => row.dimensionType === "crawl"), "clicks")
    },
    unsupported: [
      { label: "Crawl errors", reason: "Unavailable unless the configured Bing API surface exposes crawl diagnostics." },
      { label: "Indexed pages", reason: "Unavailable unless the configured Bing API surface exposes index data." },
      { label: "Inbound links", reason: "Unavailable unless the configured Bing API surface exposes link data." },
      { label: "URL submission status", reason: "Unavailable unless the configured Bing API surface exposes URL submission status." }
    ]
  };
}

function metric(label: string, value: number, previousValue: number, percent = false): DashboardMetric {
  const displayValue = percent ? `${(value * 100).toFixed(2)}%` : Math.round(value);
  const displayPrevious = percent ? `${(previousValue * 100).toFixed(2)}%` : Math.round(previousValue);
  return { label, value: displayValue, previousValue: displayPrevious, changePercent: Number(change(value, previousValue).toFixed(1)) };
}

function lowCtrQueries(rows: MetricRow[]) {
  return rows
    .filter((row) => numberMetric(row, "impressions") >= 100 && numberMetric(row, "ctr") < 0.02)
    .sort((a, b) => numberMetric(b, "impressions") - numberMetric(a, "impressions"))
    .slice(0, 10)
    .map((row) => ({ label: row.dimensionValue, value: `${(numberMetric(row, "ctr") * 100).toFixed(2)}%`, secondary: Math.round(numberMetric(row, "impressions")) }));
}

export async function combinedInsights(userId: string, projectId: string): Promise<CombinedInsight[]> {
  const range = previousDays(90);
  const [gsc, ga4, bing] = await Promise.all([
    integrationStore.getMetrics(userId, projectId, "GOOGLE_SEARCH_CONSOLE", range.startDate, range.endDate),
    integrationStore.getMetrics(userId, projectId, "GOOGLE_ANALYTICS", range.startDate, range.endDate),
    integrationStore.getMetrics(userId, projectId, "BING_WEBMASTER", range.startDate, range.endDate)
  ]);
  const insights: CombinedInsight[] = [];
  for (const row of gsc.filter((item) => item.dimensionType === "query")) {
    const impressions = numberMetric(row, "impressions");
    const ctr = numberMetric(row, "ctr");
    const position = numberMetric(row, "position");
    if (impressions >= 500 && ctr < 0.02) {
      insights.push(insight(projectId, row.dimensionValue, "Google Search Console", ctr, 0.02, 70, "Rewrite title and meta description around the matching search intent.", `Query has ${Math.round(impressions)} impressions and ${(ctr * 100).toFixed(2)}% CTR.`));
    }
    if (position >= 4 && position <= 20) {
      insights.push(insight(projectId, row.dimensionValue, "Google Search Console", position, 3, 62, "Improve the ranking page with stronger topical coverage, internal links, and schema.", `Average position is ${position.toFixed(1)}.`));
    }
  }
  const gaPages = new Set(ga4.filter((row) => row.dimensionType === "landing_page").map((row) => row.dimensionValue));
  const bingPages = new Set(bing.filter((row) => row.dimensionType === "page").map((row) => row.dimensionValue));
  for (const page of gaPages) {
    if (!bingPages.has(page)) insights.push(insight(projectId, page, "GA4 + Bing", 1, 0, 48, "Check Bing indexing, sitemap discovery, canonical tags, and robots directives.", "Organic page appears in GA4 imports but not Bing performance imports."));
  }
  return insights.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 50);
}

function insight(projectId: string, pageOrQuery: string, dataSource: string, currentMetric: number, previousPeriodMetric: number, score: number, recommendedAction: string, evidence: string): CombinedInsight {
  return {
    id: `${projectId}:${dataSource}:${pageOrQuery}:${recommendedAction}`.replace(/\s+/g, "-").toLowerCase(),
    projectId,
    pageOrQuery,
    dataSource,
    currentMetric,
    previousPeriodMetric,
    percentageChange: Number(change(currentMetric, previousPeriodMetric).toFixed(1)),
    priority: score >= 80 ? "Critical" : score >= 60 ? "High" : score >= 35 ? "Medium" : "Low",
    priorityScore: score,
    recommendedAction,
    evidence,
    dateGenerated: new Date().toISOString()
  };
}
