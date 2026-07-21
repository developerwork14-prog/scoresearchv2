"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Activity, AlertTriangle, Bot, CheckCircle2, Clock3, Database, Download, FileText, MapPin, RefreshCw, Search, ServerCrash, ShieldCheck, Video } from "lucide-react";
import type { StructuredAiVisibilityReport } from "@aiva/core";
import { API_BASE, getReport } from "@/lib/api";
import type { DashboardMetric, DashboardTableRow, ExternalProperty, IntegrationProvider, PerformanceDashboard, PublicIntegrationConnection } from "@/lib/server/integrations/types";
import {
  CHATGPT_CITATION_CATEGORIES,
  CHATGPT_CITATION_CHECK_IDS,
  GEMINI_CITATION_CATEGORIES,
  GEMINI_CITATION_CHECK_IDS
} from "@/lib/audit-citation-categories";
import { CallbackModal } from "@/components/callback-modal";
import { PlatformBrandIcon } from "@/components/platform-brand-icon";
import styles from "./page.module.css";

type Status = "Passed" | "Minor Attention" | "Needs Attention" | "Skipped";
type CategoryLike = {
  categoryName: string;
  totalChecks: number;
  passedChecks?: number;
  failedChecks: number;
  warningChecks?: number;
  score: number;
  status: string;
  skippedChecks?: number;
};
type AuditTabId = "technical" | "pageSpeed" | "crawlability" | "structuredData" | "onPageSeo" | "imageSeo" | "eeat" | "trustSignals" | "entitySeo" | "geo" | "citation" | "gemini" | "indexability";
type ActiveSectionId = "overview" | "integrations" | "searchConsole" | "serverStatus" | AuditTabId;
type TabInfo = { label: string; categories: CategoryLike[]; checks: CheckLike[]; score: number; issues: number; available: boolean; checkedAt?: string };
type IssueImpactCounts = { high: number; medium: number; low: number };
type IssueTrendPoint = IssueImpactCounts & { label: string };
type RecommendationDetails = {
  issue?: string;
  issueSummary?: string;
  severity?: string;
  priority?: string;
  priorityScore?: number;
  impactLevel?: "Low" | "Medium" | "High";
  scaleLevel?: "Low" | "Medium" | "High";
  effortLevel?: "Low" | "Medium" | "High";
  affectedRate?: number;
  affectedPages?: string[];
  affectedAssets?: string[];
  uniqueAssetsAffected?: number;
  rootCause?: string[];
  likelyTemplates?: string[];
  estimatedFixScope?: {
    level?: "Asset-level fix" | "Template-level fix" | "Infrastructure-level fix" | "Schema generator fix" | "Manual review";
    description?: string;
  };
  overallAiVisibilityImpact?: {
    level?: "Low" | "Moderate" | "High";
    explanation?: string;
  };
  whatIsWrong?: string;
  whyItMatters?: string;
  businessImpact?: string;
  aiVisibilityImpact?: string;
  recommendedFix?: string[];
  validationSummary?: {
    pagesCrawled?: number | null;
    pagesAnalyzed?: number | null;
    pagesAffected?: number;
    uniqueAssetsAffected?: number;
    affectedRate?: number;
    mostCommonIssue?: string;
    expectedOutcome?: string;
  };
  detectionConfidence?: { score?: number; reason?: string };
  topFixCandidates?: string[];
  technicalEvidence?: Record<string, unknown>;
  whatWeChecked?: string[];
  rawEvidence?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  howToFix?: string;
  bestPracticeExample?: string;
  developerNotes?: string;
};
type CheckLike = { id?: number; category?: string; name?: string; passed?: boolean; skipped?: boolean; notApplicable?: boolean; warning?: boolean; informational?: boolean; opportunity?: string; severity?: string; priorityScore?: number; scope?: string; evidence?: unknown; issueSummary?: string; whatIsWrong?: string; businessImpact?: string; validationSummary?: string[]; recommendation?: string | RecommendationDetails; recommendationDetails?: RecommendationDetails };
type GeoIssueCategory = CategoryLike & {
  failedCheckDetails?: { name?: string; severity?: string; evidence?: string; recommendation?: string }[];
  skippedCheckDetails?: { name?: string; reason?: string }[];
};
type AiPlatform = "chatgpt" | "gemini" | "geo" | "overall";
type HealthTone = "good" | "warn" | "bad" | "muted";
type HealthResponse = {
  ok: boolean;
  message?: string;
  storage?: {
    mode?: string;
    mongoConfigured?: boolean;
    database?: string;
    uri?: string;
    lastError?: string | null;
  };
  integrations?: Record<string, boolean>;
};

const strategyItems = [
  { label: "SEO", icon: Search },
  { label: "Local Search", icon: MapPin },
  { label: "AEO", icon: FileText },
  { label: "AI Visibility", icon: Bot },
  { label: "Video Search", icon: Video }
];

const integrationProviders: Array<{
  provider: IntegrationProvider;
  name: string;
  shortName: string;
  description: string;
  accent: string;
}> = [
  {
    provider: "GOOGLE_SEARCH_CONSOLE",
    name: "Google Search Console",
    shortName: "GSC",
    description: "Connect a verified Search Console property and sync clicks, impressions, CTR, position, queries, pages, countries, and devices.",
    accent: "#1A73E8"
  },
  {
    provider: "GOOGLE_ANALYTICS",
    name: "Google Analytics",
    shortName: "GA4",
    description: "Connect GA4 to import organic users, sessions, engagement, landing pages, source/medium, devices, geography, and conversions.",
    accent: "#F9AB00"
  },
  {
    provider: "BING_WEBMASTER",
    name: "Bing Webmaster Tools",
    shortName: "Bing",
    description: "Connect a Microsoft account to map Bing sites and import supported Bing search performance and crawl data.",
    accent: "#008373"
  }
];

const ENTITY_SEO_CATEGORIES = [
  "Entity Recognition",
  "Entity Description Consistency",
  "Entity Attribute Consistency"
] as const;

const PAGE_SPEED_CATEGORIES = [
  "Core Web Vitals",
  "PageSpeed Scores",
  "Performance",
  "Performance & Caching",
  "TTFB & Server Response",
  "Asset Optimisation"
] as const;

const statusMeta: Record<Status, { icon: string; className: string }> = {
  Passed: { icon: "OK", className: styles.passed },
  "Minor Attention": { icon: "!", className: styles.minor },
  "Needs Attention": { icon: "X", className: styles.needs },
  Skipped: { icon: "-", className: styles.skipped }
};

function clampScore(score = 0) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreFromCategories(categories: CategoryLike[], fallback = 0) {
  const scorable = categories.filter((category) => category.totalChecks > 0 && category.status !== "Skipped");
  if (!scorable.length) return clampScore(fallback);
  const totalChecks = scorable.reduce((sum, category) => sum + category.totalChecks, 0);
  return clampScore(scorable.reduce((sum, category) => sum + category.score * category.totalChecks, 0) / totalChecks);
}

function issueCount(categories: CategoryLike[]) {
  return categories.reduce((sum, category) => sum + category.failedChecks, 0);
}

function checksRepresentFailedAudit(checks: readonly CheckLike[] | undefined) {
  if (!checks?.length) return false;
  return checks.every((check) => {
    const evidence = evidenceText(check.evidence).toLowerCase();
    return evidence.includes("fetch failed:") || evidence.includes("audit unavailable") || evidence.includes("audit timed out");
  });
}

function mergeIssueCounts(...counts: IssueImpactCounts[]) {
  return counts.reduce<IssueImpactCounts>(
    (total, count) => ({
      high: total.high + count.high,
      medium: total.medium + count.medium,
      low: total.low + count.low
    }),
    { high: 0, medium: 0, low: 0 }
  );
}

function impactForFinding(check: Pick<CheckLike, "warning" | "scope" | "evidence">): keyof IssueImpactCounts {
  if (check.warning) return "low";
  const evidence = evidenceObject(check.evidence);
  const pagesChecked = Number(evidence?.pagesChecked);
  const pagesFailed = Number(evidence?.pagesFailed);
  if (check.scope === "domain") return "high";
  if (Number.isFinite(pagesChecked) && Number.isFinite(pagesFailed)) {
    if (pagesChecked > 0 && pagesFailed === pagesChecked) return "high";
    if (pagesFailed > 1) return "medium";
    return "low";
  }
  return "medium";
}

function issuesFromChecks(checks: readonly CheckLike[] | undefined, categories: readonly CategoryLike[] = []) {
  if (checksRepresentFailedAudit(checks)) return { high: 0, medium: 0, low: 0 };
  if (checks?.length) {
    return checks.reduce<IssueImpactCounts>((counts, check) => {
      if (check.passed || check.skipped) return counts;
      if (check.warning) {
        counts.low += 1;
        return counts;
      }
      counts[impactForFinding(check)] += 1;
      return counts;
    }, { high: 0, medium: 0, low: 0 });
  }

  return { high: 0, medium: issueCount([...categories]), low: 0 };
}

function issuesFromGeoCategories(categories: readonly GeoIssueCategory[]) {
  return categories.reduce<IssueImpactCounts>((counts, category) => {
    if (category.failedCheckDetails?.length) {
      counts.medium += category.failedCheckDetails.length;
      return counts;
    }

    counts.medium += category.failedChecks;
    return counts;
  }, { high: 0, medium: 0, low: 0 });
}

function buildIssueTrend(counts: IssueImpactCounts, score: number): IssueTrendPoint[] {
  const labels = ["8w", "7w", "6w", "5w", "4w", "3w", "2w", "now"];
  const total = counts.high + counts.medium + counts.low;
  if (total === 0) {
    return labels.map((label) => ({ label, high: 0, medium: 0, low: 0 }));
  }

  const riskFactor = (100 - clampScore(score)) / 100;
  const uplift = {
    high: Math.ceil(counts.high * (0.58 + riskFactor * 0.42)),
    medium: Math.ceil(counts.medium * (0.5 + riskFactor * 0.36)),
    low: Math.ceil(counts.low * (0.42 + riskFactor * 0.3))
  };

  return labels.map((label, index) => {
    const remaining = 1 - index / (labels.length - 1);
    const curve = Math.pow(remaining, 0.9);
    return {
      label,
      high: counts.high + Math.round(uplift.high * curve),
      medium: counts.medium + Math.round(uplift.medium * curve),
      low: counts.low + Math.round(uplift.low * curve)
    };
  });
}

function statusFor(score: number, skipped = false): Status {
  if (skipped) return "Skipped";
  if (score >= 90) return "Passed";
  if (score >= 60) return "Minor Attention";
  return "Needs Attention";
}

function points(series: number[], width: number, height: number, pad = 5) {
  const left = pad;
  const right = width - pad;
  if (series.length < 2) {
    return [[left, height - pad], [right, height - pad]] as const;
  }
  const min = Math.min(...series);
  const max = Math.max(...series);
  const spread = max - min || 1;
  return series.map((value, index) => {
    const x = left + (index / (series.length - 1)) * (right - left);
    const y = height - pad - ((value - min) / spread) * (height - pad * 2);
    return [x, y] as const;
  });
}

function paddedSeries(series: number[], fallback = 0) {
  const values = series.filter(Number.isFinite).map(clampScore);
  if (values.length >= 2) return values;
  const value = values[0] ?? clampScore(fallback);
  return [value, value];
}

function categoryScoreSeries(categories: CategoryLike[], fallback: number) {
  return paddedSeries(categories.map((category) => category.score), fallback);
}

function formatAuditDate(value?: string) {
  if (!value) return "Audit date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Audit date unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function tabMeta(label: string, categories: CategoryLike[], checks: CheckLike[] = [], score?: number, checkedAt?: string): TabInfo {
  const uniqueCategories = [...new Map(categories.map((category) => [category.categoryName, category])).values()];
  const available = uniqueCategories.some((category) => category.totalChecks > 0) && !checksRepresentFailedAudit(checks);
  return { label, categories: uniqueCategories, checks, score: clampScore(score), issues: available ? issueCount(uniqueCategories) : 0, available, checkedAt };
}

function statusLabel(score: number) {
  if (score >= 90) return "excellent";
  if (score >= 70) return "strong";
  if (score >= 55) return "needs focus";
  return "at risk";
}

