import { NextRequest, NextResponse } from "next/server";
import { requestContext } from "@/lib/server/integrations/auth";
import { integrationStore } from "@/lib/server/integrations/store";

export const runtime = "nodejs";

type AcquisitionRow = {
  channel: string;
  landingPage: string;
  sourceMedium: string;
  sessions: number;
  engagedSessions: number;
  engagementRate: number;
  averageSessionDuration: number;
  eventsPerSession: number;
  eventCount: number;
  keyEvents: number;
  sessionKeyEventRate: number;
  totalRevenue: number;
};

function numberMetric(metrics: Record<string, number | string | null>, key: string) {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function metricText(metrics: Record<string, number | string | null>, key: string) {
  return typeof metrics[key] === "string" ? String(metrics[key]) : "";
}

export async function GET(request: NextRequest) {
  const { userId, projectId } = requestContext(request);
  const url = new URL(request.url);
  const endDate = url.searchParams.get("endDate") ?? new Date().toISOString().slice(0, 10);
  const startDate = url.searchParams.get("startDate") ?? new Date(Date.now() - 89 * 86_400_000).toISOString().slice(0, 10);
  const metrics = await integrationStore.getMetrics(userId, projectId, "GOOGLE_ANALYTICS", startDate, endDate);
  const allSourceRows = metrics.filter((row) => row.dimensionType === "traffic_source");
  const hasEnrichedRows = allSourceRows.some((row) => Boolean(metricText(row.metrics, "landingPage")));
  // After the first re-sync, prefer the enriched rows so pre-upgrade imports
  // cannot duplicate the channel totals in the channel × landing-page report.
  const sourceRows = hasEnrichedRows
    ? allSourceRows.filter((row) => Boolean(metricText(row.metrics, "landingPage")))
    : allSourceRows;
  const grouped = new Map<string, AcquisitionRow>();
  const daily = new Map<string, Map<string, number>>();

  for (const row of sourceRows) {
    const values = row.dimensionValue.split(" / ");
    const channel = metricText(row.metrics, "channelGroup") || values[2] || "(unassigned)";
    const landingPage = metricText(row.metrics, "landingPage") || "(landing page available after next GA4 sync)";
    const sourceMedium = metricText(row.metrics, "source") && metricText(row.metrics, "medium")
      ? `${metricText(row.metrics, "source")} / ${metricText(row.metrics, "medium")}`
      : values.slice(0, 2).join(" / ");
    const key = `${channel}\u0000${landingPage}\u0000${sourceMedium}`;
    const item = grouped.get(key) ?? { channel, landingPage, sourceMedium, sessions: 0, engagedSessions: 0, engagementRate: 0, averageSessionDuration: 0, eventsPerSession: 0, eventCount: 0, keyEvents: 0, sessionKeyEventRate: 0, totalRevenue: 0 };
    item.sessions += numberMetric(row.metrics, "sessions");
    item.engagedSessions += numberMetric(row.metrics, "engagedSessions");
    item.eventCount += numberMetric(row.metrics, "eventCount");
    item.keyEvents += numberMetric(row.metrics, "keyEvents");
    item.totalRevenue += numberMetric(row.metrics, "totalRevenue");
    item.averageSessionDuration += numberMetric(row.metrics, "averageSessionDuration") * numberMetric(row.metrics, "sessions");
    grouped.set(key, item);
    const dateValues = daily.get(row.date) ?? new Map<string, number>();
    dateValues.set(channel, (dateValues.get(channel) ?? 0) + numberMetric(row.metrics, "sessions"));
    daily.set(row.date, dateValues);
  }

  const rows = [...grouped.values()].map((item) => ({
    ...item,
    engagementRate: item.sessions ? item.engagedSessions / item.sessions : 0,
    averageSessionDuration: item.sessions ? item.averageSessionDuration / item.sessions : 0,
    eventsPerSession: item.sessions ? item.eventCount / item.sessions : 0,
    sessionKeyEventRate: item.sessions ? item.keyEvents / item.sessions : 0
  })).sort((a, b) => b.sessions - a.sessions);
  const channels = [...new Set(rows.map((row) => row.channel))].slice(0, 6);
  const trend = [...daily.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, values]) => ({
    date,
    ...Object.fromEntries(channels.map((channel) => [channel, values.get(channel) ?? 0]))
  }));
  const totals = rows.reduce((total, row) => ({ sessions: total.sessions + row.sessions, engagedSessions: total.engagedSessions + row.engagedSessions, eventCount: total.eventCount + row.eventCount, keyEvents: total.keyEvents + row.keyEvents, totalRevenue: total.totalRevenue + row.totalRevenue }), { sessions: 0, engagedSessions: 0, eventCount: 0, keyEvents: 0, totalRevenue: 0 });
  return NextResponse.json({ range: { startDate, endDate }, channels, trend, rows: rows.slice(0, 100), totals, needsResync: !hasEnrichedRows });
}
