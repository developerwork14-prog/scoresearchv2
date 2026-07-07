import type {
  AiVisibilityReport,
  EeatAuditResult,
  GeoAeoAuditResult,
  ImageSeoAuditResult,
  IndexabilityAuditResult,
  OnPageSeoAuditResult,
  PublicTechnicalCheck,
  SeoIssueRecommendation,
  StructuredDataAuditResult,
  TrustSignalsAuditResult
} from "../types.js";
import type { SeoTask, SeoTaskGenerationOptions, SeoTaskOwnerTeam, SeoTaskPriority } from "../types/seo-task.js";

export type SeoTaskAuditCheck = {
  id: number | string;
  category?: string;
  name?: string;
  weight?: number;
  score?: number;
  maxScore?: number;
  severity?: string;
  passed?: boolean;
  skipped?: boolean;
  notApplicable?: boolean;
  informational?: boolean;
  warning?: boolean;
  scope?: string;
  evidence?: unknown;
  issueSummary?: string;
  whatIsWrong?: string;
  businessImpact?: string;
  validationSummary?: unknown;
  recommendation?: unknown;
  recommendationDetails?: Partial<SeoIssueRecommendation>;
};

export type SeoTaskGenerationReport = Omit<Partial<AiVisibilityReport>,
  | "technicalChecks"
  | "geoAeoAudit"
  | "indexabilityAudit"
  | "structuredDataAudit"
  | "onPageSeoAudit"
  | "imageSeoAudit"
  | "eeatAudit"
  | "trustSignalsAudit"
> & {
  id?: string;
  reportId?: string;
  projectId?: string;
  domain?: string;
  websiteUrl?: string;
  technicalChecks?: SeoTaskAuditCheck[];
  geoAeoAudit?: GeoAeoAuditResult;
  indexabilityAudit?: IndexabilityAuditResult;
  structuredDataAudit?: StructuredDataAuditResult;
  onPageSeoAudit?: OnPageSeoAuditResult;
  imageSeoAudit?: ImageSeoAuditResult;
  eeatAudit?: EeatAuditResult;
  trustSignalsAudit?: TrustSignalsAuditResult;
};

export interface SeoTaskIssueInput {
  reportId: string;
  projectId?: string;
  domain?: string;
  auditArea: string;
  check: SeoTaskAuditCheck;
}

interface AuditSource {
  auditArea: string;
  checks: SeoTaskAuditCheck[];
}

const HIGH_PRIORITY_TERMS = [
  "indexability",
  "indexable",
  "robots",
  "sitemap",
  "canonical",
  "schema",
  "structured data",
  "ai accessibility",
  "rendering",
  "meta title",
  "title tag",
  "meta description",
  "https",
  "ssl",
  "broken internal links",
  "broken link",
  "noindex"
];

const MEDIUM_PRIORITY_TERMS = [
  "performance",
  "core web vitals",
  "lcp",
  "inp",
  "cls",
  "heading",
  "h1",
  "trust",
  "internal linking",
  "image seo",
  "alt text",
  "mobile"
];

const LOW_PRIORITY_TERMS = [
  "social",
  "open graph",
  "twitter card",
  "minor asset",
  "optional",
  "advisory"
];

const CONTENT_TERMS = ["meta tag", "meta title", "title tag", "meta description", "heading", "h1", "content basics", "body content"];
const DEVELOPER_TERMS = ["schema", "structured data", "canonical", "robots", "sitemap", "https", "ssl", "redirect", "rendering", "performance", "lcp", "inp", "ttfb", "core web vitals"];
const SEO_TERMS = ["ai accessibility", "semantic html", "internal linking", "indexability", "crawlability", "broken internal links"];
const DESIGN_TERMS = ["image", "layout", "mobile", "cls", "tap target", "viewport"];
const ANALYTICS_TERMS = ["gsc", "google search console", "ga", "google analytics", "pagespeed", "crux", "performance api"];

