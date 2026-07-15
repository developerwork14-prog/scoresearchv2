"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Bot, FileText, MapPin, Search, Video } from "lucide-react";
import type { StructuredAiVisibilityReport } from "@aiva/core";
import { API_BASE, getReport } from "@/lib/api";
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
type AuditTabId = "technical" | "crawlability" | "structuredData" | "onPageSeo" | "imageSeo" | "eeat" | "trustSignals" | "geo" | "citation" | "gemini" | "indexability";
type ActiveSectionId = "overview" | AuditTabId;
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

const strategyItems = [
  { label: "SEO", icon: Search },
  { label: "Local Search", icon: MapPin },
  { label: "AEO", icon: FileText },
  { label: "AI Visibility", icon: Bot },
  { label: "Video Search", icon: Video }
];

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
    return "Add DefinedTerm schema only on glossary term pages.";
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
  const skippedItems = structuredDataCategory ? [] : rawSkippedItems;
  const informationalOnly = checks.length > 0 && checks.every((check) => check.informational);
  const allSkippedChecksAreNotApplicable = checks.some((check) => check.skipped)
    && checks.filter((check) => check.skipped).every((check) => check.notApplicable);
  const passedCount = Math.max(0, (category.passedChecks ?? passed.length) - opportunities.length);
  const applicableCheckCount = parentSchemaMissing ? failedParentChecks.length : checks.length;
  const skippedCount = skippedItems.length;
  const issueCountLabel = issues.length;
  const limitedCoverage = !skipped && skippedCount > 0;
  const statusLabel = informationalOnly
    ? "Informational"
    : status === "Passed" && limitedCoverage
      ? "Passed · limited coverage"
      : status;
  const displayedScore = informationalOnly ? null : score;

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
                      ? "This category is not applicable for the audited page or site type."
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

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [report, setReport] = useState<StructuredAiVisibilityReport | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<ActiveSectionId>("overview");
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);
  const [insightsStatus, setInsightsStatus] = useState<"idle" | "submitting" | "subscribed">("idle");
  const [insightsError, setInsightsError] = useState("");

  useEffect(() => {
    getReport(params.id).then(setReport).catch((err) => setError(err instanceof Error ? err.message : "Report not found"));
  }, [params.id]);

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
    const structuredDataCategories = report.structured_data_audit?.categories ?? [];
    const structuredDataChecks = report.structured_data_audit?.checks ?? [];
    const tabs: Record<AuditTabId, TabInfo> = {
      technical: tabMeta("Technical Audit", technical, report.technical_audit?.checks ?? [], report.technical_audit?.score, report.technical_audit?.checked_at ?? report.created_at),
      crawlability: tabMeta("Crawlability", crawlability, crawlabilityChecks, scoreFromCategories(crawlability), report.technical_audit?.checked_at ?? report.created_at),
      structuredData: tabMeta("Structured data", structuredDataCategories, structuredDataChecks, report.structured_data_audit?.score, report.structured_data_audit?.checked_at),
      onPageSeo: tabMeta("On-Page SEO", report.on_page_seo_audit?.categories ?? [], report.on_page_seo_audit?.checks ?? [], report.on_page_seo_audit?.score, report.on_page_seo_audit?.checked_at),
      imageSeo: tabMeta("Image SEO", report.image_seo_audit?.categories ?? [], report.image_seo_audit?.checks ?? [], report.image_seo_audit?.score, report.image_seo_audit?.checked_at),
      eeat: tabMeta("EEAT Audit", report.eeat_audit?.categories ?? [], report.eeat_audit?.checks ?? [], report.eeat_audit?.score, report.eeat_audit?.checked_at),
      trustSignals: tabMeta("Trust Signal", report.trust_signals_audit?.categories ?? [], report.trust_signals_audit?.checks ?? [], report.trust_signals_audit?.score, report.trust_signals_audit?.checked_at),
      geo: tabMeta("GEO / AEO Audit", geo, geoTabChecks, scoreFromCategories(geo, report.geo_aeo_audit?.score), report.geo_aeo_audit?.checked_at),
      citation: tabMeta("ChatGPT Citation", citation, citationChecks, scoreFromCategories(citation), report.geo_aeo_audit?.checked_at),
      gemini: tabMeta("Gemini Citation", gemini, geminiChecks, scoreFromCategories(gemini), report.geo_aeo_audit?.checked_at),
      indexability: tabMeta("Indexability", report.indexability_audit?.categories ?? [], report.indexability_audit?.checks ?? [], report.indexability_audit?.score, report.indexability_audit?.checked_at)
    };
    const primaryTabs = [tabs.technical, tabs.structuredData, tabs.onPageSeo, tabs.imageSeo, tabs.eeat, tabs.trustSignals, tabs.geo, tabs.indexability];
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
  const activeAuditTab = active === "overview" ? null : tabs[active];
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
    tabs.onPageSeo, tabs.imageSeo, tabs.eeat, tabs.trustSignals, tabs.geo, tabs.citation, tabs.gemini, tabs.indexability, tabs.structuredData, tabs.technical
  ];
  const radarAxes = [
    { label: "On-Page", value: tabs.onPageSeo.score }, { label: "Image", value: tabs.imageSeo.score }, { label: "E-E-A-T", value: tabs.eeat.score },
    { label: "Trust", value: tabs.trustSignals.score }, { label: "GEO", value: tabs.geo.score }, { label: "ChatGPT", value: tabs.citation.score },
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

        <div className={styles.dashboardShell}>
          <aside className={styles.sideNav} aria-label="Report sections">
            <button type="button" className={active === "overview" ? styles.navActive : ""} onClick={() => setActive("overview")}>
              <span>Overview</span>
              <b>{aiVisibilityScore}%</b>
            </button>
            {auditNav.map((tab) => (
              <button key={tab} type="button" className={active === tab ? styles.navActive : ""} onClick={() => setActive(tab)}>
                <span>{tabs[tab].label}</span>
                <small>{tabs[tab].issues} issues</small>
                <b>{tabs[tab].available ? `${tabs[tab].score}%` : "N/A"}</b>
              </button>
            ))}
          </aside>

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