function formatMs(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "N/A";
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}s`;
  return `${Math.round(value)}ms`;
}

function formatDecimal(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "N/A";
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatScore(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "N/A";
  return `${Math.round(value)}%`;
}

function scoreTone(score: number) {
  if (score >= 90) return "#1F9D55";
  if (score < 60) return "#DC2626";
  return "#B8902B";
}

function priorityIssueGroups(tab: TabInfo) {
  return tab.categories
    .filter((category) => category.status !== "Skipped" && category.failedChecks > 0)
    .sort((a, b) => b.failedChecks - a.failedChecks || a.score - b.score)
    .slice(0, 3);
}

function Sparkline({ series, color, muted = false }: { series: number[]; color: string; muted?: boolean }) {
  const width = 240;
  const height = 44;
  const pts = points(series, width, height);
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;
  const id = `spark-${series.join("-")}-${color.replace("#", "")}`;
  return (
    <svg className={styles.sparkline} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop stopColor={muted ? "#999999" : color} stopOpacity="0.2" />
          <stop offset="1" stopColor={muted ? "#999999" : color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={muted ? "#999999" : color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function GaugeRing({ score }: { score: number }) {
  const r = 82;
  const c = 2 * Math.PI * r;
  return (
    <svg className={styles.bigGauge} viewBox="0 0 200 200" aria-label={`AI visibility score ${score} percent`}>
      <circle cx="100" cy="100" r={r} fill="none" stroke="#ECECEC" strokeWidth="16" />
      <circle cx="100" cy="100" r={r} fill="none" stroke="#B8902B" strokeWidth="16" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (score / 100) * c} transform="rotate(-90 100 100)" />
      <text x="100" y="111" textAnchor="middle" className={styles.gaugeText}>{score}%</text>
    </svg>
  );
}

function RadarChart({ axes }: { axes: readonly { label: string; value: number }[] }) {
  const size = 300;
  const center = size / 2;
  const radius = 96;
  const angle = (i: number, r = radius) => {
    const a = (-90 + i * (360 / axes.length)) * (Math.PI / 180);
    return [center + Math.cos(a) * r, center + Math.sin(a) * r] as const;
  };
  const ring = (pct: number) => axes.map((_, i) => angle(i, radius * pct)).map((p) => p.join(",")).join(" ");
  const data = axes.map((axis, i) => angle(i, radius * (axis.value / 100)));
  return (
    <svg className={styles.radar} viewBox={`0 0 ${size} ${size}`} aria-label="Visibility profile radar chart">
      {[0.25, 0.5, 0.75, 1].map((r) => <polygon key={r} points={ring(r)} fill="none" stroke="#ECECEC" />)}
      {axes.map((axis, i) => {
        const end = angle(i);
        const label = angle(i, radius + 26);
        return (
          <g key={axis.label}>
            <line x1={center} y1={center} x2={end[0]} y2={end[1]} stroke="#ECECEC" />
            <text x={label[0]} y={label[1]} textAnchor="middle" dominantBaseline="middle" className={styles.radarLabel}>{axis.label}</text>
          </g>
        );
      })}
      <polygon points={data.map((p) => p.join(",")).join(" ")} fill="rgba(184,144,43,0.16)" stroke="#B8902B" strokeWidth="2" />
      {data.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3.5" fill="#B8902B" />)}
    </svg>
  );
}

function StackedArea({ data }: { data: readonly IssueTrendPoint[] }) {
  const width = 720;
  const height = 280;
  const padX = 34;
  const padTop = 34;
  const padBottom = 34;
  const chartWidth = width - padX * 2;
  const chartHeight = height - padTop - padBottom;
  const max = Math.max(1, ...data.map((point) => point.high + point.medium + point.low));
  const x = (index: number) => padX + (index / Math.max(1, data.length - 1)) * chartWidth;
  const y = (value: number) => padTop + chartHeight - (value / max) * chartHeight;
  const band = (topValue: (point: IssueTrendPoint) => number, bottomValue: (point: IssueTrendPoint) => number) => {
    const top = data.map((point, index) => `${x(index)},${y(topValue(point))}`);
    const bottom = [...data].reverse().map((point, reverseIndex) => {
      const index = data.length - 1 - reverseIndex;
      return `${x(index)},${y(bottomValue(point))}`;
    });
    return [...top, ...bottom].join(" ");
  };
  const current = data[data.length - 1] ?? { high: 0, medium: 0, low: 0, label: "now" };
  return (
    <svg className={styles.areaChart} viewBox={`0 0 ${width} ${height}`} aria-label={`Open issues trend ending at ${current.high} high, ${current.medium} medium, and ${current.low} low issues`}>
      <polygon className={styles.areaBand} points={band((point) => point.low, () => 0)} fill="#C9A330" opacity="0.88" />
      <polygon className={styles.areaBand} points={band((point) => point.low + point.medium, (point) => point.low)} fill="#D97706" opacity="0.9" />
      <polygon className={styles.areaBand} points={band((point) => point.low + point.medium + point.high, (point) => point.low + point.medium)} fill="#DC2626" opacity="0.88" />
      {data.map((point, index) => (
        <text key={point.label} x={x(index)} y={height - 8} textAnchor="middle" className={styles.axisText}>{point.label}</text>
      ))}
    </svg>
  );
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
  const polar = (angle: number) => {
    const rad = (angle - 90) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };
  const [sx, sy] = polar(start);
  const [ex, ey] = polar(end);
  return `M ${sx} ${sy} A ${r} ${r} 0 ${end - start > 180 ? 1 : 0} 1 ${ex} ${ey}`;
}

function PlatformIcon({ platform }: { platform: AiPlatform }) {
  return (
    <span className={`${styles.platformIcon} ${styles[platform]}`}>
      <PlatformBrandIcon platform={platform} className={styles.platformSvg} />
    </span>
  );
}

function MiniGauge({ name, sub, score, platform }: { name: string; sub: string; score: number; platform: AiPlatform }) {
  const color = score >= 70 ? "#1F9D55" : score >= 40 ? "#B8902B" : "#DC2626";
  const end = 225 + 270 * (score / 100);
  return (
    <div className={styles.engineTile}>
      <div className={styles.engineHeader}>
        <PlatformIcon platform={platform} />
        <div>
          <strong>{name}</strong>
          <span>{sub}</span>
        </div>
      </div>
      <svg viewBox="0 0 116 116" className={styles.miniGauge} aria-label={`${name} ${score} percent`}>
        <path d={arcPath(58, 58, 44, 225, 495)} stroke="#ECECEC" strokeWidth="10" strokeLinecap="round" fill="none" />
        <path d={arcPath(58, 58, 44, 225, end)} stroke={color} strokeWidth="10" strokeLinecap="round" fill="none" />
        <text x="58" y="64" textAnchor="middle" className={styles.miniGaugeText}>{score}%</text>
      </svg>
    </div>
  );
}

function CoreWebVitalsPanel({ vitals }: { vitals?: StructuredAiVisibilityReport["core_web_vitals"] }) {
  const hasLabOrFieldVitals = Boolean(vitals?.mobileLcp ?? vitals?.desktopLcp ?? vitals?.cls ?? vitals?.inp ?? vitals?.performanceScore);
  const summary = vitals
    ? !hasLabOrFieldVitals && vitals.ttfb !== undefined
      ? `Limited crawl measurement · ${formatAuditDate(vitals.checkedAt)}`
      : `Measured by PageSpeed Insights · ${formatAuditDate(vitals.checkedAt)}`
    : "PageSpeed Insights data unavailable.";
  const items = [
    { label: "Mobile LCP", value: formatMs(vitals?.mobileLcp), meta: "Target <= 2.5s" },
    { label: "Desktop LCP", value: formatMs(vitals?.desktopLcp), meta: "Target <= 2.5s" },
    { label: "CLS", value: formatDecimal(vitals?.cls), meta: "Target <= 0.1" },
    { label: "INP", value: formatMs(vitals?.inp), meta: "Target <= 200ms" },
    { label: "TTFB", value: formatMs(vitals?.ttfb), meta: "Target <= 800ms" },
    { label: "Performance Score", value: formatScore(vitals?.performanceScore), meta: "Good >= 90" }
  ];

  return (
    <section className={styles.coreVitals}>
      <div className={styles.sectionHead}>
        <h2>Core Web Vitals</h2>
        <p>{summary}</p>
      </div>
      <div className={styles.coreVitalsGrid}>
        {items.map((item) => (
          <div key={item.label} className={styles.coreVitalItem}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.meta}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function IntegrationWorkspace({
  projectId,
  connections,
  loading,
  error,
  onConnectionsChange,
  onOpenSearchConsole
}: {
  projectId: string;
  connections: PublicIntegrationConnection[];
  loading: boolean;
  error: string;
  onConnectionsChange: (connections: PublicIntegrationConnection[]) => void;
  onOpenSearchConsole: () => void;
}) {
  const [propertiesByProvider, setPropertiesByProvider] = useState<Partial<Record<IntegrationProvider, ExternalProperty[]>>>({});
  const [selectedByProvider, setSelectedByProvider] = useState<Partial<Record<IntegrationProvider, string>>>({});
  const [workingProvider, setWorkingProvider] = useState<IntegrationProvider | "">("");
  const [providerErrors, setProviderErrors] = useState<Partial<Record<IntegrationProvider, string>>>({});

  async function refreshConnections() {
    const response = await fetch(`/api/integrations?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({})) as { connections?: PublicIntegrationConnection[]; message?: string };
    if (!response.ok) throw new Error(data.message ?? "Could not refresh integrations.");
    onConnectionsChange(data.connections ?? []);
  }

  async function loadProperties(provider: IntegrationProvider) {
    setWorkingProvider(provider);
    setProviderErrors((current) => ({ ...current, [provider]: undefined }));
    try {
      const response = await fetch(`/api/integrations/${provider}/properties?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as { properties?: ExternalProperty[]; message?: string };
      if (!response.ok) throw new Error(data.message ?? "Could not load properties.");
      setPropertiesByProvider((current) => ({ ...current, [provider]: data.properties ?? [] }));
    } catch (err) {
      setProviderErrors((current) => ({ ...current, [provider]: err instanceof Error ? err.message : "Could not load properties." }));
    } finally {
      setWorkingProvider("");
    }
  }

  async function saveProperty(provider: IntegrationProvider) {
    const propertyId = selectedByProvider[provider];
    const property = propertiesByProvider[provider]?.find((item) => item.id === propertyId);
    if (!propertyId) return;
    setWorkingProvider(provider);
    setProviderErrors((current) => ({ ...current, [provider]: undefined }));
    try {
      const response = await fetch(`/api/integrations/${provider}/select-property?projectId=${encodeURIComponent(projectId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyId,
          propertyName: property?.name,
          accountId: property?.accountId,
          syncNow: true
        })
      });
      const data = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Could not save property.");
      await refreshConnections();
    } catch (err) {
      setProviderErrors((current) => ({ ...current, [provider]: err instanceof Error ? err.message : "Could not save property." }));
    } finally {
      setWorkingProvider("");
    }
  }

  async function syncProvider(provider: IntegrationProvider) {
    setWorkingProvider(provider);
    setProviderErrors((current) => ({ ...current, [provider]: undefined }));
    try {
      const response = await fetch(`/api/integrations/${provider}/sync?projectId=${encodeURIComponent(projectId)}`, { method: "POST" });
      const data = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Could not sync provider.");
      await refreshConnections();
    } catch (err) {
      setProviderErrors((current) => ({ ...current, [provider]: err instanceof Error ? err.message : "Could not sync provider." }));
    } finally {
      setWorkingProvider("");
    }
  }

  return (
    <section className={styles.integrationWorkspace}>
      <div className={styles.auditHero}>
        <div>
          <p>Data connections</p>
          <h2>Integrations</h2>
          <span>Connect each provider account, map the right website property to this GLOMAUDIT project, and sync imported performance data into the dashboard.</span>
        </div>
        <div className={styles.auditHeroScore}>
          <strong>{connections.filter((connection) => connection.status === "CONNECTED").length}/3</strong>
          <span>connected</span>
          <span>project mapped</span>
        </div>
      </div>

      {error ? <p className={styles.integrationError}>{error}</p> : null}

      <div className={styles.integrationGrid}>
        {integrationProviders.map((item) => {
          const connection = connections.find((candidate) => candidate.provider === item.provider);
          const connected = connection?.status === "CONNECTED";
          const expired = connection?.status === "EXPIRED";
          const statusLabel = loading ? "Checking" : connected ? "Connected" : expired ? "Reconnect required" : "Not connected";
          const returnTo = `/report/${projectId}?integration=1`;
          const connectUrl = `/api/integrations/${item.provider}/connect?projectId=${encodeURIComponent(projectId)}&returnTo=${encodeURIComponent(returnTo)}`;
          const properties = propertiesByProvider[item.provider];
          const providerError = providerErrors[item.provider];
          const working = workingProvider === item.provider;

          return (
            <article className={`${styles.card} ${styles.integrationCard}`} key={item.provider}>
              <div className={styles.integrationCardTop}>
                <span className={styles.integrationLogo} style={{ background: item.accent }}>{item.shortName}</span>
                <div>
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                </div>
                <em className={connected ? styles.passed : expired ? styles.needs : styles.skipped}>{statusLabel}</em>
              </div>

              <div className={styles.integrationDetails}>
                <div>
                  <span>Account</span>
                  <strong>{connection?.accountEmail ?? (connected ? "Connected account" : "No account connected")}</strong>
                </div>
                <div>
                  <span>Selected property</span>
                  <strong>{connection?.externalPropertyName ?? connection?.externalPropertyId ?? "No property selected"}</strong>
                </div>
                <div>
                  <span>Last sync</span>
                  <strong>{connection?.lastSyncedAt ? formatAuditDate(connection.lastSyncedAt) : "Not synced yet"}</strong>
                </div>
                <div>
                  <span>Imported range</span>
                  <strong>{connection?.importedStartDate && connection.importedEndDate ? `${connection.importedStartDate} to ${connection.importedEndDate}` : "No imported data"}</strong>
                </div>
              </div>

              {connected ? (
                <div className={styles.integrationPropertyBox}>
                  <div className={styles.integrationActions}>
                    <button className={styles.secondary} type="button" onClick={() => loadProperties(item.provider)} disabled={working}>
                      {working ? "Loading..." : "Load properties"}
                    </button>
                    {connection?.externalPropertyId ? (
                      <button className={styles.primary} type="button" onClick={() => syncProvider(item.provider)} disabled={working}>
                        {working ? "Syncing..." : "Sync now"}
                      </button>
                    ) : null}
                    {item.provider === "GOOGLE_SEARCH_CONSOLE" && connection?.externalPropertyId ? (
                      <button className={styles.secondary} type="button" onClick={onOpenSearchConsole}>
                        View dashboard
                      </button>
                    ) : null}
                  </div>
                  {properties ? (
                    properties.length ? (
                      <div className={styles.integrationPicker}>
                        <select value={selectedByProvider[item.provider] ?? ""} onChange={(event) => setSelectedByProvider((current) => ({ ...current, [item.provider]: event.target.value }))}>
                          <option value="">Select property</option>
                          {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                        </select>
                        <button className={styles.primary} type="button" onClick={() => saveProperty(item.provider)} disabled={working || !selectedByProvider[item.provider]}>
                          {working ? "Saving..." : "Save and sync 90 days"}
                        </button>
                      </div>
                    ) : (
                      <p className={styles.integrationHelp}>No properties were returned. Make sure this Google account has access to the Search Console or GA4 property, and the provider API is enabled in Google Cloud.</p>
                    )
                  ) : null}
                </div>
              ) : null}

              {connection?.lastSyncError ? <p className={styles.integrationError}>{connection.lastSyncError}</p> : null}
              {providerError ? <p className={styles.integrationError}>{providerError}</p> : null}

              <div className={styles.integrationActions}>
                {connected ? (
                  <a className={styles.secondary} href={connectUrl}>Reconnect</a>
                ) : (
                  <a className={styles.primary} href={connectUrl}>{expired ? "Reconnect account" : "Connect account"}</a>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <article className={`${styles.card} ${styles.integrationNote}`}>
        <h3>How connection works</h3>
        <p>Google Search Console and Google Analytics use read-only Google OAuth. Bing uses Microsoft OAuth for the user account. Tokens are stored encrypted on the server, and dashboard reports read imported MongoDB rows instead of calling providers on every page load.</p>
      </article>
    </section>
  );
}

function SearchConsoleReportPanel({
  projectId,
  reportUrl,
  tabs,
  vitals,
  onBack
}: {
  projectId: string;
  reportUrl: string;
  tabs: Record<AuditTabId, TabInfo>;
  vitals?: StructuredAiVisibilityReport["core_web_vitals"];
  onBack: () => void;
}) {
  const [data, setData] = useState<PerformanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [activeTable, setActiveTable] = useState("Top queries");
  const [activeRange, setActiveRange] = useState("Custom");
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  const [activeConsoleView, setActiveConsoleView] = useState("Performance");

  const load = useCallback(async (range?: { startDate: string; endDate: string }) => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ projectId });
    if (range) {
      query.set("startDate", range.startDate);
      query.set("endDate", range.endDate);
    }
    try {
      const response = await fetch(`/api/performance/search-console?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as PerformanceDashboard & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Could not load Google Search Console data.");
      setData(payload);
      setStartDate((current) => current || payload.range.startDate);
      setEndDate((current) => current || payload.range.endDate);
      const firstTable = Object.keys(payload.tables ?? {}).find((key) => (payload.tables[key] ?? []).length);
      if (firstTable) setActiveTable(firstTable);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Google Search Console data.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const applyDateRange = useCallback(() => {
    setActiveRange("Custom");
    if ((startDate && !endDate) || (!startDate && endDate)) {
      setError("Select both start and end dates before applying.");
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      setError("Start date must be before end date.");
      return;
    }
    setCustomRangeOpen(false);
    void load(startDate && endDate ? { startDate, endDate } : undefined);
  }, [endDate, load, startDate]);

  const applyPresetRange = useCallback((label: string, days: number) => {
    const end = data?.range.endDate ?? formatInputDate(new Date());
    const start = subtractIsoDays(end, days - 1);
    setActiveRange(label);
    setCustomRangeOpen(false);
    setStartDate(start);
    setEndDate(end);
    void load({ startDate: start, endDate: end });
  }, [data?.range.endDate, load]);

  const openConsoleView = useCallback((view: string, table?: string) => {
    setActiveConsoleView(view);
    if (table) setActiveTable(table);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const csv = useMemo(() => {
    if (!data?.trends?.length) return "";
    const headers = Object.keys(data.trends[0]);
    return [headers.join(","), ...data.trends.map((row) => headers.map((key) => JSON.stringify(row[key] ?? "")).join(","))].join("\n");
  }, [data]);

  const tables = data?.tables ?? {};
  const tableNames = ["Top queries", "Top pages", "Top countries", "Device distribution", "Low CTR, high impression queries", "Keywords positions 4 to 20"].filter((name) => tables[name]);
  const propertyName = data?.connection?.externalPropertyName ?? data?.connection?.externalPropertyId ?? "Selected property";
  const lastSync = data?.connection?.lastSyncedAt ? formatAuditDate(data.connection.lastSyncedAt) : "Not synced yet";
  const importedRange = data?.connection?.importedStartDate && data.connection.importedEndDate ? `${data.connection.importedStartDate} to ${data.connection.importedEndDate}` : "No imported data";

  return (
    <section className={styles.gscConsoleShell}>
      <aside className={styles.gscConsoleSidebar}>
        <button className={`${styles.gscPropertySelector} ${activeConsoleView === "Property" ? styles.gscConsoleNavActive : ""}`} type="button" onClick={() => openConsoleView("Property")}>
          <span>{propertyName}</span>
        </button>
        {["Overview", "Insights", "Performance", "URL inspection"].map((item) => (
          <button key={item} className={activeConsoleView === item ? styles.gscConsoleNavActive : ""} type="button" onClick={() => openConsoleView(item, item === "Insights" ? "Low CTR, high impression queries" : undefined)}>
            {item}
          </button>
        ))}
        <div className={styles.gscConsoleNavGroup}>
          <p>Indexing</p>
          <button className={activeConsoleView === "Indexing" ? styles.gscConsoleNavActive : ""} type="button" onClick={() => openConsoleView("Indexing")}>Indexing</button>
          <button className={activeConsoleView === "Pages" ? styles.gscConsoleNavActive : ""} type="button" onClick={() => openConsoleView("Pages", "Top pages")}>Pages</button>
          <button className={activeConsoleView === "Sitemaps" ? styles.gscConsoleNavActive : ""} type="button" onClick={() => openConsoleView("Sitemaps")}>Sitemaps</button>
          <button className={activeConsoleView === "Removals" ? styles.gscConsoleNavActive : ""} type="button" onClick={() => openConsoleView("Removals")}>Removals</button>
        </div>
        <div className={styles.gscConsoleNavGroup}>
          <p>Experience</p>
          <button className={activeConsoleView === "Experience" ? styles.gscConsoleNavActive : ""} type="button" onClick={() => openConsoleView("Experience")}>Experience</button>
          <button className={activeConsoleView === "Core Web Vitals" ? styles.gscConsoleNavActive : ""} type="button" onClick={() => openConsoleView("Core Web Vitals")}>Core Web Vitals</button>
          <button className={activeConsoleView === "HTTPS" ? styles.gscConsoleNavActive : ""} type="button" onClick={() => openConsoleView("HTTPS")}>HTTPS</button>
        </div>
        <dl className={styles.gscConsolePropertyMeta}>
          <div><dt>Account</dt><dd>{data?.connection?.accountEmail ?? "Connected account"}</dd></div>
          <div><dt>Last sync</dt><dd>{lastSync}</dd></div>
        </dl>
      </aside>

      <div className={styles.gscConsoleMain}>
        <div className={styles.gscConsoleHeader}>
          <div>
            <p>Google Search Console</p>
            <h2>{activeConsoleView}</h2>
          </div>
          <div className={styles.gscHeaderActions}>
            <button className={styles.secondary} type="button" onClick={onBack}>Back to integrations</button>
            <a className={styles.secondary} href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="google-search-console-performance.csv"><Download size={15} /> Export CSV</a>
          </div>
        </div>

        <div className={styles.gscFilterBar}>
          <button className={`${styles.gscRangeChip} ${activeRange === "24 hours" ? styles.gscRangeChipActive : ""}`} type="button" onClick={() => applyPresetRange("24 hours", 1)}>24 hours</button>
          <button className={`${styles.gscRangeChip} ${activeRange === "7 days" ? styles.gscRangeChipActive : ""}`} type="button" onClick={() => applyPresetRange("7 days", 7)}>7 days</button>
          <button className={`${styles.gscRangeChip} ${activeRange === "28 days" ? styles.gscRangeChipActive : ""}`} type="button" onClick={() => applyPresetRange("28 days", 28)}>28 days</button>
          <div className={styles.gscCustomPicker}>
            <button
              className={`${styles.gscRangeChip} ${activeRange === "Custom" ? styles.gscRangeChipActive : ""}`}
              type="button"
              onClick={() => {
                setActiveRange("Custom");
                setCustomRangeOpen((open) => !open);
              }}
            >
              Custom
            </button>
            {customRangeOpen ? (
              <div className={styles.gscCustomRange}>
              <label><span>Start</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
              <label><span>End</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
              <button className={styles.primary} type="button" onClick={applyDateRange} disabled={loading}>{loading ? "Loading..." : "Apply"}</button>
              </div>
            ) : null}
          </div>
          <span className={styles.gscFilterMeta}>{data ? `${data.range.startDate} to ${data.range.endDate}` : "Select a date range"}</span>
        </div>

        {error ? <p className={styles.integrationError}>{error}</p> : null}
        {!loading && data && !data.connection ? <p className={styles.integrationHelp}>Connect Google Search Console, select a property, and sync data before viewing performance.</p> : null}

        {loading && !data ? (
          <div className={styles.gscSkeletonGrid}>{[1, 2, 3, 4].map((item) => <i key={item} />)}</div>
        ) : data ? (
          activeConsoleView === "Performance" ? (
          <>
            <article className={`${styles.card} ${styles.gscChartCard}`}>
              <div className={styles.gscMetricStrip}>
                {data.metrics.map((metric) => <SearchConsoleMetric key={metric.label} metric={metric} />)}
              </div>
              <div className={styles.cardTitle}>
                <div><h2>Performance graph</h2><p>Daily Search Console trend</p></div>
                <span className={styles.gscChartGranularity}>Daily</span>
              </div>
              <SearchConsoleChart points={data.trends} />
            </article>

            <div className={`${styles.card} ${styles.gscTableLayout}`}>
              <div className={styles.gscTableTabs}>
                {tableNames.map((name) => <button key={name} className={activeTable === name ? styles.gscTableTabActive : ""} type="button" onClick={() => setActiveTable(name)}>{formatGscTableName(name)}</button>)}
              </div>
              <SearchConsoleTable title={activeTable} rows={tables[activeTable] ?? []} />
            </div>
          </>
          ) : (
            <SearchConsoleViewPanel
              view={activeConsoleView}
              propertyName={propertyName}
              reportUrl={reportUrl}
              importedRange={importedRange}
              activeTable={activeTable}
              tables={tables}
              rows={tables[activeTable] ?? []}
              metrics={data.metrics}
              trends={data.trends}
              tabs={tabs}
              vitals={vitals}
            />
          )
        ) : null}
      </div>
    </section>
  );
}

function SearchConsoleMetric({ metric }: { metric: DashboardMetric }) {
  const active = metric.label === "Total clicks" || metric.label === "Total impressions";
  return (
    <article className={`${styles.gscMetric} ${active ? styles.gscMetricActive : ""}`}>
      <p>{metric.label}</p>
      <strong>{metric.value}</strong>
    </article>
  );
}

function SearchConsoleChart({ points }: { points: Array<Record<string, number | string>> }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const visible = points;
  const clicks = visible.map((point) => Number(point.clicks ?? 0));
  const impressions = visible.map((point) => Number(point.impressions ?? 0));
  const maxValue = Math.max(...clicks, ...impressions, 3);
  const chart = { left: 18, top: 28, width: 684, height: 210, bottom: 238 };
  const activeIndex = hoverIndex ?? Math.max(visible.length - 1, 0);
  const activePoint = visible[activeIndex];
  const activeX = chartX(activeIndex, visible.length, chart);
  const activeClickY = chartY(clicks[activeIndex] ?? 0, maxValue, chart);
  const activeImpressionY = chartY(impressions[activeIndex] ?? 0, maxValue, chart);
  const noActivity = clicks.every((value) => value === 0) && impressions.every((value) => value === 0);

  if (!visible.length) return <p className={styles.integrationHelp}>No graph data was imported for this range.</p>;

  const handlePointerMove = (event: MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 720;
    const index = Math.round(((x - chart.left) / chart.width) * Math.max(visible.length - 1, 1));
    setHoverIndex(Math.min(Math.max(index, 0), visible.length - 1));
  };

  return (
    <div className={styles.gscChartWrap}>
      <svg
        className={styles.gscChart}
        viewBox="0 0 720 300"
        preserveAspectRatio="none"
        aria-label="Google Search Console clicks and impressions graph"
        onMouseMove={handlePointerMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <rect x="0" y="0" width="720" height="300" rx="18" fill="#fff" />
        {[0, 1, 2, 3, 4].map((line) => {
          const y = chart.top + line * (chart.height / 4);
          const labelValue = maxValue * (1 - line / 4);
          return (
            <g key={line}>
              <line x1={chart.left} x2={chart.left + chart.width} y1={y} y2={y} stroke="#ECECEC" />
              <text x="18" y={y - 6} fill="#9A9A9A" fontSize="10" fontWeight="700">{formatCompactNumber(labelValue)}</text>
            </g>
          );
        })}
        <path d={linePath(impressions, maxValue, chart)} fill="none" stroke="#2B2B2B" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
        <path d={linePath(clicks, maxValue, chart)} fill="none" stroke="#D4AF37" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
        <line x1={chart.left} x2={chart.left + chart.width} y1={chart.bottom} y2={chart.bottom} stroke="#DADADA" />
        <line x1={activeX} x2={activeX} y1={chart.top} y2={chart.bottom} stroke="#111111" strokeOpacity="0.14" />
        <circle cx={activeX} cy={activeImpressionY} r="3.5" fill="#fff" stroke="#2B2B2B" strokeWidth="1.6" opacity="0.8" />
        <circle cx={activeX} cy={activeClickY} r="4" fill="#fff" stroke="#D4AF37" strokeWidth="1.8" />
        <text x={chart.left} y="280" fill="#777" fontSize="12" fontWeight="800">{formatChartDate(String(visible[0]?.date ?? ""))}</text>
        <text x={chart.left + chart.width / 2} y="280" textAnchor="middle" fill="#777" fontSize="12" fontWeight="800">{formatChartDate(String(visible[Math.floor(visible.length / 2)]?.date ?? ""))}</text>
        <text x={chart.left + chart.width} y="280" textAnchor="end" fill="#777" fontSize="12" fontWeight="800">{formatChartDate(String(visible[visible.length - 1]?.date ?? ""))}</text>
        {noActivity ? <text x="360" y="145" textAnchor="middle" fill="#777" fontSize="13" fontWeight="800">No clicks or impressions in this date range</text> : null}
      </svg>
      {activePoint ? (
        <div
          className={styles.gscChartTooltip}
          style={{ left: `${(activeX / 720) * 100}%`, top: `${(Math.min(activeClickY, activeImpressionY) / 300) * 100}%` }}
        >
          <b>{formatChartDate(String(activePoint.date ?? ""))}</b>
          <span><i className={styles.gscClicks} />{formatCompactNumber(clicks[activeIndex] ?? 0)} clicks</span>
          <span><i className={styles.gscImpressions} />{formatCompactNumber(impressions[activeIndex] ?? 0)} impressions</span>
        </div>
      ) : null}
    </div>
  );
}

function chartX(index: number, length: number, chart: { left: number; width: number }) {
  if (length <= 1) return chart.left + chart.width / 2;
  return chart.left + (index / (length - 1)) * chart.width;
}

function chartY(value: number, max: number, chart: { top: number; height: number }) {
  return chart.top + (1 - value / Math.max(max, 1)) * chart.height;
}

function linePath(values: number[], max: number, chart: { left: number; top: number; width: number; height: number }) {
  if (!values.length) return "";
  return values.map((value, index) => {
    const x = chartX(index, values.length, chart);
    const y = chartY(value, max, chart);
    return `${index ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Math.round(value));
}

function formatChartDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

function SearchConsoleTable({ title, rows }: { title: string; rows: DashboardTableRow[] }) {
  return (
    <article className={styles.gscTableCard}>
      <div className={styles.cardTitle}><h2>{title}</h2><p>{rows.length} rows</p></div>
      {rows.length ? (
        <div className={styles.gscTableWrap}>
          <table>
            <thead><tr><th>Item</th><th>Primary</th><th>Secondary</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.label}-${row.value}-${row.secondary}`}>
                  <td title={row.label}>{row.label}</td>
                  <td>{row.value}</td>
                  <td>{row.secondary ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className={styles.integrationHelp}>No rows for this date range.</p>}
    </article>
  );
}

function SearchConsoleViewPanel({
  view,
  propertyName,
  reportUrl,
  importedRange,
  activeTable,
  tables,
  rows,
  metrics,
  trends,
  tabs,
  vitals
}: {
  view: string;
  propertyName: string;
  reportUrl: string;
  importedRange: string;
  activeTable: string;
  tables: PerformanceDashboard["tables"];
  rows: DashboardTableRow[];
  metrics: DashboardMetric[];
  trends: PerformanceDashboard["trends"];
  tabs: Record<AuditTabId, TabInfo>;
  vitals?: StructuredAiVisibilityReport["core_web_vitals"];
}) {
  const queryRows = tables["Top queries"] ?? [];
  const pageRows = tables["Top pages"] ?? [];
  const countryRows = tables["Top countries"] ?? [];
  const deviceRows = tables["Device distribution"] ?? [];
  const lowCtrRows = tables["Low CTR, high impression queries"] ?? [];
  const indexChecks = checksMatching([tabs.indexability, tabs.crawlability], /index|canonical|noindex|robots|crawl|render|sitemap/i);
  const sitemapChecks = checksMatching([tabs.indexability, tabs.crawlability], /sitemap|xml/i);
  const removalChecks = checksMatching([tabs.indexability], /noindex|x-robots|robots|nosnippet|snippet|blocked|removal/i);
  const httpsChecks = checksMatching([tabs.technical, tabs.pageSpeed], /https|ssl|tls|mixed content|certificate/i);
  const experienceChecks = checksMatching([tabs.pageSpeed], /lcp|inp|cls|fcp|ttfb|speed|performance|core web/i);
  const urlChecks = checksMatching([tabs.indexability, tabs.technical], /url|canonical|redirect|https|index|robots/i).slice(0, 8);
  const headline = view === "Overview"
    ? "Property overview"
    : view === "Insights"
      ? "Search insights"
      : view;
  const description = view === "Overview"
    ? "A quick summary of the connected property and imported Search Console range."
    : view === "Insights"
      ? "Queries that may need title, snippet, or content improvements."
      : view === "Property"
        ? "Connected Search Console property details."
        : view === "URL inspection"
          ? "Indexability and access checks for the report URL."
          : view === "Pages"
          ? "Imported page performance rows for this date range."
          : view === "Indexing"
            ? "Indexing, crawl, robots, canonical, and sitemap evidence from this audit."
            : view === "Sitemaps"
              ? "Sitemap discovery and validation evidence from the audit."
              : view === "Removals"
                ? "Noindex, robots, and snippet-control signals that can remove or suppress URLs."
                : view === "Experience"
                  ? "Page experience and speed checks from the audit."
                  : view === "Core Web Vitals"
                    ? "Measured lab and field-style Core Web Vitals values."
                    : view === "HTTPS"
                      ? "HTTPS, SSL, and secure loading evidence."
                      : "Search Console details for this section.";

  return (
    <article className={`${styles.card} ${styles.gscConsoleViewCard}`}>
      <div className={styles.cardTitle}>
        <div><h2>{headline}</h2><p>{description}</p></div>
      </div>
      {view === "Overview" || view === "Property" ? (
        <>
          <div className={styles.gscOverviewGrid}>
            <div><span>Property</span><strong>{propertyName}</strong></div>
            <div><span>Imported range</span><strong>{importedRange}</strong></div>
            <div><span>Daily points</span><strong>{trends.length}</strong></div>
            {metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
          </div>
          {view === "Overview" ? (
            <div className={styles.gscOverviewTables}>
              <MiniRows title="Top queries" rows={queryRows.slice(0, 5)} />
              <MiniRows title="Top pages" rows={pageRows.slice(0, 5)} />
              <MiniRows title="Devices" rows={deviceRows.slice(0, 5)} />
            </div>
          ) : null}
        </>
      ) : view === "Insights" || view === "Pages" ? (
        <SearchConsoleTable title={activeTable} rows={rows} />
      ) : view === "URL inspection" ? (
        <>
          <div className={styles.gscOverviewGrid}>
            <div><span>Inspected URL</span><strong>{reportUrl}</strong></div>
            <div><span>Indexability score</span><strong>{formatScore(tabs.indexability.score)}</strong></div>
            <div><span>Indexing issues</span><strong>{tabs.indexability.issues}</strong></div>
          </div>
          <AuditCheckList checks={urlChecks} emptyText="No URL inspection issues were found in the latest audit." />
        </>
      ) : view === "Indexing" ? (
        <>
          <CategorySummary tab={tabs.indexability} />
          <AuditCheckList checks={indexChecks} emptyText="No indexing issues were found in the latest audit." />
        </>
      ) : view === "Sitemaps" ? (
        <AuditCheckList checks={sitemapChecks} emptyText="No sitemap issues were found in the latest audit." />
      ) : view === "Removals" ? (
        <AuditCheckList checks={removalChecks} emptyText="No removal or noindex issues were found in the latest audit." />
      ) : view === "Experience" ? (
        <>
          <CategorySummary tab={tabs.pageSpeed} />
          <AuditCheckList checks={experienceChecks} emptyText="No page experience issues were found in the latest audit." />
        </>
      ) : view === "Core Web Vitals" ? (
        <CoreVitalsSummary vitals={vitals} checks={experienceChecks} />
      ) : view === "HTTPS" ? (
        <AuditCheckList checks={httpsChecks} emptyText="No HTTPS or SSL issues were found in the latest audit." />
      ) : (
        <SearchConsoleTable title={activeTable} rows={rows} />
      )}
    </article>
  );
}

function MiniRows({ title, rows }: { title: string; rows: DashboardTableRow[] }) {
  return (
    <div className={styles.gscMiniRows}>
      <h3>{title}</h3>
      {rows.length ? rows.map((row) => (
        <p key={`${title}-${row.label}`}>
          <span>{row.label}</span>
          <b>{row.value}</b>
        </p>
      )) : <em>No rows for this range.</em>}
    </div>
  );
}

function CategorySummary({ tab }: { tab: TabInfo }) {
  return (
    <div className={styles.gscCategorySummary}>
      <div><span>Score</span><strong>{formatScore(tab.score)}</strong></div>
      <div><span>Open issues</span><strong>{tab.issues}</strong></div>
      <div><span>Checked</span><strong>{formatAuditDate(tab.checkedAt)}</strong></div>
      <div><span>Categories</span><strong>{tab.categories.length}</strong></div>
    </div>
  );
}

function CoreVitalsSummary({ vitals, checks }: { vitals?: StructuredAiVisibilityReport["core_web_vitals"]; checks: CheckLike[] }) {
  const items = [
    { label: "Mobile LCP", value: formatMs(vitals?.mobileLcp) },
    { label: "Desktop LCP", value: formatMs(vitals?.desktopLcp) },
    { label: "CLS", value: formatDecimal(vitals?.cls) },
    { label: "INP", value: formatMs(vitals?.inp) },
    { label: "TTFB", value: formatMs(vitals?.ttfb) },
    { label: "Performance score", value: formatScore(vitals?.performanceScore) }
  ];
  return (
    <>
      <div className={styles.gscOverviewGrid}>
        {items.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}
      </div>
      <AuditCheckList checks={checks} emptyText="No Core Web Vitals issues were found in the latest audit." />
    </>
  );
}

function AuditCheckList({ checks, emptyText }: { checks: CheckLike[]; emptyText: string }) {
  const visible = checks.slice(0, 12);
  if (!visible.length) return <p className={styles.integrationHelp}>{emptyText}</p>;
  return (
    <div className={styles.gscCheckList}>
      {visible.map((check) => {
        const passed = Boolean(check.passed) && !check.warning;
        const skipped = Boolean(check.skipped || check.notApplicable);
        return (
          <div key={`${check.category}-${check.name}-${check.id ?? ""}`}>
            <span className={passed ? styles.passed : skipped ? styles.skipped : check.warning ? styles.minor : styles.needs}>
              {passed ? "Passed" : skipped ? "Skipped" : check.warning ? "Warning" : "Issue"}
            </span>
            <strong>{check.name ?? "Audit check"}</strong>
            <p>{check.issueSummary || check.whatIsWrong || readableEvidence(check.evidence) || "No additional evidence was provided."}</p>
          </div>
        );
      })}
    </div>
  );
}

function checksMatching(tabs: TabInfo[], pattern: RegExp) {
  return tabs.flatMap((tab) => tab.checks).filter((check) =>
    pattern.test(`${check.category ?? ""} ${check.name ?? ""} ${check.issueSummary ?? ""} ${check.whatIsWrong ?? ""} ${readableEvidence(check.evidence)}`)
  );
}

function readableEvidence(evidence: unknown) {
  if (!evidence) return "";
  if (typeof evidence === "string") return evidence;
  if (typeof evidence === "number" || typeof evidence === "boolean") return String(evidence);
  try {
    return JSON.stringify(evidence);
  } catch {
    return "";
  }
}

function formatGscTableName(name: string) {
  if (name === "Top queries") return "Queries";
  if (name === "Top pages") return "Pages";
  if (name === "Top countries") return "Countries";
  if (name === "Device distribution") return "Devices";
  if (name === "Low CTR, high impression queries") return "Search appearance";
  if (name === "Keywords positions 4 to 20") return "Days";
  return name;
}

function formatInputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function subtractIsoDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() - days);
  return formatInputDate(date);
}

function pageSpeedMetricStatus(value: number | undefined, good: number, direction: "under" | "over" = "under") {
  if (value === undefined || !Number.isFinite(value)) return { label: "N/A", className: styles.skipped };
  const passed = direction === "under" ? value <= good : value >= good;
  return passed ? { label: "Good", className: styles.passed } : { label: "Needs Improvement", className: styles.minor };
}

function pageSpeedCheckStatus(check?: CheckLike) {
  if (!check) return { label: "N/A", className: styles.skipped };
  if (check.skipped) return { label: "Skipped", className: styles.skipped };
  if (check.passed) return { label: "Good", className: styles.passed };
  if (check.warning) return { label: "Warning", className: styles.minor };
  return { label: "Issue", className: styles.needs };
}

function findCheck(checks: CheckLike[], ...names: string[]) {
  const normalizedNames = names.map((name) => name.toLowerCase());
  return checks.find((check) => normalizedNames.some((name) => String(check.name ?? "").toLowerCase().includes(name)));
}

function parsedEvidenceRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function numberFromEvidence(check: CheckLike | undefined, metricPattern?: RegExp) {
  if (!check) return undefined;
  const record = parsedEvidenceRecord(check.evidence);
  if (record) {
    const metricName = String(record.metric ?? record.name ?? "");
    if (!metricPattern || metricPattern.test(metricName)) {
      for (const key of ["measuredValue", "value", "score", "numericValue"]) {
        const value = Number(record[key]);
        if (Number.isFinite(value)) return value;
      }
    }
  }
  const text = evidenceText(check.evidence);
  if (metricPattern && !metricPattern.test(`${check.name ?? ""} ${text}`)) return undefined;
  const match = text.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : undefined;
}

function pageSpeedScoreFromCheck(check: CheckLike | undefined) {
  const value = numberFromEvidence(check);
  return value !== undefined ? clampScore(value) : undefined;
}

function findMetricCheck(checks: CheckLike[], metricPattern: RegExp, ...nameHints: string[]) {
  return checks.find((check) => {
    const text = `${check.name ?? ""} ${evidenceText(check.evidence)}`;
    return metricPattern.test(text) && (!nameHints.length || nameHints.some((hint) => text.toLowerCase().includes(hint.toLowerCase())));
  });
}

function PageSpeedScoreDonut({ score }: { score: number }) {
  const r = 72;
  const c = 2 * Math.PI * r;
  const color = score >= 90 ? "#1F9D55" : score >= 60 ? "#D97706" : "#DC2626";
  return (
    <svg className={styles.pageSpeedGauge} viewBox="0 0 180 180" aria-label={`PageSpeed score ${score} percent`}>
      <circle cx="90" cy="90" r={r} fill="none" stroke="#ECECEC" strokeWidth="14" />
      <circle cx="90" cy="90" r={r} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (score / 100) * c} transform="rotate(-90 90 90)" />
      <text x="90" y="94" textAnchor="middle" className={styles.pageSpeedGaugeText}>{score}</text>
      <text x="90" y="116" textAnchor="middle" className={styles.pageSpeedGaugeSub}>{statusLabel(score)}</text>
    </svg>
  );
}

function PageSpeedOverviewPanel({ tab, vitals }: { tab: TabInfo; vitals?: StructuredAiVisibilityReport["core_web_vitals"] }) {
  const checks = tab.checks;
  const passed = checks.filter((check) => check.passed && !check.skipped && !check.warning).length;
  const warnings = checks.filter((check) => check.warning && !check.skipped).length;
  const issues = checks.filter((check) => !check.passed && !check.skipped && !check.warning).length;
  const skipped = checks.filter((check) => check.skipped).length;
  const mobileScoreCheck = findCheck(checks, "Mobile PSI", "Mobile PageSpeed", "Mobile performance");
  const mobileScore = vitals?.mobilePerformanceScore ?? vitals?.performanceScore ?? pageSpeedScoreFromCheck(mobileScoreCheck);
  const desktopScoreCheck = findCheck(checks, "Desktop PSI");
  const desktopScoreMatch = evidenceText(desktopScoreCheck?.evidence).match(/(\d{1,3})\s*(?:via|$)/i);
  const desktopScore = vitals?.desktopPerformanceScore ?? pageSpeedScoreFromCheck(desktopScoreCheck) ?? (desktopScoreMatch ? clampScore(Number(desktopScoreMatch[1])) : undefined);
  const lcpCheck = findMetricCheck(checks, /\bLCP\b|Largest Contentful Paint/i, "lcp");
  const inpCheck = findMetricCheck(checks, /\bINP\b|Interaction to Next Paint/i, "inp");
  const clsCheck = findMetricCheck(checks, /\bCLS\b|Cumulative Layout Shift/i, "cls");
  const fcpCheck = findMetricCheck(checks, /\bFCP\b|First Contentful Paint/i, "fcp");
  const speedIndexCheck = findMetricCheck(checks, /Speed Index/i, "speed index");
  const ttfbCheck = findCheck(checks, "TTFB < 500ms", "TTFB <800ms", "TTFB");
  const lcp = vitals?.mobileLcp ?? numberFromEvidence(lcpCheck, /\bLCP\b|Largest Contentful Paint/i);
  const inp = vitals?.inp ?? numberFromEvidence(inpCheck, /\bINP\b|Interaction to Next Paint/i);
  const cls = vitals?.cls ?? numberFromEvidence(clsCheck, /\bCLS\b|Cumulative Layout Shift/i);
  const fcp = vitals?.fcp ?? numberFromEvidence(fcpCheck, /\bFCP\b|First Contentful Paint/i);
  const ttfb = vitals?.ttfb ?? numberFromEvidence(ttfbCheck, /\bTTFB\b|Time to First Byte/i);
  const speedIndex = vitals?.speedIndex ?? numberFromEvidence(speedIndexCheck, /Speed Index/i);
  const compressionCheck = findCheck(checks, "Compression on All Text Assets", "GZIP/Brotli", "compression");
  const cacheCheck = findCheck(checks, "Cache-Control");
  const cdnCheck = findCheck(checks, "CDN Edge Caching", "CDN");
  const imageCheck = findCheck(checks, "Image Compression", "WebP", "AVIF");
  const unusedCssCheck = findCheck(checks, "Unused CSS");
  const renderBlockingCheck = findCheck(checks, "render-blocking");
  const preloadCheck = findCheck(checks, "Preload Critical Resources", "LCP image preloaded");
  const lazyCheck = findCheck(checks, "Below-Fold Images Lazy-Loaded", "lazy");
  const hasPageSpeedEvidence = [mobileScore, desktopScore, lcp, inp, cls, fcp, ttfb, speedIndex].some((value) => value !== undefined && Number.isFinite(value));
  const source = vitals?.source ?? (hasPageSpeedEvidence ? "PageSpeed Insights" : vitals?.ttfb !== undefined ? "Crawl Timing" : "PageSpeed Insights");
  const score = mobileScore !== undefined ? clampScore(mobileScore) : tab.available ? tab.score : undefined;
  const pageSpeedUnavailable = !hasPageSpeedEvidence || source === "Crawl Timing";

  const metricRows = [
    { label: "LCP", detail: "Largest Contentful Paint", value: formatMs(lcp), status: pageSpeedMetricStatus(lcp, 2500) },
    { label: "INP", detail: "Interaction to Next Paint", value: formatMs(inp), status: pageSpeedMetricStatus(inp, 200) },
    { label: "CLS", detail: "Cumulative Layout Shift", value: formatDecimal(cls), status: pageSpeedMetricStatus(cls, 0.1) },
    { label: "FCP", detail: "First Contentful Paint", value: formatMs(fcp), status: pageSpeedMetricStatus(fcp, 1800) },
    { label: "TTFB", detail: "Time to First Byte", value: formatMs(ttfb), status: pageSpeedMetricStatus(ttfb, 500) },
    { label: "Speed Index", detail: "Visual load progress", value: formatMs(speedIndex), status: pageSpeedMetricStatus(speedIndex, 3400) }
  ];
  const serverRows = [
    { label: "Server Response", value: formatMs(ttfb), status: pageSpeedMetricStatus(ttfb, 500) },
    { label: "Compression", value: compressionCheck ? (compressionCheck.passed ? "Enabled" : "Review") : "N/A", status: pageSpeedCheckStatus(compressionCheck) },
    { label: "Browser Cache", value: cacheCheck ? (cacheCheck.passed ? "Enabled" : "Review") : "N/A", status: pageSpeedCheckStatus(cacheCheck) },
    { label: "CDN Detection", value: cdnCheck ? (cdnCheck.passed ? "Detected" : "Review") : "N/A", status: pageSpeedCheckStatus(cdnCheck) }
  ];
  const resourceRows = [
    { label: "Images", check: imageCheck },
    { label: "Unused CSS", check: unusedCssCheck },
    { label: "Render-blocking", check: renderBlockingCheck },
    { label: "Critical preload", check: preloadCheck },
    { label: "Lazy loading", check: lazyCheck }
  ];
  const pageSpeedSections = pageSpeedInsightSections(checks);
  const lighthouseCategories = vitals?.lighthouse?.categories ?? [];
  const lighthousePerformance = lighthouseCategories.find((category) => category.id === "performance");
  const actualInsights = lighthousePerformance ? lighthousePerformance.insights.map(lighthouseInsightRow) : pageSpeedSections.insights;
  const actualDiagnostics = lighthousePerformance ? lighthousePerformance.diagnostics.map(lighthouseInsightRow) : pageSpeedSections.diagnostics;
  const actualPassed = lighthousePerformance ? lighthousePerformance.passed.map(lighthouseInsightRow) : pageSpeedSections.passed;
  const actualSkipped = lighthousePerformance ? [...lighthousePerformance.notApplicable, ...lighthousePerformance.manual].map(lighthouseInsightRow) : pageSpeedSections.skipped;
  const topInsights = [...actualInsights, ...actualDiagnostics].slice(0, 4);
  const rolePriorities = pageSpeedRolePriorities([...actualInsights, ...actualDiagnostics], metricRows, serverRows);

  return (
    <section className={styles.pageSpeedPanel}>
      <div className={styles.auditHero}>
        <div>
          <p>Audit workspace</p>
          <h2>PageSpeed Overview</h2>
          <span>{pageSpeedUnavailable ? "Google PageSpeed Insights did not return Lighthouse data for this saved report. Showing crawler timing that was available." : "Review Core Web Vitals, PageSpeed checks, server timing, asset optimization, and the highest-impact performance fixes."}</span>
        </div>
        <div className={styles.auditHeroScore}>
          <strong>{score !== undefined ? `${score}%` : "N/A"}</strong>
          <span>{pageSpeedUnavailable ? "PSI unavailable" : `${issues} open issues`}</span>
          <span>{skipped} skipped checks</span>
        </div>
      </div>

      <div className={styles.pageSpeedCommandCenter}>
        <article className={`${styles.card} ${styles.pageSpeedOverviewCard}`}>
          <div className={styles.cardTitle}><div><h2>Performance Snapshot</h2><p>{source} · {formatAuditDate(vitals?.checkedAt ?? tab.checkedAt)}</p></div></div>
          {pageSpeedUnavailable ? <p className={styles.pageSpeedNotice}>{vitals?.unavailableReason ?? "PageSpeed Insights data unavailable. Re-run the audit after configuring PageSpeed API access or allowing local Lighthouse fallback."}</p> : null}
          <div className={styles.pageSpeedScoreWrap}>
            {score !== undefined ? <PageSpeedScoreDonut score={score} /> : <div className={styles.pageSpeedUnavailableGauge}><strong>N/A</strong><span>No Lighthouse score</span></div>}
            <div className={styles.pageSpeedMiniScores}>
              <div><span>Mobile Score</span><strong>{formatScore(mobileScore)}</strong></div>
              <div><span>Desktop Score</span><strong>{formatScore(desktopScore)}</strong></div>
              <div><span>Passed</span><strong>{passed}</strong></div>
              <div><span>Warnings</span><strong>{warnings}</strong></div>
              <div><span>Open Issues</span><strong>{issues}</strong></div>
              <div><span>Source</span><strong>{source}</strong></div>
            </div>
          </div>
        </article>

        <article className={`${styles.card} ${styles.pageSpeedFocusCard}`}>
          <div className={styles.cardTitle}><div><h2>What Needs Attention</h2><p>{topInsights.length ? "Highest-impact items from the audit" : "No PageSpeed opportunities returned"}</p></div></div>
          {topInsights.length ? (
            <div className={styles.pageSpeedFocusList}>
              {topInsights.map((row) => (
                <div key={`focus-${row.title}`}>
                  <strong>{row.title}</strong>
                  <span>{row.savings ?? row.badge}</span>
                  <p>{row.description}</p>
                </div>
              ))}
            </div>
          ) : <p className={styles.emptyChecks}>Only basic crawler timing is available for this saved report.</p>}
        </article>
      </div>

      <div className={styles.pageSpeedRoleGrid}>
        {rolePriorities.map((role) => (
          <article className={`${styles.card} ${styles.pageSpeedRoleCard}`} key={role.title}>
            <span>{role.label}</span>
            <h3>{role.title}</h3>
            <p>{role.summary}</p>
            <ul>{role.items.map((item) => <li key={`${role.title}-${item}`}>{item}</li>)}</ul>
          </article>
        ))}
      </div>

      {lighthouseCategories.length ? (
        <div className={styles.pageSpeedCategoryStrip}>
          {lighthouseCategories.map((category) => (
            <article className={`${styles.card} ${styles.pageSpeedCategoryCard}`} key={category.id}>
              <strong>{category.score ?? "N/A"}</strong>
              <span>{category.title}</span>
            </article>
          ))}
        </div>
      ) : null}

      <div className={styles.pageSpeedGrid}>
        <article className={`${styles.card} ${styles.pageSpeedTableCard}`}>
          <div className={styles.cardTitle}><h2>Core Web Vitals</h2></div>
          <div className={styles.pageSpeedRows}>
            {metricRows.map((row) => (
              <div key={row.label}>
                <span><b>{row.label}</b><small>{row.detail}</small></span>
                <strong>{row.value}</strong>
                <em className={row.status.className}>{row.status.label}</em>
              </div>
            ))}
          </div>
        </article>

        <article className={`${styles.card} ${styles.pageSpeedTableCard}`}>
          <div className={styles.cardTitle}><h2>Server Performance</h2></div>
          <div className={styles.pageSpeedRows}>
            {serverRows.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
                <em className={row.status.className}>{row.status.label}</em>
              </div>
            ))}
          </div>
        </article>

        <article className={`${styles.card} ${styles.pageSpeedTableCard}`}>
          <div className={styles.cardTitle}><h2>Resource Optimization</h2></div>
          <div className={styles.resourceRows}>
            {resourceRows.map((row) => {
              const status = pageSpeedCheckStatus(row.check);
              return (
                <div key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.check ? (row.check.passed ? "Good" : row.check.skipped ? "N/A" : "Issue") : "N/A"}</strong>
                  <i className={status.className} />
                </div>
              );
            })}
          </div>
        </article>

        <article className={`${styles.card} ${styles.pageSpeedIssueCard}`}>
          <div className={styles.cardTitle}><h2>Insights</h2><p>{actualInsights.length ? "Opportunities from Lighthouse" : "No scored PageSpeed opportunities"}</p></div>
          <PageSpeedInsightList rows={actualInsights} emptyText="No actionable performance insights were returned." />
        </article>

        <article className={`${styles.card} ${styles.pageSpeedIssueCard}`}>
          <div className={styles.cardTitle}><h2>Diagnostics</h2><p>Additional performance signals</p></div>
          <PageSpeedInsightList rows={actualDiagnostics} emptyText="No diagnostic performance items were returned." />
        </article>

        <article className={`${styles.card} ${styles.pageSpeedIssueCard}`}>
          <div className={styles.cardTitle}><h2>Passed audits</h2><p>{actualPassed.length} checks passed</p></div>
          <PageSpeedInsightList rows={actualPassed.slice(0, 8)} emptyText="No passed PageSpeed audits were returned." compact />
        </article>

        <article className={`${styles.card} ${styles.pageSpeedIssueCard}`}>
          <div className={styles.cardTitle}><h2>Not applicable</h2><p>{actualSkipped.length} checks skipped</p></div>
          <PageSpeedInsightList rows={actualSkipped.slice(0, 8)} emptyText="No skipped PageSpeed audits were returned." compact />
        </article>
      </div>

      {tab.available ? <AuditDetailPanel tab={tab} /> : null}
    </section>
  );
}

type PageSpeedInsightRow = {
  title: string;
  description: string;
  badge: string;
  savings?: string;
  status: ReturnType<typeof pageSpeedCheckStatus>;
};
type StoredLighthouseAudit = NonNullable<NonNullable<NonNullable<StructuredAiVisibilityReport["core_web_vitals"]>["lighthouse"]>["categories"][number]["audits"][number]>;

function PageSpeedInsightList({ rows, emptyText, compact = false }: { rows: PageSpeedInsightRow[]; emptyText: string; compact?: boolean }) {
  if (!rows.length) return <p className={styles.emptyChecks}>{emptyText}</p>;
  return (
    <div className={`${styles.pageSpeedInsightList} ${compact ? styles.pageSpeedInsightListCompact : ""}`}>
      {rows.map((row) => (
        <div key={`${row.title}-${row.badge}`}>
          <span className={row.status.className}>{row.badge}</span>
          <strong>{row.title}{row.savings ? <em>{row.savings}</em> : null}</strong>
          {!compact ? <p>{row.description}</p> : null}
        </div>
      ))}
    </div>
  );
}

function pageSpeedInsightSections(checks: CheckLike[]) {
  const rows = checks.map(pageSpeedInsightRow);
  return {
    insights: rows.filter((row) => row.kind === "insight"),
    diagnostics: rows.filter((row) => row.kind === "diagnostic"),
    passed: rows.filter((row) => row.kind === "passed"),
    skipped: rows.filter((row) => row.kind === "skipped")
  };
}

function lighthouseInsightRow(audit: StoredLighthouseAudit): PageSpeedInsightRow {
  const passed = audit.score === 1;
  const skipped = audit.scoreDisplayMode === "notApplicable" || audit.scoreDisplayMode === "manual" || audit.scoreDisplayMode === "informative";
  return {
    title: audit.title,
    description: audit.description ?? audit.displayValue ?? "Lighthouse audit item.",
    savings: audit.savingsBytes ? `Est savings of ${formatBytes(audit.savingsBytes)}` : audit.displayValue,
    badge: passed ? "Passed" : skipped ? "Not applicable" : "Insight",
    status: passed ? { label: "Good", className: styles.passed } : skipped ? { label: "Skipped", className: styles.skipped } : { label: "Issue", className: styles.needs }
  };
}

function pageSpeedInsightRow(check: CheckLike): PageSpeedInsightRow & { kind: "insight" | "diagnostic" | "passed" | "skipped" } {
  const status = pageSpeedCheckStatus(check);
  const passed = Boolean(check.passed) && !check.warning;
  const skipped = Boolean(check.skipped || check.notApplicable);
  const title = pageSpeedTitle(check.name ?? "PageSpeed audit");
  const text = readableEvidence(check.evidence);
  const description = check.issueSummary || check.whatIsWrong || pageSpeedDescription(title, text);
  const savings = estimatedSavings(text);
  const kind = skipped
    ? "skipped"
    : passed
      ? "passed"
      : pageSpeedDiagnosticPattern.test(`${check.name ?? ""} ${text}`)
        ? "diagnostic"
        : "insight";
  return {
    title,
    description,
    savings,
    status,
    kind,
    badge: passed ? "Passed" : skipped ? "Not applicable" : check.warning ? "Diagnostics" : "Insight"
  };
}

const pageSpeedDiagnosticPattern = /unused css|unused javascript|long main-thread|main-thread|dom size|forced reflow|network dependency|third-party|total blocking|speed index|tti/i;

function pageSpeedTitle(name: string) {
  const normalized = name
    .replace(/^0\s+/, "")
    .replace(/\s*pass\s*\/.*$/i, "")
    .replace(/\s*(>=|<=|<|>)\s*[\d.]+\s*(ms|px|percent)?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/ttfb|server response/i.test(normalized)) return "Document request latency";
  if (/render-blocking/i.test(normalized)) return "Render-blocking requests";
  if (/compression|brotli|gzip/i.test(normalized)) return "Applies text compression";
  if (/webp|avif|image compression|optimized images/i.test(normalized)) return "Improve image delivery";
  if (/unused css/i.test(normalized)) return "Reduce unused CSS";
  if (/unused js|unused javascript/i.test(normalized)) return "Reduce unused JavaScript";
  if (/dom node/i.test(normalized)) return "Optimize DOM size";
  if (/lcp image|largest contentful paint/i.test(normalized)) return "LCP breakdown";
  if (/cache-control|etag|last-modified/i.test(normalized)) return "Use efficient cache lifetimes";
  return normalized || name;
}

function pageSpeedDescription(title: string, evidence: string) {
  if (/Document request latency/i.test(title)) return "Reduce latency by avoiding redirects, ensuring a fast server response, and enabling text compression.";
  if (/Render-blocking requests/i.test(title)) return "Reduce render-blocking resources so the browser can paint above-the-fold content sooner.";
  if (/Improve image delivery/i.test(title)) return "Serve appropriately compressed, modern-format images and prioritize the LCP image.";
  if (/Reduce unused CSS/i.test(title)) return "Remove unused rules and defer non-critical CSS to reduce transfer size and style calculation work.";
  if (/LCP breakdown/i.test(title)) return "Review the LCP element, load delay, resource load time, and render delay.";
  return evidence || "Review this audit item to improve the page's Lighthouse performance profile.";
}

function estimatedSavings(text: string) {
  const bytes = text.match(/(?:savings|saved|save)[^0-9]*(\d+(?:\.\d+)?)\s*(KiB|MiB|KB|MB|bytes?)/i)
    ?? text.match(/(\d+(?:\.\d+)?)\s*(KiB|MiB|KB|MB)\s*(?:savings|could be saved|unused)/i);
  if (bytes) return `Est savings of ${bytes[1]} ${bytes[2]}`;
  const ms = text.match(/(?:savings|save|reduce)[^0-9]*(\d+(?:\.\d+)?)\s*ms/i);
  if (ms) return `Est savings of ${ms[1]} ms`;
  return undefined;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value)) return "0 B";
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 102.4) / 10} MiB`;
  if (value >= 1024) return `${Math.round(value / 102.4) / 10} KiB`;
  return `${Math.round(value)} B`;
}

function pageSpeedRolePriorities(
  rows: PageSpeedInsightRow[],
  metrics: Array<{ label: string; value: string; status: ReturnType<typeof pageSpeedMetricStatus> }>,
  serverRows: Array<{ label: string; value: string; status: ReturnType<typeof pageSpeedMetricStatus> }>
) {
  const needsWork = (status: ReturnType<typeof pageSpeedMetricStatus>) => status.label !== "Good" && status.label !== "Skipped";
  const developerItems = [
    ...rows.filter((row) => /request|render|css|javascript|cache|compression|server|blocking/i.test(row.title)).map((row) => row.title),
    ...serverRows.filter((row) => needsWork(row.status)).map((row) => `${row.label}: ${row.value}`)
  ].slice(0, 4);
  const uiItems = [
    ...metrics.filter((row) => /LCP|CLS|FCP|Speed Index/.test(row.label) && needsWork(row.status)).map((row) => `${row.label}: ${row.value}`),
    ...rows.filter((row) => /image|layout|lcp|dom|visual/i.test(row.title)).map((row) => row.title)
  ].slice(0, 4);
  const seoItems = [
    ...metrics.filter((row) => /LCP|INP|CLS/.test(row.label) && needsWork(row.status)).map((row) => `${row.label}: ${row.value}`),
    ...rows.filter((row) => /request|image|cache|lcp/i.test(row.title)).map((row) => row.title)
  ].slice(0, 4);
  return [
    {
      label: "Developer",
      title: "Fix the loading path",
      summary: "Prioritize server response, compression, caching, render-blocking resources, and unused code.",
      items: developerItems.length ? developerItems : ["No developer-specific performance blockers were returned."]
    },
    {
      label: "UI Design",
      title: "Protect the first impression",
      summary: "Watch LCP, layout shifts, image delivery, and visual load progress that affect perceived quality.",
      items: uiItems.length ? uiItems : ["No UI-facing Web Vitals issues were returned."]
    },
    {
      label: "SEO",
      title: "Support organic visibility",
      summary: "Core Web Vitals can affect landing-page experience and should be reviewed alongside content and indexability.",
      items: seoItems.length ? seoItems : ["No SEO-facing PageSpeed issues were returned."]
    }
  ];
}

type DetailItem = {
  name: string;
  meta?: string;
  severity?: string;
  priority?: string;
  priorityScore?: number;
  scopeLabel?: string;
  impactLevel?: string;
  scaleLevel?: string;
  effortLevel?: string;
  affectedRate?: number;
  pagesAffected?: number;
  pagesAnalyzed?: number;
  uniqueAssetsAffected?: number;
  rootCause?: string[];
  likelyTemplates?: string[];
  estimatedFixScope?: RecommendationDetails["estimatedFixScope"];
  overallAiVisibilityImpact?: RecommendationDetails["overallAiVisibilityImpact"];
  summary?: string;
  issue?: string;
  whyItMatters?: string;
  businessImpact?: string;
  aiVisibilityImpact?: string;
  fixes?: string[];
  bestPracticeExample?: string;
  developerNotes?: string;
  evidence?: string;
  evidenceLines?: string[];
  brokenLinkEvidence?: { brokenUrl: string; finalUrl: string; finalStatus: string; redirectHops: number; sourcePage: string }[];
  topFixCandidates?: string[];
  pages?: string[];
  images?: string[];
  confidence?: { score: number; reason: string };
  representativeImage?: {
    fileName: string;
    issue: string;
    suggestedAlt: string;
  };
};

function brokenLinkEvidenceFromEvidence(value: unknown) {
  const evidence = evidenceObject(value);
  const records = Array.isArray(evidence?.brokenLinkEvidence) ? evidence.brokenLinkEvidence : [];
  return records.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const brokenUrl = String(record.brokenUrl ?? "").trim();
    const finalUrl = String(record.finalUrl ?? brokenUrl).trim();
    const sourcePage = String(record.sourcePage ?? "").trim();
    const finalStatus = String(record.finalStatus ?? record.status ?? "").trim();
    const recordedRedirectHops = Number(record.redirectHops);
    const redirectHops = Number.isFinite(recordedRedirectHops)
      ? Math.max(0, recordedRedirectHops)
      : finalUrl !== brokenUrl ? 1 : 0;
    return brokenUrl && finalUrl && sourcePage && finalStatus ? [{ brokenUrl, finalUrl, finalStatus, redirectHops, sourcePage }] : [];
  });
}

function checksForCategory(tab: TabInfo, category: CategoryLike) {
  return tab.checks.filter((check) => check.category === category.categoryName);
}

function boundedSummaryLine(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= 150 ? cleaned : `${cleaned.slice(0, 149).trimEnd()}…`;
}

function fallbackValidationSummary(value: unknown, detectedFailure?: string) {
  const evidence = evidenceObject(value);
  const pagesCrawled = Number(evidence?.pagesCrawled);
  const pagesChecked = Number(evidence?.pagesChecked);
  const pagesFailed = Number(evidence?.pagesFailed);
  const rate = Number.isFinite(pagesChecked) && pagesChecked > 0 && Number.isFinite(pagesFailed)
    ? Math.round((pagesFailed / pagesChecked) * 1000) / 10
    : 0;
  const firstAffected = Array.isArray(evidence?.affectedPages) && evidence.affectedPages[0] && typeof evidence.affectedPages[0] === "object"
    ? evidence.affectedPages[0] as Record<string, unknown>
    : null;
  const pageEvidence = firstAffected?.evidence && typeof firstAffected.evidence === "object"
    ? firstAffected.evidence as Record<string, unknown>
    : evidence;
  const parserErrors = Array.isArray(pageEvidence?.parseErrors) ? pageEvidence.parseErrors.map(String).filter(Boolean) : [];
  const visibleDates = Array.isArray(pageEvidence?.visibleDateCandidates) ? pageEvidence.visibleDateCandidates.map(String).filter(Boolean) : [];
  const evidenceDetail = parserErrors.length
    ? `Parser error: ${parserErrors[0]}`
    : pageEvidence?.schemaDateModified
      ? `Date evidence: schema ${String(pageEvidence.schemaDateModified)}; visible ${visibleDates.join(", ") || "none detected"}`
      : "";
  return [
    `Pages crawled: ${Number.isFinite(pagesCrawled) ? pagesCrawled : "Unavailable"}`,
    `Pages analyzed: ${Number.isFinite(pagesChecked) ? pagesChecked : "Unavailable"}`,
    `Pages affected: ${Number.isFinite(pagesFailed) ? pagesFailed : "Unavailable"}`,
    `Affected rate: ${rate}% (${Number.isFinite(pagesFailed) ? pagesFailed : "Unavailable"} of ${Number.isFinite(pagesChecked) ? pagesChecked : "Unavailable"} pages)`,
    evidenceDetail,
    `Most common issue: ${detectedFailure || "See the affected-page evidence for the detected signal."}`,
    "Expected outcome: The affected parameter passes consistently across analyzed pages."
  ].filter(Boolean).map(boundedSummaryLine);
}

function sentenceSteps(value: string) {
  return value.split(/(?<=[.!?])\s+/).map((step) => step.trim()).filter(Boolean).slice(0, 3);
}

function genericBusinessImpact(name: string) {
  const text = name.toLowerCase();
  if (/crawl|robots|sitemap|index|canonical|redirect/.test(text)) return "The issue can restrict crawlability or indexation, suppress rankings, and reduce qualified organic traffic.";
  if (/speed|lcp|inp|performance|image/.test(text)) return "The issue can weaken user experience, engagement, conversion rates, and search visibility.";
  if (/trust|review|author|contact|schema|structured/.test(text)) return "The issue can reduce search-engine confidence, user trust, rich-result eligibility, and conversion performance.";
  return "The issue can weaken rankings, traffic quality, user experience, and the likelihood that visitors complete a valuable action.";
}

function genericAiImpact(name: string) {
  const text = name.toLowerCase();
  if (/crawl|robots|index|noindex|javascript|render/.test(text)) return "ChatGPT, Gemini, and Google AI Overviews may be unable to retrieve or reliably interpret the affected content.";
  if (/schema|entity|author|trust|citation|breadcrumb|heading|content/.test(text)) return "AI answer engines may have lower confidence in the page’s entities, structure, or claims, reducing its likelihood of being summarized or cited.";
  return "AI answer engines may interpret the page with less confidence, which can reduce inclusion, summarization, and citation potential.";
}

function priorityFromCheck(check: CheckLike) {
  if (check.warning) return "Low";
  const severity = (check.severity ?? "").toLowerCase();
  if (severity === "advisory") return "Low";
  if (severity === "critical" || severity === "high" || impactForFinding(check) === "high") return "High";
  if (severity === "low") return "Low";
  return "Medium";
}

function normalizedSeverity(value?: string, warning = false) {
  if (warning) return "Advisory";
  const severity = (value ?? "").toLowerCase();
  if (severity === "blocker" || severity === "critical") return "Critical";
  if (severity === "major" || severity === "high") return "High";
  if (severity === "minor" || severity === "medium" || severity === "minor attention") return "Medium";
  if (severity === "advisory") return "Advisory";
  if (severity === "low") return "Low";
  return "Medium";
}

function numericPriorityScore(check: CheckLike, severity: string, provided?: number) {
  if (typeof provided === "number" && Number.isFinite(provided)) return Math.max(0, Math.min(100, Math.round(provided)));
  if (check.warning || severity === "Low" || severity === "Advisory") return 30;
  if (severity === "Critical") return check.scope === "domain" ? 95 : 88;
  if (severity === "High") return check.scope === "domain" ? 85 : 72;
  const impact = impactForFinding(check);
  if (impact === "high") return 65;
  if (impact === "medium") return 50;
  return 35;
}

function issueScopeLabel(check: CheckLike) {
  const evidence = evidenceObject(check.evidence);
  if (check.scope !== "domain" && evidence?.scope !== "domain-level") return undefined;
  const name = (check.name ?? "").toLowerCase();
  if (/robots/.test(name)) return "Sitewide configuration check";
  if (/sitemap/.test(name)) return "Sitewide discovery check";
  return "Sitewide check";
}

function affectedRateFromEvidence(value: unknown) {
  const evidence = evidenceObject(value);
  const analyzed = Number(evidence?.pagesChecked);
  const affected = Number(evidence?.pagesFailed);
  return Number.isFinite(analyzed) && analyzed > 0 && Number.isFinite(affected)
    ? Math.round((affected / analyzed) * 1000) / 10
    : 0;
}

function pageCountsFromEvidence(value: unknown) {
  const evidence = evidenceObject(value);
  const pagesAnalyzed = Number(evidence?.pagesChecked);
  const pagesAffected = Number(evidence?.pagesFailed);
  return {
    pagesAnalyzed: Number.isFinite(pagesAnalyzed) ? pagesAnalyzed : undefined,
    pagesAffected: Number.isFinite(pagesAffected) ? pagesAffected : undefined
  };
}

function imageFileName(value: string) {
  try {
    return decodeURIComponent(new URL(value, "https://example.com").pathname.split("/").filter(Boolean).at(-1) || "Image");
  } catch {
    return value.split(/[?#]/)[0].split("/").filter(Boolean).at(-1) || "Image";
  }
}

function representativeImageFromEvidence(value: unknown): DetailItem["representativeImage"] {
  const visit = (input: unknown, depth = 0): DetailItem["representativeImage"] => {
    if (!input || depth > 5) return undefined;
    if (typeof input === "string") {
      try {
        return visit(JSON.parse(input), depth + 1);
      } catch {
        return undefined;
      }
    }
    if (Array.isArray(input)) {
      for (const item of input) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    if (typeof input !== "object") return undefined;
    const record = input as Record<string, unknown>;
    const imageUrl = typeof record.imageUrl === "string" ? record.imageUrl : "";
    const suggestedAlt = typeof record.suggestedAlt === "string" ? record.suggestedAlt.trim() : "";
    const issue = typeof record.issue === "string"
      ? record.issue
      : record.alt === ""
        ? "Missing or empty alt text"
        : "";
    const wordCount = suggestedAlt.split(/\s+/).filter(Boolean).length;
    if (imageUrl && issue && wordCount >= 5 && wordCount <= 15) {
      return { fileName: imageFileName(imageUrl), issue, suggestedAlt };
    }
    for (const child of Object.values(record)) {
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return visit(value);
}

function evidenceText(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const summary = (parsed as Record<string, unknown>).summary;
          if (typeof summary === "string" && summary.trim()) return summary;
          const record = parsed as Record<string, unknown>;
          if (Number.isFinite(Number(record.pagesCrawled)) && Number.isFinite(Number(record.pagesChecked))) {
            return evidenceText(parsed);
          }
        }
      } catch {
        return value;
      }
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const summary = record.summary;
    if (typeof summary === "string" && summary.trim()) return summary;
    const pagesCrawled = Number(record.pagesCrawled);
    const pagesChecked = Number(record.pagesChecked);
    const pagesPassed = Number(record.pagesPassed);
    const pagesFailed = Number(record.pagesFailed);
    const passRate = Number(record.passRate);
    if ([pagesCrawled, pagesChecked, pagesPassed, pagesFailed, passRate].every(Number.isFinite)) {
      const scope = record.scope === "domain-level"
        ? "Domain-level check"
        : record.scope === "homepage-only"
          ? "Homepage-only check"
          : "Page-level site-wide check";
      return `${scope}. Crawled ${pagesCrawled} pages; checked ${pagesChecked}; ${pagesPassed} passed and ${pagesFailed} failed (${passRate}% pass rate).`;
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function evidenceObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function skippedReasonText(check: CheckLike) {
  const evidence = check.evidence;
  const record = evidenceObject(evidence);
  if (record) {
    const reason = record.reason ?? record.skippedReason ?? record.note ?? record.error;
    if (typeof reason === "string" && reason.trim()) return reason;
  }
  return evidenceText(evidence);
}

function checksForCategories(checks: CheckLike[], categories: CategoryLike[]) {
  const categoryNames = new Set(categories.map((category) => category.categoryName));
  return checks.filter((check) => check.category && categoryNames.has(check.category));
}

function checksForIdsOrCategories(checks: CheckLike[], ids: readonly number[], categories: readonly string[]) {
  const idSet = new Set<number>(ids);
  const categorySet = new Set<string>(categories);
  return checks.filter((check) => typeof check.id === "number"
    ? idSet.has(check.id)
    : Boolean(check.category && categorySet.has(check.category)));
}

function categoriesFromChecks(checks: CheckLike[], order: readonly string[]): CategoryLike[] {
  const unorderedCategories = checks
    .map((check) => check.category)
    .filter((categoryName): categoryName is string => Boolean(categoryName))
    .filter((categoryName) => !order.includes(categoryName));
  const categoryNames = [
    ...order.filter((categoryName) => checks.some((check) => check.category === categoryName)),
    ...unorderedCategories
  ];
  return [...new Set(categoryNames)].map((categoryName) => {
    const categoryChecks = checks.filter((check) => check.category === categoryName);
    const scorable = categoryChecks.filter((check) => !check.skipped);
    const failedChecks = scorable.filter((check) => !check.passed && !check.warning && !check.informational).length;
    const warningChecks = scorable.filter((check) => check.warning || check.informational).length;
    const passedChecks = scorable.filter((check) => check.passed).length;
    const skippedChecks = categoryChecks.filter((check) => check.skipped).length;
    const score = scorable.length
      ? clampScore((scorable.filter((check) => check.passed || check.warning || check.informational).length / scorable.length) * 100)
      : 100;
    return {
      categoryName,
      totalChecks: categoryChecks.length,
      passedChecks,
      failedChecks,
      warningChecks,
      skippedChecks,
      score,
      status: scorable.length === 0 ? "Skipped" : warningChecks > 0 && failedChecks === 0 ? "Minor Attention" : statusFor(score)
    };
  });
}

function pushUniqueUrl(urls: string[], value: unknown) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return;
  const normalized = trimmed.replace(/[),.;\]]+$/, "");
  if (!urls.includes(normalized)) urls.push(normalized);
}

function urlsFromEvidenceKeys(value: unknown, keys: string[]) {
  const urls: string[] = [];
  const wanted = new Set(keys);
  const visit = (input: unknown, depth = 0) => {
    if (urls.length >= 6 || depth > 4 || input == null) return;
    if (typeof input === "string") {
      const trimmed = input.trim();
      if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        try {
          visit(JSON.parse(trimmed), depth + 1);
          return;
        } catch {
          // Fall through to URL extraction for plain evidence strings.
        }
      }
      for (const match of input.matchAll(/https?:\/\/[^\s"',<>)\]]+/gi)) pushUniqueUrl(urls, match[0]);
      return;
    }
    if (Array.isArray(input)) {
      for (const item of input) visit(item, depth + 1);
      return;
    }
    if (typeof input === "object") {
      const record = input as Record<string, unknown>;
      for (const [key, child] of Object.entries(record)) {
        if (wanted.has(key)) visit(child, depth + 1);
        else if (Array.isArray(child)) child.forEach((item) => {
          if (item && typeof item === "object") visit(item, depth + 1);
        });
      }
    }
  };

  visit(value);
  return urls.slice(0, 6);
}

function affectedPagesFromEvidence(value: unknown) {
  const structured: string[] = [];
  const parsed = (() => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  })();
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const affected = (parsed as Record<string, unknown>).affectedPages;
    if (Array.isArray(affected)) {
      affected.forEach((item) => {
        if (item && typeof item === "object") pushUniqueUrl(structured, (item as Record<string, unknown>).url);
        else pushUniqueUrl(structured, item);
      });
    }
  }
  return structured.length ? structured.slice(0, 6) : urlsFromEvidenceKeys(value, ["page", "pageUrl", "pageUrls", "sampleUrl", "sampleUrls", "affectedPages", "affectedUrls", "failedUrls", "noindexedUrls", "sourcePage"]);
}

function affectedImagesFromEvidence(value: unknown) {
  return urlsFromEvidenceKeys(value, ["image", "imageUrl", "imageUrls", "src", "missingAlt", "missingAltImages", "sampleImages", "nonDescriptive", "unstableUrls"]);
}

function robotsTxtCandidateFromEvidence(value: unknown) {
  const evidence = evidenceObject(value);
  const sample = Array.isArray(evidence?.sampleEvidence) && evidence.sampleEvidence[0] && typeof evidence.sampleEvidence[0] === "object"
    ? evidence.sampleEvidence[0] as Record<string, unknown>
    : {};
  const explicit = String(sample.robotsUrl ?? "").trim();
  if (/^https?:\/\//i.test(explicit)) return explicit;
  const requested = String(sample.requestedUrl ?? "").trim();
  if (requested.endsWith("/robots.txt")) return requested;
  try {
    return `${new URL(requested).origin}/robots.txt`;
  } catch {
    return "";
  }
}

function sourceTemplateCandidatesFromEvidence(value: unknown, details?: RecommendationDetails) {
  const candidates: string[] = [];
  details?.likelyTemplates?.forEach((item) => {
    if (item && !candidates.includes(item)) candidates.push(item);
  });
  details?.rootCause?.forEach((item) => {
    const normalized = item.toLowerCase();
    const label = normalized.includes("shared navigation")
      ? "Shared Navigation Template"
      : normalized.includes("footer")
        ? "Shared Footer Template"
        : "";
    if (label && !candidates.includes(label)) candidates.push(label);
  });
  const evidence = evidenceObject(value);
  const groups = Array.isArray(evidence?.brokenUrlGroups) ? evidence.brokenUrlGroups as unknown[] : [];
  groups.forEach((group) => {
    if (!group || typeof group !== "object") return;
    const locations = Array.isArray((group as Record<string, unknown>).locations)
      ? (group as Record<string, unknown>).locations as unknown[]
      : [];
    locations.forEach((location) => {
      const normalized = String(location ?? "").toLowerCase();
      const label = normalized.includes("shared navigation")
        ? "Shared Navigation Template"
        : normalized.includes("footer")
          ? "Shared Footer Template"
          : "";
      if (label && !candidates.includes(label)) candidates.push(label);
    });
  });
  return candidates;
}

function topFixCandidatesForCheck(check: CheckLike, details: RecommendationDetails | undefined, pages: string[]) {
  if (details?.topFixCandidates?.length) return details.topFixCandidates.slice(0, 3);
  const name = `${check.category ?? ""} ${check.name ?? ""}`.toLowerCase();
  if (/robots\.txt|sitemap/.test(name)) {
    const robots = robotsTxtCandidateFromEvidence(check.evidence);
    return robots ? [robots] : pages.slice(0, 3);
  }
  const sourceCandidates = [...pages.slice(0, 3), ...sourceTemplateCandidatesFromEvidence(check.evidence, details)]
    .filter((item, index, all) => item && all.indexOf(item) === index);
  return sourceCandidates.slice(0, 3);
}

function fixForIssue(name: string, categoryName: string, evidence = "") {
  const text = `${categoryName} ${name}`.toLowerCase();
  const evidenceText = evidence.toLowerCase();
  if (/js-rendered content available in raw html|raw html content|ssr for oai-searchbot/.test(text)) {
    return "Ensure primary content is available in the initial HTML response or server-rendered markup.";
  }
  if (/data point density/.test(text)) {
    return "Add factual details, numbers, examples, comparisons, or entity-rich statements where relevant.";
  }
  if (/definedterm/.test(text)) {
    return "Create a glossary or key-terms page and add DefinedTerm JSON-LD for each important term, definition, and canonical term URL.";
  }
  if (/profilepage on bio pages/.test(text)) {
    return "Create public bio/profile pages for authors, experts, founders, or team members and add ProfilePage JSON-LD connected to the Person entity.";
  }
  if (/json-ld syntax valid/.test(text)) {
    return "Correct the JSON-LD syntax error shown in the validation evidence, then parse the updated block again.";
  }
  if (/datemodified matches visible date|schema-dom: date match/.test(text)) {
    return "Make schema dateModified match the visible updated date, or remove dateModified when no reliable update date is shown.";
  }
  if (/faqpage when faq in dom/.test(text)) {
    return "Add FAQPage schema only to pages with visible question-and-answer content, and keep it identical to the displayed FAQs.";
  }
  if (/faqpage text|schema-dom: faq match/.test(text)) {
    return "Make each FAQPage question and answer match the visible FAQ wording on that same page.";
  }
  if (/howto on step-by-step/.test(text)) {
    return "Add HowTo schema only when the page contains a genuine ordered, step-by-step process.";
  }
  if (/person schema|profilepage|person:/.test(text)) {
    return "Add Person schema only on bio/profile pages.";
  }
  if (/softwareapp|softwareapplication/.test(text)) {
    return "Add SoftwareApplication schema only on actual tool/app pages.";
  }
  if (/\bevent\b|webinar/.test(text)) {
    return "Add Event schema only when the page promotes a real dated event or webinar.";
  }
  if (/imageobject/.test(text)) {
    return "Add ImageObject schema for primary content images only.";
  }
  if (/article schema|article:/.test(text)) {
    return "Add Article schema only on blog/article pages, and make its properties match the visible article.";
  }
  if (/product schema|product:/.test(text)) {
    return "Add Product schema only on product or ecommerce pages, using visible product details.";
  }
  if (/localbusiness/.test(text)) {
    return "Add LocalBusiness schema only when the page represents a real local business or location.";
  }
  if (/knowsabout/.test(text)) {
    return "Add knowsAbout topics only when they accurately describe the business expertise.";
  }
  if (/organization schema present/.test(text)) {
    return "Add one Organization JSON-LD block to the homepage with the real business name, canonical website URL, logo, and a stable @id. Add phone, address, sameAs, and other optional properties only when they are accurate and visible or officially verified.";
  }
  if (/title length|titles within recommended|title tag.*30|title.*30-60/.test(text)) {
    return "Some page titles are outside the recommended 30-60 character range. Review longer or shorter titles and keep the primary keyword and brand while removing unnecessary words.";
  }
  if (/meta description length|descriptions within recommended|description.*120-160/.test(text)) {
    return "Review meta descriptions that are missing, too short, or too long. Write concise summaries that accurately describe the page and encourage clicks from search results.";
  }
  if (/duplicate content at slug and slug slash|slug and slug slash|slash variant|trailing slash/.test(text)) {
    return "Choose one URL style: either with a slash at the end or without it. Then redirect the other version to your chosen version.";
  }
  if (/duplicate title/.test(text)) {
    return "Give each important page a unique title. Avoid using the exact same title on many pages.";
  }
  if (/duplicate meta description/.test(text)) {
    return "Give each important page its own meta description. Do not reuse the same description across many pages.";
  }
  if (/nap: footer vs schema vs contact|schema-dom phone|address matches schema|phone format consistent/.test(text)) {
    return "Make the business name, address, and phone number match in three places: footer, contact page, and JSON-LD schema.";
  }
  if (/org: telephone|org: address|localbusiness.*address|schema.*phone|schema.*address/.test(text)) {
    return "Add the visible business phone and address into your Organization or LocalBusiness JSON-LD schema.";
  }
  if (/sameas/.test(text)) {
    return "Optional entity reinforcement: add official sameAs links when verified profiles exist. Do not create profiles only to satisfy this check.";
  }
  if (/https \+ valid ssl|ssl certificate valid|https protocol|ssl covers|ssl covers all subdomains|ssl covers discovered subdomains/.test(text)) {
    return "Make sure the website opens with https:// and shows a secure lock in the browser. If it does not, ask your hosting provider to install or renew the SSL certificate.";
  }
  if (/hsts|strict-transport-security/.test(text)) {
    return "After HTTPS is working correctly, ask your developer or hosting provider to enable the HSTS security header. This tells browsers to always use the secure version of your site.";
  }
  if (/ttfb|time to first byte|server response/.test(text)) {
    return "The server is slow to start loading the page. Turn on page caching, use a CDN, reduce heavy plugins/scripts, or upgrade hosting.";
  }
  if (/gzip|brotli|compression|content-encoding/.test(text)) {
    return "Turn on GZIP or Brotli compression in your hosting, CDN, or caching plugin so text files load faster.";
  }
  if (/cache-control|browser cach/.test(text)) {
    return "Enable browser caching for images, CSS, JavaScript, and fonts. In most sites this can be done from your CDN, hosting panel, or caching plugin.";
  }
  if (/etag|last-modified/.test(text)) {
    return "Ask your server or CDN to send ETag or Last-Modified headers. These help browsers avoid downloading unchanged files again.";
  }
  if (/cdn edge caching|cdn edge/.test(text)) {
    return "Use a CDN such as Cloudflare, Bunny, Fastly, or your hosting CDN so pages and files load from servers closer to visitors.";
  }
  if (/lcp.*lazy|lcp image not lazy-loaded|hero image.*lazy/.test(text)) {
    return "Do not lazy-load the main hero image at the top of the page. Load that image immediately, and lazy-load only images lower down the page.";
  }
  if (/mixed content/.test(text)) {
    return "Some files on an HTTPS page are still loaded with http://. Change those file URLs to https:// or enable automatic HTTPS rewrite in your CDN.";
  }
  if (/content-type/.test(text)) {
    return "Make sure each file is served as the correct type, for example HTML as text/html, CSS as text/css, and JavaScript as application/javascript.";
  }
  if (/canonical.*noindex|canonical not/.test(text)) {
    return "The canonical URL should point to a real page that can be indexed. Do not point it to a blocked, noindex, redirected, or missing page.";
  }
  if (/canonical chains|no canonical chains/.test(text)) {
    return "Point the canonical tag directly to the final preferred page. Avoid pointing to a URL that redirects again.";
  }
  if (/canonical on all|canonical tag exists|self-referencing canonical|canonical url is self-referencing/.test(text)) {
    return "Add a canonical tag to each important page. It should usually point to that same page's preferred URL.";
  }
  if (/no noindex in sitemap|noindex pages included in sitemap/.test(text)) {
    return "Remove pages from the sitemap if you do not want Google to index them. The sitemap should list only important public pages.";
  }
  if (/soft-?404/.test(text)) {
    return "If a page does not exist, the server should return a real 404 or 410 status, even if you show a nice custom error page.";
  }
  if (/broken external link/.test(text)) {
    return "Check the broken outgoing links. Replace them with working links or remove them.";
  }
  if (/back-button hijacking|exit-intent redirect|intrusive interstitial/.test(text)) {
    return "Remove popups or scripts that force redirects, block the page, or stop users from using the browser back button.";
  }
  if (/301 for permanent redirects|permanent redirects/.test(text)) {
    return "If a URL has permanently moved, use a 301 redirect to the new URL. Use temporary redirects only for temporary changes.";
  }
  if (/url path case|path all lowercase|case inconsistency/.test(text)) {
    return "Use lowercase URLs everywhere. Redirect uppercase versions to the lowercase version.";
  }
  if (/infinite scroll/.test(text)) {
    return "If content loads while scrolling, also add normal page links like page 2, page 3, so Google can crawl all content.";
  }
  if (/ssr contains primary content|empty-shell spa|server-side|js content rendering|headless browser content match/.test(text)) {
    return "Make sure the main text is visible in the page HTML, not only after JavaScript runs. This helps Google and AI crawlers read the page.";
  }
  if (/rss feed full-text/.test(text)) {
    return "Include enough article text in your RSS feed so feed readers and AI tools can understand each post.";
  }
  if (/llms\.txt|ai\.txt/.test(text)) {
    return "Create an /llms.txt file that explains your brand, services, best pages, and useful resources in simple Markdown.";
  }
  if (/ai crawler ip accessibility|ai crawler accessibility/.test(text)) {
    if (/http 429|429/.test(evidenceText)) {
      return "The crawler request is being rate-limited. Allowlist trusted AI crawler user-agents in Cloudflare/Hostinger/bot-protection rules, reduce challenge/rate-limit sensitivity for public pages, then rerun the audit.";
    }
    return "Do not block trusted AI crawlers from public pages. Check robots.txt, firewall, CDN, and bot-protection settings.";
  }
  if (/indexnow/.test(text)) {
    return "Turn on IndexNow in your SEO plugin or CMS. This helps search engines know faster when you add or update pages.";
  }
  if (/internal search blocked/.test(text)) {
    return "Stop your site's own search result pages from being indexed. Usually these URLs look like ?s=keyword or /search/.";
  }
  if (/url params stripped|parameter url/.test(text)) {
    return "Use clean internal links. Do not link to your own pages with tracking parameters like utm_source or ?ref=.";
  }
  if (/robots|bot access|gptbot|oai-searchbot|chatgpt-user|google-extended|googleother|crawler access|waf challenge/.test(text)) {
    return "Check robots.txt and firewall settings. Public pages should be reachable by search engines and trusted AI crawlers.";
  }
  if (/llms\.txt/.test(text)) {
    return "Create an /llms.txt file with your brand summary, service pages, important URLs, and resources AI tools can cite.";
  }
  if (/noindex|nosnippet|max-snippet|data-nosnippet|x-robots/.test(text)) {
    return "Remove noindex or nosnippet from pages you want Google and AI tools to show, summarize, or cite.";
  }
  if (/canonical/.test(text)) {
    return "Choose one preferred URL for the page. If both /page and /page/ open, redirect one to the other and set the canonical tag to the preferred version.";
  }
  if (/sitemap/.test(text)) {
    return "Create a clean XML sitemap with only important public pages. Add the sitemap URL inside robots.txt.";
  }
  if (/title|meta description|meta tag/.test(text)) {
    return "Rewrite the page title and meta description so they clearly say what the page is about and match what users search for.";
  }
  if (/heading|h1|content structure|question-based|bluf/.test(text)) {
    return "Use one clear H1 title, then organize the page with H2 and H3 headings. Put the most important answer near the top.";
  }
  if (/schema|json-ld|structured data|sameas|organization|localbusiness|product|faqpage|videoobject|speakable/.test(text)) {
    return `Update the ${name} markup so it describes the visible page content and includes only properties supported by page evidence.`;
  }
  if (/faq/.test(text)) {
    return "Add real FAQs on the page, with short direct answers. If you use FAQ schema, make sure it matches the visible FAQs.";
  }
  if (/nap|address|phone|email|contact|privacy|terms|trust|review|testimonial|merchant/.test(text)) {
    return "Show the same business name, address, phone, email, policies, and reviews across your website and schema. Do not let footer, contact page, and schema disagree.";
  }
  if (/alt|image|photo|ocr|visual|transcript/.test(text)) {
    return "Add helpful alt text to important images. If an image contains important information, also write that information as normal text on the page.";
  }
  if (/lcp|inp|core web vitals|performance|render|javascript|js-rendered|server-side|ssr/.test(text)) {
    return "Make the page faster and easier to read. Reduce heavy scripts, optimize images, and make sure important content appears without waiting for JavaScript.";
  }
  if (/internal link|linking|anchor|pagination|redirect|http->https|www|parameter url/.test(text)) {
    return "Use clear internal links, fix redirect problems, and keep one consistent website version, such as https://www or https:// without www.";
  }
  if (/content|word count|authority|author|bio|credential|updated|outbound/.test(text)) {
    return "Improve the page with more useful detail, author or company proof, updated dates when relevant, and links to credible supporting sources.";
  }
  return `Check the evidence shown for this issue. Fix the page, setting, or plugin related to "${name}", then run the audit again.`;
}

function issueItemsFor(category: CategoryLike, checks: CheckLike[]): DetailItem[] {
  const checkItems = checks
    .filter((check) => !check.skipped && !check.informational && check.passed === false)
    .filter((check) => {
      const structuredDataCategory = /^(Organization|LocalBusiness|Article|Person|FAQ & HowTo|Product|Supporting Schema Types|Schema Validation & Quality|Schema-DOM Parity|Specialist Schema Types) Schema?$/.test(check.category ?? category.categoryName)
        || ["Supporting Schema Types", "Schema Validation & Quality", "Schema-DOM Parity", "Specialist Schema Types"].includes(check.category ?? category.categoryName);
      const geoAeoCategory = [
        "AI Bot Access", "AI Readiness", "Entity & Trust Signals", "FAQ & Answer Optimization",
        "Content Authority", "Local GEO Signals", "AI Crawlability", "Structured Data Integrity",
        "Crawlability", "Technical Access", "Content Structure", "Content Quality",
        "Gemini Crawlability", "Local & E-Commerce", "Schema & Technical",
        "Media & Visuals", "Robots & Bot Access", "AI Discovery Files"
      ].includes(check.category ?? category.categoryName);
      const eeatCategory = ["Author & Expertise", "Editorial Standards", "Trust & Transparency", "Trust Signals & Reviews", "Citations & Evidence"]
        .includes(check.category ?? category.categoryName);
      const indexabilityCategory = ["Index Status", "Canonicalization", "Snippet Controls", "URL & Redirect Management", "International & Pagination", "Access & Gating", "Rendering & Content Access"]
        .includes(check.category ?? category.categoryName);
      const trustSignalsCategory = ["NAP & Brand Consistency", "Schema-DOM Parity", "Technical Trust"]
        .includes(check.category ?? category.categoryName);
      if (!structuredDataCategory && !geoAeoCategory && !eeatCategory && !indexabilityCategory && !trustSignalsCategory) return true;
      const pageCounts = pageCountsFromEvidence(check.evidence);
      return pageCounts.pagesAffected !== undefined
        && pageCounts.pagesAnalyzed !== undefined
        && pageCounts.pagesAffected > 0
        && pageCounts.pagesAnalyzed > 0;
    })
    .map((check) => {
      const evidence = evidenceText(check.evidence);
      const recommendationDetails = typeof check.recommendation === "object"
        ? check.recommendation
        : check.recommendationDetails;
      const legacyRecommendation = typeof check.recommendation === "string"
        ? check.recommendation
        : undefined;
      const fallbackFix = legacyRecommendation || fixForIssue(check.name || "this check", check.category || category.categoryName, evidence);
      const pages = recommendationDetails?.affectedPages?.length ? recommendationDetails.affectedPages : affectedPagesFromEvidence(check.evidence ?? evidence);
      const images = recommendationDetails?.affectedAssets?.length
        ? recommendationDetails.affectedAssets
        : affectedImagesFromEvidence(check.evidence ?? evidence);
      const confidence = recommendationDetails?.detectionConfidence?.score !== undefined
        && recommendationDetails.detectionConfidence.reason
        ? { score: recommendationDetails.detectionConfidence.score, reason: recommendationDetails.detectionConfidence.reason }
        : undefined;
      const pageCounts = pageCountsFromEvidence(check.evidence);
      const severity = normalizedSeverity(recommendationDetails?.severity || check.severity, check.warning);
      const priorityScore = numericPriorityScore(check, severity, recommendationDetails?.priorityScore ?? check.priorityScore);
      return {
        name: check.name || "Unnamed issue",
        meta: check.warning ? "Warning" : "Issue",
        severity,
        priority: recommendationDetails?.priority || priorityFromCheck(check),
        priorityScore,
        scopeLabel: issueScopeLabel(check),
        impactLevel: recommendationDetails?.impactLevel,
        scaleLevel: recommendationDetails?.scaleLevel,
        effortLevel: recommendationDetails?.effortLevel,
        affectedRate: recommendationDetails?.affectedRate ?? affectedRateFromEvidence(check.evidence),
        pagesAffected: recommendationDetails?.validationSummary?.pagesAffected ?? pageCounts.pagesAffected,
        pagesAnalyzed: recommendationDetails?.validationSummary?.pagesAnalyzed ?? pageCounts.pagesAnalyzed,
        uniqueAssetsAffected: recommendationDetails?.uniqueAssetsAffected,
        rootCause: recommendationDetails?.rootCause,
        likelyTemplates: recommendationDetails?.likelyTemplates,
        estimatedFixScope: recommendationDetails?.estimatedFixScope,
        overallAiVisibilityImpact: recommendationDetails?.overallAiVisibilityImpact,
        summary: recommendationDetails?.issueSummary || check.issueSummary || (check.warning
          ? `${check.name || "The audited parameter"} is an optional improvement opportunity.`
          : `${check.name || "The audited parameter"} needs attention on affected pages.`),
        issue: recommendationDetails?.whatIsWrong || recommendationDetails?.issue || check.whatIsWrong || (check.warning
          ? `The advisory signal was not detected on the measured applicable pages.`
          : `The ${check.name || "audited parameter"} check failed on the measured affected pages.`),
        whyItMatters: recommendationDetails?.whyItMatters,
        businessImpact: recommendationDetails?.businessImpact || check.businessImpact || genericBusinessImpact(check.name || ""),
        aiVisibilityImpact: recommendationDetails?.aiVisibilityImpact || genericAiImpact(check.name || ""),
        fixes: recommendationDetails?.recommendedFix?.slice(0, 3) || sentenceSteps(recommendationDetails?.howToFix || fallbackFix),
        bestPracticeExample: recommendationDetails?.bestPracticeExample,
        developerNotes: recommendationDetails?.developerNotes,
        evidence: undefined,
        evidenceLines: (recommendationDetails?.whatWeChecked?.length
          ? recommendationDetails.whatWeChecked
          : check.validationSummary?.length
            ? check.validationSummary
            : fallbackValidationSummary(check.evidence, check.whatIsWrong || `${check.name || "The audited signal"} was not detected on the affected pages.`)).slice(0, 7).map(boundedSummaryLine),
        brokenLinkEvidence: brokenLinkEvidenceFromEvidence(check.evidence),
        topFixCandidates: topFixCandidatesForCheck(check, recommendationDetails, pages),
        pages,
        images,
        confidence,
        representativeImage: representativeImageFromEvidence(check.evidence)
      };
    });
  const detailItems = checks.length ? [] : ((category as GeoIssueCategory).failedCheckDetails ?? []).filter((detail) => {
    const counts = pageCountsFromEvidence(detail.evidence);
    return counts.pagesAffected !== undefined
      && counts.pagesAnalyzed !== undefined
      && counts.pagesAffected > 0
      && counts.pagesAnalyzed > 0
      && affectedPagesFromEvidence(detail.evidence).length > 0;
  }).map((detail) => {
    const pages = affectedPagesFromEvidence(detail.evidence);
    const check = { name: detail.name, category: category.categoryName, severity: detail.severity, evidence: detail.evidence };
    return {
      name: detail.name || "Unnamed issue",
      meta: "Issue",
      severity: normalizedSeverity(detail.severity),
      priority: detail.severity === "High" || detail.severity === "Critical" ? "High" : "Medium",
      priorityScore: numericPriorityScore({ severity: detail.severity, evidence: detail.evidence }, normalizedSeverity(detail.severity)),
      affectedRate: 0,
      summary: `${detail.name || "The audited parameter"} needs attention on measured affected pages.`,
      issue: `${detail.name || "The audited signal"} was not detected on the affected pages shown in evidence.`,
      businessImpact: genericBusinessImpact(detail.name || ""),
      aiVisibilityImpact: genericAiImpact(detail.name || ""),
      fixes: detail.recommendation ? sentenceSteps(detail.recommendation) : [],
      evidence: undefined,
      evidenceLines: fallbackValidationSummary(detail.evidence),
      topFixCandidates: topFixCandidatesForCheck(check, undefined, pages),
      pages,
      images: affectedImagesFromEvidence(detail.evidence)
    };
  });

  const seen = new Map<string, DetailItem>();
  for (const item of [...detailItems, ...checkItems]) {
    const key = `${item.name}-${item.meta ?? ""}`;
    const existing = seen.get(key);
    if (!existing || (!existing.fixes?.length && item.fixes?.length)) seen.set(key, item);
  }
  return [...seen.values()];
}

function passedItemsFor(checks: CheckLike[]): DetailItem[] {
  return checks
    .filter((check) => !check.skipped && !check.informational && check.passed && !check.warning)
    .map((check) => ({ name: check.name || "Unnamed passed check", meta: "Passed" }));
}

function opportunityItemsFor(checks: CheckLike[]): DetailItem[] {
  return checks
    .filter((check) => check.informational && check.opportunity)
    .map((check) => ({
      name: check.name || "Content opportunity",
      meta: "Informational",
      summary: check.opportunity
    }));
}

function skippedItemsFor(category: CategoryLike, checks: CheckLike[]): DetailItem[] {
  const checkItems = checks
    .filter((check) => check.skipped)
    .map((check) => ({
      name: check.name || "Unnamed skipped check",
      meta: check.notApplicable ? "Not applicable" : "Skipped",
      evidence: skippedReasonText(check)
    }));
  const detailItems = checks.length ? [] : ((category as GeoIssueCategory).skippedCheckDetails ?? []).map((detail) => ({
    name: detail.name || "Skipped check",
    meta: "Not applicable",
    evidence: detail.reason
  }));

  return [...checkItems, ...detailItems];
}

const STRUCTURED_PARENT_CHECKS: Record<string, string[]> = {
  "Organization Schema": ["Organization Schema Present"],
  "LocalBusiness Schema": ["LocalBusiness Schema Present with Valid @type"],
  "Article Schema": ["Article: headline"],
  "Person Schema": ["Person Schema on Bio Pages"],
  "FAQ & HowTo Schema": ["FAQPage When FAQ in DOM", "HowTo on Step-by-Step"]
};

function AuditRow({ category, tab }: { category: CategoryLike; tab: TabInfo }) {
  const [openIssues, setOpenIssues] = useState<Set<string>>(() => new Set());
  const [dependentChecksOpen, setDependentChecksOpen] = useState(false);
  const skipped = category.status === "Skipped" || category.skippedChecks === category.totalChecks;
  const score = skipped ? null : clampScore(category.score);
  const status = (skipped ? "Skipped" : ["Passed", "Minor Attention", "Needs Attention", "Skipped"].includes(category.status) ? category.status : statusFor(score ?? 0, skipped)) as Status;
  const checks = checksForCategory(tab, category);
  const rawIssues = issueItemsFor(category, checks);
  const structuredDataCategory = tab.label === "Structured data";
  const parentCheckNames = structuredDataCategory ? STRUCTURED_PARENT_CHECKS[category.categoryName] ?? [] : [];
  const failedParentChecks = parentCheckNames.filter((name) => rawIssues.some((issue) => issue.name === name));
  const parentSchemaMissing = failedParentChecks.length > 0;
  const issues = parentSchemaMissing
    ? rawIssues.filter((issue) => failedParentChecks.includes(issue.name))
    : rawIssues;
  const dependentChecks = parentSchemaMissing
    ? checks.filter((check) => !failedParentChecks.includes(check.name ?? ""))
    : [];
  const passed = passedItemsFor(checks);
  const opportunities = opportunityItemsFor(checks);
  const rawSkippedItems = skippedItemsFor(category, checks);
  const skippedItems = rawSkippedItems;
  const informationalOnly = checks.length > 0 && checks.every((check) => check.informational);
  const allSkippedChecksAreNotApplicable = checks.some((check) => check.skipped)
    && checks.filter((check) => check.skipped).every((check) => check.notApplicable);
  const specialistAllNotApplicable = category.categoryName === "Specialist Schema Types" && allSkippedChecksAreNotApplicable;
  const passedCount = Math.max(0, (category.passedChecks ?? passed.length) - opportunities.length);
  const applicableCheckCount = parentSchemaMissing ? failedParentChecks.length : checks.length;
  const skippedCount = skippedItems.length;
  const issueCountLabel = issues.length;
  const limitedCoverage = !skipped && skippedCount > 0;
  const statusLabel = informationalOnly
    ? "Informational"
    : allSkippedChecksAreNotApplicable
      ? "Not applicable"
      : status === "Passed" && limitedCoverage
        ? "Passed · limited coverage"
        : status;
  const displayedScore = informationalOnly || allSkippedChecksAreNotApplicable ? null : score;

  return (
    <details className={`${styles.card} ${styles.auditRow}`}>
      <summary>
        <div className={styles.auditRowMain}>
          <h3>{category.categoryName}</h3>
          <span>{parentSchemaMissing
            ? `${applicableCheckCount} applicable check${applicableCheckCount === 1 ? "" : "s"} · ${dependentChecks.length} dependent checks`
            : `${category.totalChecks} checks`}</span>
        </div>
        <div className={styles.auditRowStats}>
          {!informationalOnly ? <span className={styles.passCount}>{passedCount} passed</span> : null}
          {opportunities.length > 0 ? <span className={styles.passCount}>{opportunities.length} opportunities</span> : null}
          <span className={issueCountLabel > 0 ? styles.issueCount : styles.passCount}>{issueCountLabel} issues</span>
          {skippedCount > 0 ? <span className={styles.skipCount}>{skippedCount} skipped</span> : null}
          <strong>{displayedScore === null ? "N/A" : `${displayedScore}%`}</strong>
          <span className={`${styles.badge} ${statusMeta[status].className}`}>{informationalOnly ? "i" : statusMeta[status].icon} {statusLabel}</span>
          <span className={styles.detailToggle}>
            <span>View details</span>
            <i aria-hidden="true" />
          </span>
        </div>
      </summary>
      <div className={styles.auditRowBody}>
        <span className={styles.progress}><i style={{ width: displayedScore === null ? "0%" : `${displayedScore}%` }} /></span>
        <div className={styles.checkColumns}>
          <div>
            <h4>{opportunities.length ? `Content opportunities (${opportunities.length})` : `Issues (${issueCountLabel})`}</h4>
            {opportunities.length ? (
              <ul className={styles.checkList}>
                {opportunities.map((opportunity) => (
                  <li key={`${category.categoryName}-${opportunity.name}-opportunity`} className={styles.passedCheck}>
                    <b>+</b>
                    <span>
                      <strong>{opportunity.name}</strong>
                      <small>{opportunity.summary}</small>
                    </span>
                    <em>{opportunity.meta}</em>
                  </li>
                ))}
              </ul>
            ) : issues.length ? (
              <ul className={styles.checkList}>
                {issues.map((issue) => (
                  <li className={styles.issueDropdownItem} key={`${category.categoryName}-${issue.name}-${issue.meta ?? "issue"}`}>
                    <div className={`${styles.issueDropdown} ${openIssues.has(issue.name) ? styles.issueDropdownOpen : ""}`}>
                      <button
                        type="button"
                        className={styles.issueDropdownToggle}
                        aria-expanded={openIssues.has(issue.name)}
                        onClick={() => setOpenIssues((current) => {
                          const next = new Set(current);
                          if (next.has(issue.name)) next.delete(issue.name);
                          else next.add(issue.name);
                          return next;
                        })}
                      >
                        <b>!</b>
                        <strong>{issue.name}</strong>
                        <i>{openIssues.has(issue.name) ? "Hide details" : "View details"}</i>
                      </button>
                      {openIssues.has(issue.name) ? <div className={styles.issueDropdownBody}>
                      {(issue.issue || issue.summary) ? <small>{issue.issue || issue.summary}</small> : null}
                      {issue.brokenLinkEvidence?.length ? (
                        <small className={styles.evidenceText}>
                          <i>Failed URLs</i>
                          <ul>
                            {issue.brokenLinkEvidence.map((finding, index) => (
                              <li key={`${finding.brokenUrl}-${index}`}>
                                <a href={finding.brokenUrl} target="_blank" rel="noreferrer">{finding.brokenUrl}</a>
                                {" "}— {finding.finalStatus}
                              </li>
                            ))}
                          </ul>
                        </small>
                      ) : null}
                      {issue.pages?.length ? (
                        <small className={styles.affectedPages}>
                          <i>Pages with this issue</i>
                          {issue.pages.map((page) => <a key={page} href={page} target="_blank" rel="noreferrer">{page}</a>)}
                        </small>
                      ) : null}
                      {issue.images?.length ? (
                        <small className={styles.affectedPages}>
                          <i>Assets with this issue</i>
                          {issue.images.slice(0, 5).map((image) => <span key={image}>{imageFileName(image)}</span>)}
                        </small>
                      ) : null}
                      {issue.fixes?.length ? (
                        <small className={styles.actionSteps}>
                          <i>How to fix</i>
                          <ol>{issue.fixes.map((step) => <li key={step}>{step}</li>)}</ol>
                        </small>
                      ) : null}
                      </div> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.emptyChecks}>No issues found in this category.</p>
            )}
          </div>
          <div>
            {!skipped && !informationalOnly && passedCount > 0 ? (
              <>
                <h4>Passed ({passedCount})</h4>
                {passed.length ? (
                  <ul className={styles.checkList}>
                    {passed.map((item) => (
                      <li key={`${category.categoryName}-${item.name}-${item.meta ?? "passed"}`} className={styles.passedCheck}>
                        <b>OK</b>
                        <span>{item.name}</span>
                        {item.meta ? <em>{item.meta}</em> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.emptyChecks}>{passedCount} checks passed. Detailed passed-check names are not available for this audit section.</p>
                )}
              </>
            ) : null}
            {skippedItems.length ? (
              <>
                <h4>{allSkippedChecksAreNotApplicable ? "Not applicable" : "Skipped / not applicable"} checks ({skippedCount})</h4>
                {skipped ? (
                  <p className={styles.emptyChecks}>
                    {allSkippedChecksAreNotApplicable
                      ? specialistAllNotApplicable
                        ? "No applicable specialist schema page types were detected during the crawl."
                        : "This category is not applicable for the audited page or site type."
                      : "These checks were skipped because they were not applicable or could not be verified in the current crawl environment."}
                  </p>
                ) : null}
                <ul className={styles.checkList}>
                  {skippedItems.map((item) => (
                    <li key={`${category.categoryName}-${item.name}-${item.meta ?? "skipped"}`} className={styles.skippedCheck}>
                      <b>-</b>
                      <span>
                        <strong>{item.name}</strong>
                        {item.evidence ? <small className={styles.evidenceText}><i>Reason</i>{item.evidence}</small> : null}
                      </span>
                      {item.meta ? <em>{item.meta}</em> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {parentSchemaMissing ? (
              <div className={styles.dependentChecks}>
                <button
                  type="button"
                  aria-expanded={dependentChecksOpen}
                  onClick={() => setDependentChecksOpen((open) => !open)}
                >
                  <span>{dependentChecks.length} properties will be checked once schema is added</span>
                  <i>{dependentChecksOpen ? "Hide" : "Show"}</i>
                </button>
                {dependentChecksOpen ? (
                  <div>
                    <p>These parameters are not counted as current issues.</p>
                    <ul>
                      {dependentChecks.map((check) => <li key={`${category.categoryName}-${check.name}-dependent`}>{check.name}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </details>
  );
}

function AuditDetailPanel({ tab }: { tab: TabInfo }) {
  if (!tab.available) {
    return (
      <section className={styles.auditPanel}>
        <div className={styles.auditHero}>
          <div>
            <p>Audit workspace</p>
            <h2>{tab.label}</h2>
            <span>This audit did not complete. Its unavailable result is excluded from scoring.</span>
          </div>
          <div className={styles.auditHeroScore}>
            <strong>N/A</strong>
            <span>Audit unavailable</span>
          </div>
        </div>
      </section>
    );
  }
  const failedCategories = tab.categories.filter((category) => category.status !== "Skipped" && category.failedChecks > 0);
  const informationalCategoryNames = new Set(
    tab.checks.filter((check) => check.informational).map((check) => check.category).filter(Boolean)
  );
  const passedCategories = tab.categories.filter((category) =>
    category.status !== "Skipped"
    && category.failedChecks === 0
    && !informationalCategoryNames.has(category.categoryName)
  );
  const skippedCheckCount = tab.checks.filter((check) => check.skipped).length;
  const highPriorityIssues = tab.checks.filter((check) => !check.passed && !check.skipped && impactForFinding(check) === "high").length;
  const totalChecks = tab.checks.length;
  const completedChecks = tab.checks.filter((check) => !check.skipped).length;
  const coverage = totalChecks ? Math.round((completedChecks / totalChecks) * 100) : 0;
  const passedCheckCount = tab.checks.filter((check) => check.passed && !check.skipped && !check.warning).length;
  const issueCheckCount = tab.checks.filter((check) => !check.passed && !check.skipped && !check.warning).length;
  const advisoryCheckCount = tab.checks.filter((check) => check.warning && !check.skipped).length;
  const notApplicableCheckCount = tab.checks.filter((check) => check.skipped && check.notApplicable).length;
  const unverifiableCheckCount = tab.checks.filter((check) => check.skipped && !check.notApplicable).length;
  const trustSignalSummary = tab.label === "Trust Signal";

  return (
    <section className={styles.auditPanel}>
      <div className={styles.auditHero}>
        <div>
          <p>Audit workspace</p>
          <h2>{tab.label}</h2>
          <span>Review the parameters, affected page evidence, and recommended fixes for this audit area.</span>
        </div>
        <div className={styles.auditHeroScore}>
          <strong>{trustSignalSummary ? completedChecks : `${tab.score}%`}</strong>
          <span>{tab.issues} open issues</span>
          <span>{trustSignalSummary ? "completed checks" : `${coverage}% check coverage`}</span>
        </div>
      </div>

      {trustSignalSummary ? (
        <div className={styles.auditSummaryGrid}>
          <article className={styles.card}><span>Completed checks</span><strong>{completedChecks}</strong><p>Checks with sufficient measurable evidence.</p></article>
          <article className={styles.card}><span>Passed</span><strong>{passedCheckCount}</strong><p>Completed checks with no detected problem.</p></article>
          <article className={styles.card}><span>Issues / advisory</span><strong>{issueCheckCount} / {advisoryCheckCount}</strong><p>Proven issues and optional opportunities.</p></article>
          <article className={styles.card}><span>Skipped / not applicable</span><strong>{unverifiableCheckCount} / {notApplicableCheckCount}</strong><p>Unverifiable checks and checks outside the site context.</p></article>
        </div>
      ) : (
      <div className={styles.auditSummaryGrid}>
        <article className={styles.card}>
          <span>Needs work</span>
          <strong>{failedCategories.length}</strong>
          <p>Categories with actionable issues.</p>
        </article>
        <article className={styles.card}>
          <span>High priority</span>
          <strong>{highPriorityIssues}</strong>
          <p>Issues affecting the whole domain or every checked page.</p>
        </article>
        <article className={styles.card}>
          <span>No detected issues</span>
          <strong>{passedCategories.length}</strong>
          <p>Categories with no actionable failures in completed checks.</p>
        </article>
        <article className={styles.card}>
          <span>Skipped / not applicable checks</span>
          <strong>{skippedCheckCount}</strong>
          <p>Checks not applicable or not verifiable in this crawl environment.</p>
        </article>
      </div>
      )}

      <div className={styles.sectionHead}>
        <h2>{tab.label} parameters</h2>
        <p>{tab.categories.length} check groups · last checked {formatAuditDate(tab.checkedAt)}</p>
      </div>
      <div className={styles.auditList}>
        {tab.categories.length ? tab.categories.map((category) => <AuditRow key={category.categoryName} category={category} tab={tab} />) : <article className={`${styles.card} ${styles.auditEmpty}`}><h3>No categories available</h3><p>This audit section did not return category data.</p></article>}
      </div>
    </section>
  );
}

function ServerStatusPanel() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [latency, setLatency] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setChecking(true);
    setError("");
    const started = performance.now();
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const elapsed = Math.round(performance.now() - started);
      const data = await response.json().catch(() => ({})) as Partial<HealthResponse> & { message?: string };
      if (!response.ok) throw new Error(data.message ?? `Health check failed with HTTP ${response.status}.`);
      setLatency(elapsed);
      setHealth(data as HealthResponse);
      setLastChecked(new Date());
    } catch (err) {
      setLatency(null);
      setHealth({ ok: false, message: err instanceof Error ? err.message : "Health check failed." });
      setError(err instanceof Error ? err.message : "Health check failed.");
      setLastChecked(new Date());
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  const monitors = useMemo(() => reportHealthMonitors(health), [health]);
  const downCount = monitors.filter((monitor) => monitor.status === "Down").length;
  const attentionCount = monitors.filter((monitor) => monitor.status === "Attention" || monitor.status === "Not configured").length;
  const tone: HealthTone = downCount ? "bad" : attentionCount ? "warn" : "good";
  const statusLabel = downCount ? "Server down" : attentionCount ? "Needs attention" : "All systems operational";

  return (
    <section className={styles.statusPanel}>
      <div className={styles.auditHero}>
        <div>
          <p>Live operations</p>
          <h2>Server Down Monitor</h2>
          <span>Health checks for the report app, storage, and AI visibility integrations run every 30 seconds.</span>
        </div>
        <button type="button" className={styles.secondary} onClick={load} disabled={checking}>
          <RefreshCw aria-hidden="true" />
          {checking ? "Checking..." : "Refresh"}
        </button>
      </div>

      <article className={`${styles.card} ${styles.statusHero} ${styles[`statusHero_${tone}`]}`}>
        <span className={styles.statusHeroIcon}>
          {tone === "bad" ? <ServerCrash aria-hidden="true" /> : tone === "warn" ? <AlertTriangle aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
        </span>
        <div>
          <span className={`${styles.statusBadge} ${styles[`statusBadge_${tone}`]}`}>{statusLabel}</span>
          <h3>{health?.ok === false ? health.message ?? "Health endpoint is unavailable." : "Production services are responding."}</h3>
          <p>{error || "If the health endpoint fails, this panel immediately marks the server as down and lists the affected dependency."}</p>
        </div>
      </article>

      <div className={styles.statusMetricGrid}>
        <article className={styles.card}><span>Response</span><strong>{latency === null ? "-" : `${latency} ms`}</strong><p>Latest health check latency.</p></article>
        <article className={styles.card}><span>Checks</span><strong>{monitors.length || "-"}</strong><p>Tracked services and dependencies.</p></article>
        <article className={styles.card}><span>Down</span><strong className={downCount ? styles.statusTextBad : styles.statusTextGood}>{downCount}</strong><p>Active outage signals.</p></article>
        <article className={styles.card}><span>Updated</span><strong>{lastChecked ? lastChecked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}</strong><p>Last automatic refresh.</p></article>
      </div>

      <div className={styles.sectionHead}>
        <h2>Live monitors</h2>
        <p>{loading ? "Loading checks" : `${monitors.length} checks · ${downCount} down · ${attentionCount} attention`}</p>
      </div>

      <div className={styles.statusGrid}>
        <div className={styles.statusMonitorList}>
          {loading ? [1, 2, 3, 4].map((item) => <article key={item} className={`${styles.card} ${styles.statusSkeleton}`} />) : monitors.map((monitor) => {
            const Icon = monitor.icon;
            return (
              <article className={`${styles.card} ${styles.statusMonitor}`} key={monitor.name}>
                <span className={`${styles.statusMonitorIcon} ${styles[`statusIcon_${monitor.tone}`]}`}><Icon aria-hidden="true" /></span>
                <div>
                  <h3>{monitor.name}</h3>
                  <p>{monitor.description}</p>
                  <small>{monitor.detail}</small>
                </div>
                <b className={`${styles.statusBadge} ${styles[`statusBadge_${monitor.tone}`]}`}>{monitor.status}</b>
              </article>
            );
          })}
        </div>

        <aside className={styles.statusSideStack}>
          <article className={`${styles.card} ${styles.statusSideCard}`}>
            <div className={styles.cardTitle}><h2>Incident Timeline</h2><Clock3 aria-hidden="true" /></div>
            <div className={styles.statusIncidentList}>
              {downCount ? (
                monitors.filter((monitor) => monitor.status === "Down").map((monitor) => <StatusIncident key={monitor.name} tone="bad" title={`${monitor.name} is down`} detail={monitor.detail} />)
              ) : attentionCount ? (
                monitors.filter((monitor) => monitor.status !== "Operational").map((monitor) => <StatusIncident key={monitor.name} tone={monitor.tone} title={`${monitor.name} needs attention`} detail={monitor.detail} />)
              ) : (
                <StatusIncident tone="good" title="No active incidents" detail="All live checks are currently passing." />
              )}
            </div>
          </article>

          <article className={`${styles.card} ${styles.statusSideCard}`}>
            <div className={styles.cardTitle}><h2>Storage Detail</h2><Database aria-hidden="true" /></div>
            <dl className={styles.statusDetails}>
              <div><dt>Mode</dt><dd>{health?.storage?.mode ?? "-"}</dd></div>
              <div><dt>Database</dt><dd>{health?.storage?.database ?? "-"}</dd></div>
              <div><dt>MongoDB</dt><dd>{health?.storage?.mongoConfigured ? "Configured" : "Not configured"}</dd></div>
              <div><dt>Last error</dt><dd>{health?.storage?.lastError ?? "None"}</dd></div>
            </dl>
          </article>
        </aside>
      </div>
    </section>
  );
}

function StatusIncident({ title, detail, tone }: { title: string; detail: string; tone: HealthTone }) {
  return (
    <div className={styles.statusIncident}>
      <i className={styles[`statusDot_${tone}`]} />
      <div><b>{title}</b><p>{detail}</p></div>
    </div>
  );
}

function reportHealthMonitors(health: HealthResponse | null) {
  if (!health) return [];
  const integrations = health.integrations ?? {};
  const storageDown = health.ok === false;
  const storageMode = health.storage?.mode ?? "unknown";
  const storageAttention = !storageDown && (storageMode !== "mongodb" || Boolean(health.storage?.lastError));
  return [
    {
      name: "Report API",
      description: "Next.js report app and health endpoint.",
      status: health.ok ? "Operational" : "Down",
      tone: health.ok ? "good" : "bad",
      icon: health.ok ? CheckCircle2 : ServerCrash,
      detail: health.ok ? "GET /api/health returned successfully." : health.message ?? "Health endpoint failed."
    },
    {
      name: "Report Storage",
      description: "Persistence for reports, leads, and subscriptions.",
      status: storageDown ? "Down" : storageAttention ? "Attention" : "Operational",
      tone: storageDown ? "bad" : storageAttention ? "warn" : "good",
      icon: Database,
      detail: storageAttention ? `Running in ${storageMode} mode${health.storage?.lastError ? `: ${health.storage.lastError}` : "."}` : `Connected to ${health.storage?.database ?? "database"}.`
    },
    {
      name: "Google OAuth",
      description: "GSC and GA4 connection readiness.",
      status: integrations.googleOAuthConfigured ? "Operational" : "Not configured",
      tone: integrations.googleOAuthConfigured ? "good" : "muted",
      icon: Activity,
      detail: integrations.googleOAuthConfigured ? "Client ID, secret, and redirect URI are present." : "Missing one or more OAuth environment variables."
    },
    {
      name: "PageSpeed Insights",
      description: "Lab performance and opportunity checks.",
      status: integrations.pageSpeedConfigured ? "Operational" : "Not configured",
      tone: integrations.pageSpeedConfigured ? "good" : "muted",
      icon: Activity,
      detail: integrations.pageSpeedConfigured ? "API key is configured." : "PAGESPEED_API_KEY or GOOGLE_API_KEY is missing."
    },
    {
      name: "Chrome UX Report",
      description: "Field data for Core Web Vitals.",
      status: integrations.cruxConfigured ? "Operational" : "Not configured",
      tone: integrations.cruxConfigured ? "good" : "muted",
      icon: Activity,
      detail: integrations.cruxConfigured ? "CrUX API access is configured." : "CRUX_API_KEY or GOOGLE_API_KEY is missing."
    }
  ] as const;
}

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [report, setReport] = useState<StructuredAiVisibilityReport | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<ActiveSectionId>("overview");
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [insightsStatus, setInsightsStatus] = useState<"idle" | "submitting" | "subscribed">("idle");
  const [insightsError, setInsightsError] = useState("");
  const [integrationConnections, setIntegrationConnections] = useState<PublicIntegrationConnection[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [integrationsError, setIntegrationsError] = useState("");

  useEffect(() => {
    if (searchParams.get("integration")) setActive("integrations");
  }, [searchParams]);

  useEffect(() => {
    getReport(params.id).then(setReport).catch((err) => setError(err instanceof Error ? err.message : "Report not found"));
  }, [params.id]);

  useEffect(() => {
    if (!report || active !== "integrations") return;
    const controller = new AbortController();
    setIntegrationsLoading(true);
    setIntegrationsError("");
    fetch(`/api/integrations?projectId=${encodeURIComponent(params.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.message === "string" ? data.message : "Could not load integrations.");
        return data as { connections?: PublicIntegrationConnection[] };
      })
      .then((data) => setIntegrationConnections(data.connections ?? []))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setIntegrationsError(err instanceof Error ? err.message : "Could not load integrations.");
      })
      .finally(() => setIntegrationsLoading(false));
    return () => controller.abort();
  }, [active, params.id, report]);

  const derived = useMemo(() => {
    if (!report) return null;
    const technical = report.technical_categories ?? [];
    const geoAll = report.geo_aeo_audit?.categories ?? [];
    const geoChecks = report.geo_aeo_audit?.checks ?? [];
    const citationChecks = checksForIdsOrCategories(geoChecks, CHATGPT_CITATION_CHECK_IDS, CHATGPT_CITATION_CATEGORIES);
    const geminiChecks = checksForIdsOrCategories(geoChecks, GEMINI_CITATION_CHECK_IDS, GEMINI_CITATION_CATEGORIES);
    const citationCheckIds = new Set(citationChecks.map((check) => check.id).filter((id): id is number => typeof id === "number"));
    const geminiCheckIds = new Set(geminiChecks.map((check) => check.id).filter((id): id is number => typeof id === "number"));
    const geoTabChecks = geoChecks.filter((check) => typeof check.id === "number"
      ? !citationCheckIds.has(check.id) && !geminiCheckIds.has(check.id)
      : Boolean(check.category && !CHATGPT_CITATION_CATEGORIES.includes(check.category) && !GEMINI_CITATION_CATEGORIES.includes(check.category)));
    const geoCategoryOrder = geoAll.map((category) => category.categoryName)
      .filter((categoryName) => !CHATGPT_CITATION_CATEGORIES.includes(categoryName) && !GEMINI_CITATION_CATEGORIES.includes(categoryName) && categoryName !== "ChatGPT Citation" && categoryName !== "Gemini Citation");
    const geo = categoriesFromChecks(geoTabChecks, geoCategoryOrder);
    const citation = categoriesFromChecks(citationChecks, CHATGPT_CITATION_CATEGORIES);
    const gemini = categoriesFromChecks(geminiChecks, GEMINI_CITATION_CATEGORIES);
    const crawlability = technical.filter((category) => ["Robots.txt & Sitemap", "Indexability & Crawlability", "Internal Linking", "AI Crawl Readiness"].includes(category.categoryName));
    const crawlabilityChecks = checksForCategories(report.technical_audit?.checks ?? [], crawlability);
    const pageSpeedFromSummary = technical.filter((category) => PAGE_SPEED_CATEGORIES.includes(category.categoryName as typeof PAGE_SPEED_CATEGORIES[number]));
    const pageSpeedChecks = pageSpeedFromSummary.length
      ? checksForCategories(report.technical_audit?.checks ?? [], pageSpeedFromSummary)
      : (report.technical_audit?.checks ?? []).filter((check) => PAGE_SPEED_CATEGORIES.includes(check.category as typeof PAGE_SPEED_CATEGORIES[number]));
    const pageSpeed = pageSpeedFromSummary.length ? pageSpeedFromSummary : categoriesFromChecks(pageSpeedChecks, [...PAGE_SPEED_CATEGORIES]);
    const entitySeo = technical.filter((category) => ENTITY_SEO_CATEGORIES.includes(category.categoryName as typeof ENTITY_SEO_CATEGORIES[number]));
    const entitySeoChecks = checksForCategories(report.technical_audit?.checks ?? [], entitySeo);
    const structuredDataCategories = report.structured_data_audit?.categories ?? [];
    const structuredDataChecks = report.structured_data_audit?.checks ?? [];
    const tabs: Record<AuditTabId, TabInfo> = {
      technical: tabMeta("Technical Audit", technical, report.technical_audit?.checks ?? [], report.technical_audit?.score, report.technical_audit?.checked_at ?? report.created_at),
      pageSpeed: tabMeta("PageSpeed Overview", pageSpeed, pageSpeedChecks, scoreFromCategories(pageSpeed), report.technical_audit?.checked_at ?? report.created_at),
      crawlability: tabMeta("Crawlability", crawlability, crawlabilityChecks, scoreFromCategories(crawlability), report.technical_audit?.checked_at ?? report.created_at),
      structuredData: tabMeta("Structured data", structuredDataCategories, structuredDataChecks, report.structured_data_audit?.score, report.structured_data_audit?.checked_at),
      onPageSeo: tabMeta("On-Page SEO", report.on_page_seo_audit?.categories ?? [], report.on_page_seo_audit?.checks ?? [], report.on_page_seo_audit?.score, report.on_page_seo_audit?.checked_at),
      imageSeo: tabMeta("Image SEO", report.image_seo_audit?.categories ?? [], report.image_seo_audit?.checks ?? [], report.image_seo_audit?.score, report.image_seo_audit?.checked_at),
      eeat: tabMeta("EEAT Audit", report.eeat_audit?.categories ?? [], report.eeat_audit?.checks ?? [], report.eeat_audit?.score, report.eeat_audit?.checked_at),
      trustSignals: tabMeta("Trust Signal", report.trust_signals_audit?.categories ?? [], report.trust_signals_audit?.checks ?? [], report.trust_signals_audit?.score, report.trust_signals_audit?.checked_at),
      entitySeo: tabMeta("Entity SEO", entitySeo, entitySeoChecks, scoreFromCategories(entitySeo), report.technical_audit?.checked_at ?? report.created_at),
      geo: tabMeta("GEO / AEO Audit", geo, geoTabChecks, scoreFromCategories(geo, report.geo_aeo_audit?.score), report.geo_aeo_audit?.checked_at),
      citation: tabMeta("ChatGPT Citation", citation, citationChecks, scoreFromCategories(citation), report.geo_aeo_audit?.checked_at),
      gemini: tabMeta("Gemini Citation", gemini, geminiChecks, scoreFromCategories(gemini), report.geo_aeo_audit?.checked_at),
      indexability: tabMeta("Indexability", report.indexability_audit?.categories ?? [], report.indexability_audit?.checks ?? [], report.indexability_audit?.score, report.indexability_audit?.checked_at)
    };
    const primaryTabs = [tabs.technical, tabs.pageSpeed, tabs.structuredData, tabs.onPageSeo, tabs.imageSeo, tabs.eeat, tabs.trustSignals, tabs.entitySeo, tabs.geo, tabs.indexability];
    const availableScores = primaryTabs.filter((tab) => tab.available).map((tab) => tab.score);
    const fallbackVisibilityScore = availableScores.length ? availableScores.reduce((sum, score) => sum + score, 0) / availableScores.length : 0;
    const aiVisibilityScore = clampScore(tabs.technical.available && tabs.geo.available && report.overall_score ? report.overall_score : fallbackVisibilityScore);
    const issueCounts = mergeIssueCounts(
      issuesFromChecks(report.technical_audit?.checks, technical),
      issuesFromGeoCategories(geoAll as GeoIssueCategory[]),
      issuesFromChecks(report.indexability_audit?.checks, report.indexability_audit?.categories),
      issuesFromChecks(report.structured_data_audit?.checks, report.structured_data_audit?.categories),
      issuesFromChecks(report.on_page_seo_audit?.checks, report.on_page_seo_audit?.categories),
      issuesFromChecks(report.image_seo_audit?.checks, report.image_seo_audit?.categories),
      issuesFromChecks(report.eeat_audit?.checks, report.eeat_audit?.categories),
      issuesFromChecks(report.trust_signals_audit?.checks, report.trust_signals_audit?.categories)
    );
    const tabList = Object.values(tabs);
    const openIssues = issueCounts.high + issueCounts.medium + issueCounts.low;
    const priority = tabList
      .filter((tab) => tab.available && tab.categories.length > 0)
      .sort((a, b) => a.score - b.score || b.issues - a.issues)[0] ?? tabs.technical;
    const nextPriority = tabList
      .filter((tab) => tab.available && tab.label !== priority.label && tab.categories.length > 0)
      .sort((a, b) => a.score - b.score || b.issues - a.issues)[0];
    const auditScores = tabList.filter((tab) => tab.available).map((tab) => tab.score);
    const issueTrend = buildIssueTrend(issueCounts, aiVisibilityScore);
    const lastAuditedAt = report.created_at ?? tabList.map((tab) => tab.checkedAt).find(Boolean);
    return { tabs, aiVisibilityScore, issueCounts, issueTrend, openIssues, priority, nextPriority, auditScores, lastAuditedAt };
  }, [report]);

  if (error) {
    return <main className={styles.page}><div className={styles.container}><article className={styles.card} style={{ padding: 24, color: "#DC2626" }}>{error}</article></div></main>;
  }

  if (!report || !derived) {
    return <main className={styles.page}><div className={styles.container}><article className={styles.card} style={{ padding: 24 }}>Loading report...</article></div></main>;
  }

  const { tabs, aiVisibilityScore, issueCounts, issueTrend, openIssues, priority, nextPriority, auditScores, lastAuditedAt } = derived;
  const auditNav = Object.keys(tabs) as AuditTabId[];
  const activeAuditTab = active === "overview" || active === "integrations" || active === "searchConsole" || active === "serverStatus" ? null : tabs[active];
  const focusMode = active === "searchConsole";
  const priorityIssues = priorityIssueGroups(priority);
  const pdfExportUrl = `${API_BASE}/api/reports/${params.id}/export/pdf`;
  const reviewPriority = () => {
    setActive(auditNav.find((tab) => tabs[tab].label === priority.label) ?? "technical");
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };
  const goToFullReport = () => {
    setActive("overview");
    requestAnimationFrame(() => document.getElementById("full-report")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  const subscribeToInsights = async () => {
    if (insightsStatus !== "idle") return;
    setInsightsStatus("submitting");
    setInsightsError("");

    try {
      const response = await fetch(`${API_BASE}/api/insights-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: params.id })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(typeof result.message === "string" ? result.message : "Could not subscribe to insights.");
      }

      setInsightsStatus("subscribed");
    } catch (err) {
      setInsightsStatus("idle");
      setInsightsError(err instanceof Error ? err.message : "Could not subscribe to insights.");
    }
  };
  const kpis = [
    { label: "AI Visibility Score", value: `${aiVisibilityScore}%`, meta: statusLabel(aiVisibilityScore), icon: "AI", chip: "#FBF1E3", color: "#B8902B", series: auditScores },
    { label: "Open Issues", value: String(openIssues), meta: `${issueCounts.high} high impact`, icon: "!", chip: "#FBEAEA", color: "#DC2626", series: paddedSeries([issueCounts.low, issueCounts.medium, issueCounts.high], openIssues) },
    { label: "Pages Crawlable", value: `${tabs.crawlability.score}%`, meta: `${tabs.crawlability.issues} crawl issues`, icon: "CR", chip: "#EAF6EF", color: "#1F9D55", series: categoryScoreSeries(tabs.crawlability.categories, tabs.crawlability.score) },
    { label: "AI Citation Readiness", value: `${Math.max(tabs.citation.score, tabs.gemini.score)}%`, meta: `${tabs.citation.issues + tabs.gemini.issues} citation issues`, icon: "CT", chip: "#FBF1E3", color: "#B8902B", series: paddedSeries([tabs.citation.score, tabs.gemini.score, tabs.geo.score], tabs.geo.score) }
  ];
  const scoreTiles = [
    tabs.pageSpeed, tabs.onPageSeo, tabs.imageSeo, tabs.eeat, tabs.trustSignals, tabs.entitySeo, tabs.geo, tabs.citation, tabs.gemini, tabs.indexability, tabs.structuredData, tabs.technical
  ];
  const radarAxes = [
    { label: "Speed", value: tabs.pageSpeed.score }, { label: "On-Page", value: tabs.onPageSeo.score }, { label: "Image", value: tabs.imageSeo.score }, { label: "E-E-A-T", value: tabs.eeat.score },
    { label: "Trust", value: tabs.trustSignals.score }, { label: "Entity", value: tabs.entitySeo.score }, { label: "GEO", value: tabs.geo.score }, { label: "ChatGPT", value: tabs.citation.score },
    { label: "Gemini", value: tabs.gemini.score }, { label: "Index", value: tabs.indexability.score }, { label: "Schema", value: tabs.structuredData.score }, { label: "Tech", value: tabs.technical.score }
  ];

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.topInner}>
          <div className={styles.brand}><span>G</span><strong>GLOMAUDIT</strong></div>
          <div className={styles.actions}><button className={styles.secondary} onClick={goToFullReport}>Export PDF</button><button className={styles.primary} onClick={() => router.push("/")}>Generate New Report</button></div>
        </div>
      </header>

      <div className={styles.container}>
        <section className={styles.reportHeader}>
          <p>AI VISIBILITY REPORT</p>
          <h1>{report.brand}</h1>
          <div><a href={report.url} target="_blank">{report.url}</a><span>·</span><span className={styles.liveDot} />Last audited: {formatAuditDate(lastAuditedAt)}</div>
        </section>

        <div className={`${styles.dashboardShell} ${focusMode ? styles.dashboardShellFocused : ""}`}>
          {!focusMode ? <aside className={styles.sideNav} aria-label="Report sections">
            <button type="button" className={active === "overview" ? styles.navActive : ""} onClick={() => setActive("overview")}>
              <span>Overview</span>
              <b>{aiVisibilityScore}%</b>
            </button>
            <button type="button" className={active === "integrations" ? styles.navActive : ""} onClick={() => setActive("integrations")}>
              <span>Integration</span>
              <small>GSC · GA4 · Bing</small>
              <b>{integrationConnections.filter((connection) => connection.status === "CONNECTED").length}/3</b>
            </button>
            <button type="button" className={active === "serverStatus" ? styles.navActive : styles.monitorNavButton} onClick={() => setActive("serverStatus")}>
              <span>Server Down Monitor</span>
              <small>Live uptime checks</small>
              <b>Live</b>
            </button>
            {auditNav.map((tab) => (
              <button key={tab} type="button" className={active === tab ? styles.navActive : ""} onClick={() => setActive(tab)}>
                <span>{tabs[tab].label}</span>
                <small>{tabs[tab].issues} issues</small>
                <b>{tabs[tab].available ? `${tabs[tab].score}%` : "N/A"}</b>
              </button>
            ))}
          </aside> : null}

          <div className={styles.dashboardMain}>
            {active === "overview" ? (
              <>
        <section className={styles.kpiGrid}>
          {kpis.map((kpi) => (
            <article className={`${styles.card} ${styles.kpi}`} key={kpi.label}>
              <span className={styles.kpiIcon} style={{ background: kpi.chip }}>{kpi.icon}</span>
              <p>{kpi.label}</p><strong>{kpi.value}</strong>
              <div><span>{kpi.meta}</span> current audit</div>
              <Sparkline series={kpi.series} color={kpi.color} />
            </article>
          ))}
        </section>

        <section className={styles.heroGrid}>
          <article className={`${styles.card} ${styles.scoreCard}`}>
            <GaugeRing score={aiVisibilityScore} />
            <h2>AI Visibility Score</h2>
            <span className={`${styles.badge} ${styles.minor}`}>! {report.rating_label}</span>
            <p>{report.score_explanation || "Weighted average across all audit categories below."}</p>
          </article>
          <article className={styles.insight}>
            <div className={styles.insightTop}><span>P1</span><b>PRIORITY ACTION</b><em>{priority.issues} issues</em></div>
            <h2>Improve {priority.label} first</h2>
            <p>{report.rating_description || "Improve trust, expertise, structured data, and crawl readiness to lift AI visibility across answer engines."}</p>
            {priorityIssues.length ? (
              <div className={styles.priorityList}>
                {priorityIssues.map((issue, index) => (
                  <button key={issue.categoryName} type="button" onClick={reviewPriority}>
                    <span>{index === 0 ? "P0" : `P${index}`}</span>
                    <div><b>{issue.categoryName}</b><small>{issue.failedChecks} high-priority {issue.failedChecks === 1 ? "issue" : "issues"} · {clampScore(issue.score)}% score</small></div>
                    <i>Review -&gt;</i>
                  </button>
                ))}
              </div>
            ) : null}
            <footer><button className={styles.primary} onClick={reviewPriority}>Review {priority.label} issues -&gt;</button>{nextPriority ? <span>P2: {nextPriority.label} is next at {nextPriority.score}%.</span> : null}</footer>
          </article>
        </section>

        <CoreWebVitalsPanel vitals={report.core_web_vitals} />

        <section className={styles.chartGrid}>
          <article className={styles.card}><div className={styles.cardTitle}><h2>Visibility profile</h2></div><RadarChart axes={radarAxes} /></article>
          <article className={styles.card}>
            <div className={styles.cardTitle}><div><h2>Open issues over time</h2><p className={styles.chartSubtitle}>By severity - trending down as fixes ship</p></div><div className={styles.legend}><span><i className={styles.high} />High</span><span><i className={styles.medium} />Medium</span><span><i className={styles.low} />Low</span></div></div>
            <StackedArea data={issueTrend} />
          </article>
        </section>

        <section className={styles.actionPlanBanner}>
          <p>Want to improve your score? Request a free AEO, GEO action plan from the Glomaudit team.</p>
          <button type="button" onClick={() => setIsCallModalOpen(true)}>Request Action Plan ↓</button>
        </section>

        <section className={`${styles.card} ${styles.aiReadiness}`}>
          <div className={styles.cardTitle}><h2>AI readiness</h2><p>Implemented audit signals for citation, crawl, and answer visibility.</p></div>
          <div className={styles.engineGrid}>
            <MiniGauge name="ChatGPT" sub="GPT-4o · Search" score={tabs.citation.score} platform="chatgpt" />
            <MiniGauge name="Gemini" sub="Google AI Overviews" score={tabs.gemini.score} platform="gemini" />
            <MiniGauge name="GEO / AEO" sub="Answer readiness" score={tabs.geo.score} platform="geo" />
            <MiniGauge name="Overall AI" sub="Weighted readiness" score={aiVisibilityScore} platform="overall" />
          </div>
        </section>

        <section className={`${styles.card} ${styles.opportunities}`}>
          <div><h2>Visibility Opportunities</h2><p>{openIssues} prioritized findings across this audit.</p></div>
          <div><span className={styles.issuePill}><i className={styles.high} />High impact {issueCounts.high}</span><span className={styles.issuePill}><i className={styles.medium} />Medium {issueCounts.medium}</span><span className={styles.issuePill}><i />Low {issueCounts.low}</span></div>
        </section>

        <section>
          <div className={styles.sectionHead}><h2>Scores by category</h2><p>Current score distribution from the latest audit</p></div>
          <div className={styles.tileGrid}>
            {scoreTiles.map((tile) => (
              <article className={`${styles.card} ${styles.tile}`} key={tile.label}>
                <div><b>{tile.label}</b><span className={tile.issues > 0 ? styles.deltaBad : styles.deltaGood}>{tile.issues} issues</span></div>
                <strong>{tile.score}%</strong>
                <Sparkline series={categoryScoreSeries(tile.categories, tile.score)} color={scoreTone(tile.score)} muted={tile.categories.length === 0} />
              </article>
            ))}
          </div>
        </section>

        <section className={styles.insightsBanner}>
          <p>Want expert insights on your AI visibility? Get tailored recommendations every two weeks.</p>
          <button type="button" onClick={subscribeToInsights} disabled={insightsStatus !== "idle"}>
            {insightsStatus === "submitting" ? "Subscribing..." : insightsStatus === "subscribed" ? "Subscribed" : "Send me Insights"}
          </button>
          {insightsStatus === "subscribed" ? (
            <span className={styles.insightsMessage}>You&apos;re now subscribed to personalized AI visibility insights, recommendations, and growth opportunities.</span>
          ) : null}
          {insightsError ? <span className={styles.insightsError}>{insightsError}</span> : null}
        </section>

        <section className={styles.cta} id="full-report">
          <div><h2>Unlock your complete AI visibility report</h2><p>We identified {issueCounts.high} high-impact issues that can materially improve your AI visibility and citation readiness.</p>
            <ul>{["What's hurting your rankings", "Why AI isn't citing your content", "Entity and authority gaps", "Missing trust signals", "Technical visibility blockers", "Revenue-impact opportunities"].map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><a className={styles.blackButton} href={pdfExportUrl} download>Get my full report</a><button className={styles.outlineGold} type="button" onClick={() => setIsCallModalOpen(true)}>Schedule strategy call</button></div>
        </section>

        <section className={styles.strategyUpgrade}>
          <p>UPGRADE YOUR STRATEGY</p>
          <h2>Upgrade from SEO → GEO</h2>
          <span>Your customers are no longer searching only on Google. GEO helps your brand get discovered across AI-powered search and decision platforms.</span>
          <div className={styles.strategyPills}>
            {strategyItems.map((item) => {
              const Icon = item.icon;
              return (
                <b key={item.label}>
                  <Icon aria-hidden="true" />
                  {item.label}
                </b>
              );
            })}
          </div>
          <strong>Increase your visibility across ChatGPT, Gemini and Google AI.</strong>
          <em>⚡ Limited onboarding slots available</em>
          <button className={styles.blackButton} type="button" onClick={() => setIsCallModalOpen(true)}>Get My AI Visibility Strategy</button>
        </section>
              </>
            ) : active === "integrations" ? (
              <IntegrationWorkspace
                projectId={params.id}
                connections={integrationConnections}
                loading={integrationsLoading}
                error={integrationsError}
                onConnectionsChange={setIntegrationConnections}
                onOpenSearchConsole={() => setActive("searchConsole")}
              />
            ) : active === "searchConsole" ? (
              <SearchConsoleReportPanel
                projectId={params.id}
                reportUrl={report.url}
                tabs={tabs}
                vitals={report.core_web_vitals}
                onBack={() => setActive("integrations")}
              />
            ) : active === "serverStatus" ? (
              <ServerStatusPanel />
            ) : active === "pageSpeed" ? (
              <PageSpeedOverviewPanel tab={tabs.pageSpeed} vitals={report.core_web_vitals} />
            ) : activeAuditTab ? (
              <AuditDetailPanel tab={activeAuditTab} />
            ) : null}

        <footer className={styles.footer}>
          <p>Run another audit - generate a fresh visibility report.</p>
          <button className={styles.secondary} onClick={() => router.push("/")}>Generate New Report</button>
        </footer>
        <p className={styles.copyright}>© 2026 GLOMAUDIT Pvt. Ltd. All Rights Reserved.</p>
          </div>
        </div>
      </div>
      <CallbackModal isOpen={isCallModalOpen} onClose={() => setIsCallModalOpen(false)} />
    </main>
  );
}