function textForIssue(issue: Pick<SeoTaskIssueInput, "auditArea" | "check">) {
  const recommendation = issue.check.recommendation;
  const recommendationText = typeof recommendation === "string"
    ? recommendation
    : isRecord(recommendation)
      ? Object.values(recommendation).filter((value) => typeof value === "string").join(" ")
      : "";

  return [
    issue.auditArea,
    issue.check.category,
    issue.check.name,
    issue.check.severity,
    issue.check.issueSummary,
    issue.check.whatIsWrong,
    recommendationText,
    issue.check.recommendationDetails?.issue,
    issue.check.recommendationDetails?.issueSummary,
    issue.check.recommendationDetails?.whatIsWrong
  ].filter(Boolean).join(" ").toLowerCase();
}

function hasAnyTerm(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableTaskId(issue: SeoTaskIssueInput) {
  const raw = [issue.reportId, issue.auditArea, issue.check.category, issue.check.id, issue.check.name].join(":");
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);
}

function domainFromReport(report: SeoTaskGenerationReport) {
  if (report.domain) return report.domain;
  if (!report.websiteUrl) return undefined;

  try {
    return new URL(report.websiteUrl).hostname;
  } catch {
    return undefined;
  }
}

function isHomepage(url: string, domain?: string) {
  try {
    const parsed = new URL(url);
    if (domain && parsed.hostname.replace(/^www\./, "") !== domain.replace(/^www\./, "")) return false;
    return parsed.pathname === "/" || parsed.pathname === "";
  } catch {
    const normalized = url.trim().replace(/\/+$/, "");
    return Boolean(domain) && (normalized === domain || normalized === `https://${domain}` || normalized === `http://${domain}`);
  }
}

function issueAffectsWholeDomain(issue: SeoTaskIssueInput) {
  if (issue.check.scope === "domain") return true;

  const details = issue.check.recommendationDetails;
  if (typeof details?.affectedRate === "number" && details.affectedRate >= 1) return true;

  const validation = details?.validationSummary;
  if (validation && validation.pagesAnalyzed && validation.pagesAffected >= validation.pagesAnalyzed) return true;

  return false;
}

export function normalizeAffectedPages(issue: Pick<SeoTaskIssueInput, "domain" | "check">): string[] {
  const pages = new Set<string>();
  const details = issue.check.recommendationDetails;
  const recommendation = issue.check.recommendation;

  for (const page of details?.affectedPages ?? []) pages.add(page);

  if (isRecord(recommendation) && Array.isArray(recommendation.affectedPages)) {
    for (const page of recommendation.affectedPages) {
      if (typeof page === "string") pages.add(page);
    }
  }

  const evidence = issue.check.evidence;
  if (isRecord(evidence)) {
    for (const key of ["url", "pageUrl", "finalUrl", "canonicalUrl"]) {
      const value = evidence[key];
      if (typeof value === "string") pages.add(value);
    }

    for (const key of ["sampleUrls", "affectedPages", "pages"]) {
      const value = evidence[key];
      if (Array.isArray(value)) {
        for (const page of value) {
          if (typeof page === "string") pages.add(page);
        }
      }
    }
  }

  if (pages.size === 0 && issue.domain) pages.add(`https://${issue.domain}/`);

  return [...pages];
}

export function inferPriority(issue: SeoTaskIssueInput): SeoTaskPriority {
  const affectedPages = normalizeAffectedPages(issue);
  const text = textForIssue(issue);

  if (affectedPages.some((page) => isHomepage(page, issue.domain))) return "high";
  if (issueAffectsWholeDomain(issue)) return "high";
  if (hasAnyTerm(text, HIGH_PRIORITY_TERMS)) return "high";
  if (hasAnyTerm(text, MEDIUM_PRIORITY_TERMS)) return "medium";
  if (hasAnyTerm(text, LOW_PRIORITY_TERMS) || issue.check.severity?.toLowerCase() === "advisory") return "low";

  const severity = issue.check.severity?.toLowerCase();
  if (severity === "blocker" || severity === "critical" || severity === "high" || severity === "major") return "high";
  if (severity === "medium" || severity === "minor") return "medium";

  return "low";
}

export function inferOwnerTeam(issue: Pick<SeoTaskIssueInput, "auditArea" | "check">): SeoTaskOwnerTeam {
  const text = textForIssue(issue);

  if (hasAnyTerm(text, ANALYTICS_TERMS)) return "analytics";
  if (hasAnyTerm(text, DESIGN_TERMS)) return "design";
  if (hasAnyTerm(text, SEO_TERMS)) return "seo";
  if (hasAnyTerm(text, DEVELOPER_TERMS)) return "developer";
  if (hasAnyTerm(text, CONTENT_TERMS)) return "content";

  return "technical";
}

function isActionableFailedCheck(check: SeoTaskAuditCheck) {
  return check.passed === false && !check.skipped && !check.notApplicable && !check.informational;
}

function issueDescription(check: SeoTaskAuditCheck) {
  if (check.whatIsWrong) return check.whatIsWrong;
  if (check.issueSummary) return check.issueSummary;
  if (check.recommendationDetails?.whatIsWrong) return check.recommendationDetails.whatIsWrong;
  if (check.recommendationDetails?.issueSummary) return check.recommendationDetails.issueSummary;
  return check.evidence === undefined ? "The audit detected an actionable SEO issue." : String(typeof check.evidence === "string" ? check.evidence : JSON.stringify(check.evidence));
}

function auditSources(report: SeoTaskGenerationReport): AuditSource[] {
  return [
    { auditArea: "Technical Audit", checks: report.technicalChecks ?? [] },
    { auditArea: "GEO / AEO Audit", checks: report.geoAeoAudit?.checks ?? [] },
    { auditArea: "Indexability Audit", checks: report.indexabilityAudit?.checks ?? [] },
    { auditArea: "Structured Data Audit", checks: report.structuredDataAudit?.checks ?? [] },
    { auditArea: "On-Page SEO Audit", checks: report.onPageSeoAudit?.checks ?? [] },
    { auditArea: "Image SEO Audit", checks: report.imageSeoAudit?.checks ?? [] },
    { auditArea: "E-E-A-T Audit", checks: report.eeatAudit?.checks ?? [] },
    { auditArea: "Trust Signals Audit", checks: report.trustSignalsAudit?.checks ?? [] }
  ];
}

export function generateSeoTasks(report: SeoTaskGenerationReport, options: SeoTaskGenerationOptions = {}): SeoTask[] {
  const reportId = report.reportId ?? report.id ?? "unpersisted-report";
  const domain = domainFromReport(report);
  const timestamp = typeof options.now === "string" ? options.now : (options.now ?? new Date()).toISOString();

  return auditSources(report).flatMap((source) => source.checks.filter(isActionableFailedCheck).map((check) => {
    const issue: SeoTaskIssueInput = {
      reportId,
      projectId: report.projectId,
      domain,
      auditArea: source.auditArea,
      check
    };

    return {
      id: stableTaskId(issue),
      reportId,
      projectId: report.projectId,
      domain,
      auditArea: source.auditArea,
      checkGroup: check.category ?? source.auditArea,
      issueTitle: check.name ?? check.recommendationDetails?.issue ?? "SEO audit issue",
      issueDescription: issueDescription(check),
      affectedPages: normalizeAffectedPages(issue),
      priority: inferPriority(issue),
      status: options.defaultStatus ?? "open",
      ownerTeam: inferOwnerTeam(issue),
      source: "audit",
      evidence: check.evidence,
      recommendation: check.recommendation ?? check.recommendationDetails?.recommendedFix ?? check.recommendationDetails,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }));
}
