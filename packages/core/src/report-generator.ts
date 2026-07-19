import {
  AiVisibilityReport,
  AiMarketPosition,
  EeatAuditResult,
  LeadGenerationMetric,
  Recommendation,
  RecommendationPriority,
  ReportInput,
  RiskLevel,
  ScoringPillars,
  GeoAeoAuditResult,
  GeoAeoCategorySummary,
  ImageSeoAuditResult,
  IndexabilityAuditResult,
  OnPageSeoAuditResult,
  StructuredDataAuditResult,
  TechnicalCategoryStatus,
  TechnicalCategorySummary,
  TrustSignalsAuditResult,
  VisibilityLevel
} from "./types.js";
import { runTechnicalAudit, TechnicalAuditResult, TechnicalCheckResult } from "./technical-audit.js";
import { runEeatAudit } from "./eeat-audit.js";
import { runGeoAeoAudit } from "./geo-aeo-audit.js";
import { runImageSeoAudit } from "./image-seo-audit.js";
import { runIndexabilityAudit } from "./indexability-audit.js";
import { runOnPageSeoAudit } from "./on-page-seo-audit.js";
import { runStructuredDataAudit } from "./structured-data-audit.js";
import { runTrustSignalsAudit } from "./trust-signals-audit.js";
import { classifyBusiness } from "./lib/business-classification.js";
import { crawlSite, type SiteCrawlResult } from "./site-crawler.js";
import { scoreParameterOutcomes } from "./audit-outcome.js";
import { fetchBrandVisibility } from "./serper-brand-visibility.js";
import { pageSpeedSnapshot } from "./pagespeed-insights.js";

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function stableHash(value: string) {
  return [...value].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
}

function scoreFromSeed(seed: number, offset: number, min = 18, max = 82) {
  const normalized = ((seed >> offset) & 0xff) / 255;
  return clamp(min + normalized * (max - min));
}

function getVisibilityLevel(score: number): VisibilityLevel {
  if (score < 25) return "Critical";
  if (score < 40) return "Poor";
  if (score < 55) return "Below Average";
  if (score < 70) return "Average";
  if (score < 85) return "Strong";
  return "Excellent";
}

function calculateScore(technicalScore: number, geoAeoScore: number) {
  return clamp(technicalScore * 0.4 + geoAeoScore * 0.6);
}

function riskLevel(score: number): RiskLevel {
  if (score < 25) return "Critical";
  if (score < 45) return "High";
  if (score < 70) return "Medium";
  return "Low";
}

function authorityStrength(score: number): AiMarketPosition["authorityStrength"] {
  if (score < 35) return "Low";
  if (score < 65) return "Moderate";
  if (score < 85) return "Strong";
  return "Excellent";
}

function marketPosition(score: number, categoryVisibility: number, authority: number) {
  if (score >= 80 && categoryVisibility >= 75 && authority >= 75) return "Strong AI-ready position within the detected category";
  if (score >= 65 && categoryVisibility >= 60) return "Established AI visibility within the detected category";
  if (score >= 45) return "Developing AI presence with clear optimization upside";
  return "Early-stage AI visibility with limited supporting evidence";
}

async function withAuditTimeout<T>(promise: Promise<T>, ms: number, fallback: T | (() => T | Promise<T>), label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const resolveFallback = () => typeof fallback === "function"
    ? (fallback as () => T | Promise<T>)()
    : fallback;
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timeout = setTimeout(() => {
        console.warn(`${label} timed out after ${ms}ms; using reduced-scope fallback`);
        Promise.resolve(resolveFallback()).then(resolve);
      }, ms);
    });
    return await Promise.race([
      promise.catch(async (error) => {
        console.warn(`${label} failed; using reduced-scope fallback`, error);
        return resolveFallback();
      }),
      timeoutPromise
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function fallbackTechnicalCheck(
  id: number,
  category: string,
  name: string,
  passed: boolean,
  evidence: Record<string, unknown>,
  severity: TechnicalCheckResult["severity"] = "MAJOR",
  weight = 1
): TechnicalCheckResult {
  return {
    id,
    category,
    name,
    weight,
    severity,
    passed,
    evidence: JSON.stringify(evidence),
    scope: "page",
    ...(passed ? {} : {
      issueSummary: `${name} could not be fully verified in the reduced-scope technical audit.`,
      whatIsWrong: "The full technical audit reached its processing budget before returning all parameters.",
      businessImpact: "Some crawlability, performance, and accessibility findings may be incomplete until the full technical audit completes."
    })
  };
}

function fallbackTechnicalAudit(reason: string, crawl?: SiteCrawlResult): TechnicalAuditResult {
  const homepage = crawl?.pages.find((page) => page.source === "homepage") ?? crawl?.pages[0];
  const fallbackReason = "Technical audit reached its processing budget; showing reduced-scope crawl evidence.";
  const evidence = {
    reason: fallbackReason,
    processingBudgetExceeded: true,
    pagesCrawled: crawl?.pages.length ?? 0,
    homepageUrl: homepage?.finalUrl ?? homepage?.url ?? "",
    homepageStatus: homepage?.status ?? null,
    responseTimeMs: homepage?.responseTimeMs ?? null
  };
  const checks = [
    fallbackTechnicalCheck(
      1,
      "HTTP & Server Health",
      "Page returns HTTP 200",
      Boolean(homepage && homepage.status >= 200 && homepage.status < 300),
      evidence,
      "BLOCKER",
      10
    ),
    fallbackTechnicalCheck(
      32,
      "Indexability & Crawlability",
      "Page is indexable",
      Boolean(homepage && homepage.status >= 200 && homepage.status < 300),
      evidence,
      "MAJOR",
      8
    )
  ];
  const score = scoreParameterOutcomes(checks, 0);
  return {
    score,
    rawScore: score,
    pageScore: score,
    domainScore: 0,
    grade: score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F",
    blockerFailed: checks.some((check) => check.severity === "BLOCKER" && !check.passed),
    checkedAt: new Date().toISOString(),
    pageSpeed: homepage ? pageSpeedSnapshot(homepage.finalUrl, null, null, {
      ttfb: homepage.responseTimeMs,
      unavailableReason: "PageSpeed Insights data unavailable; TTFB is based on the audit crawler response timing."
    }) : undefined,
    checks,
    categoryDebug: checks.reduce<TechnicalAuditResult["categoryDebug"]>((items, check) => {
      const existing = items?.find((item) => item.category === check.category);
      if (existing) {
        existing.totalChecks += 1;
        existing.passedChecks += check.passed ? 1 : 0;
        existing.failedChecks += check.passed ? 0 : 1;
        if (!check.passed) existing.failedCheckDetails.push({ id: check.id, name: check.name, evidence: check.evidence });
        return items;
      }
      items?.push({
        category: check.category,
        totalChecks: 1,
        passedChecks: check.passed ? 1 : 0,
        failedChecks: check.passed ? 0 : 1,
        failedCheckDetails: check.passed ? [] : [{ id: check.id, name: check.name, evidence: check.evidence }]
      });
      return items;
    }, [])
  };
}

function fallbackGeoAeoAudit(reason: string): GeoAeoAuditResult {
  const categoryNames = [
    "AI Bot Access",
    "AI Readiness",
    "Entity & Trust Signals",
    "FAQ & Answer Optimization",
    "Content Authority",
    "Local GEO Signals",
    "AI Crawlability",
    "Structured Data Integrity",
    "General",
    "Indexability",
    "Crawlability",
    "Technical Access",
    "Content Structure",
    "E-commerce Signals",
    "Content Quality",
    "Gemini Crawlability",
    "Local & E-Commerce",
    "Schema & Technical",
    "Media & Visuals",
    "Robots & Bot Access",
    "AI Discovery Files"
  ];
  const categories: GeoAeoCategorySummary[] = categoryNames.map((categoryName) => ({
    categoryName,
    totalChecks: 0,
    passedChecks: 0,
    failedChecks: 0,
    warningChecks: 0,
    skippedChecks: 0,
    score: 0,
    status: "Skipped",
    skippedCheckDetails: [{ id: 0, name: `${categoryName} unavailable`, reason }]
  }));

  return {
    score: 0,
    rawScore: 0,
    pageScore: 0,
    domainScore: 0,
    grade: "F",
    gradeDescription: reason,
    blockerFailed: true,
    opportunityCounts: { high: 0, medium: 0, low: 0 },
    checkedAt: new Date().toISOString(),
    categories,
    checks: []
  };
}

function fallbackIndexabilityAudit(reason: string): IndexabilityAuditResult {
  return {
    score: 0,
    checkedAt: new Date().toISOString(),
    categories: [{
      categoryName: "Indexability",
      totalChecks: 0,
      passedChecks: 0,
      failedChecks: 0,
      warningChecks: 0,
      skippedChecks: 0,
      score: 0,
      status: "Skipped"
    }],
    checks: []
  };
}

function fallbackStructuredDataAudit(reason: string): StructuredDataAuditResult {
  const categoryNames = [
    "Organization Schema",
    "LocalBusiness Schema",
    "Article Schema",
    "Person Schema",
    "FAQ & HowTo Schema",
    "Product Schema",
    "Supporting Schema Types",
    "Schema Validation & Quality",
    "Schema-DOM Parity",
    "Specialist Schema Types"
  ];
  return {
    score: 0,
    checkedAt: new Date().toISOString(),
    categories: categoryNames.map((categoryName) => ({
      categoryName,
      totalChecks: 0,
      passedChecks: 0,
      failedChecks: 0,
      warningChecks: 0,
      skippedChecks: 0,
      score: 0,
      status: "Skipped"
    })),
    checks: []
  };
}

function fallbackOnPageSeoAudit(reason: string): OnPageSeoAuditResult {
  const categoryNames = [
    "Headings & Titles",
    "Content Signals & Clarity",
    "Structured Markup & Lists",
    "Internal Linking",
    "Image & Media Optimisation"
  ];
  return {
    score: 0,
    checkedAt: new Date().toISOString(),
    categories: categoryNames.map((categoryName) => ({
      categoryName,
      totalChecks: 0,
      passedChecks: 0,
      failedChecks: 0,
      warningChecks: 0,
      skippedChecks: 0,
      score: 0,
      status: "Skipped"
    })),
    checks: []
  };
}

function fallbackImageSeoAudit(reason: string): ImageSeoAuditResult {
  const categoryNames = ["Alt Text", "Image Format & Performance", "Content & Accessibility", "Schema & Markup"];
  return {
    score: 0,
    checkedAt: new Date().toISOString(),
    categories: categoryNames.map((categoryName) => ({
      categoryName,
      totalChecks: 0,
      passedChecks: 0,
      failedChecks: 0,
      warningChecks: 0,
      skippedChecks: 0,
      score: 0,
      status: "Skipped"
    })),
    checks: []
  };
}

function fallbackEeatAudit(reason: string): EeatAuditResult {
  const categoryNames = ["Author & Expertise", "Editorial Standards", "Trust & Transparency", "Trust Signals & Reviews", "Citations & Evidence"];
  return {
    score: 0,
    checkedAt: new Date().toISOString(),
    categories: categoryNames.map((categoryName) => ({
      categoryName,
      totalChecks: 0,
      passedChecks: 0,
      failedChecks: 0,
      warningChecks: 0,
      skippedChecks: 0,
      score: 0,
      status: "Skipped"
    })),
    checks: []
  };
}

function fallbackTrustSignalsAudit(reason: string): TrustSignalsAuditResult {
  const categoryNames = ["NAP & Brand Consistency", "Schema-DOM Parity", "Technical Trust"];
  return {
    score: 0,
    checkedAt: new Date().toISOString(),
    categories: categoryNames.map((categoryName) => ({
      categoryName,
      totalChecks: 0,
      passedChecks: 0,
      failedChecks: 0,
      warningChecks: 0,
      skippedChecks: 0,
      score: 0,
      status: "Skipped"
    })),
    checks: []
  };
}

function severityRank(priority: RecommendationPriority) {
  return priority === "High Priority" ? 0 : priority === "Medium Priority" ? 1 : 2;
}

function findingPriority(check: TechnicalCheckResult): RecommendationPriority {
  try {
    const evidence = JSON.parse(check.evidence) as Record<string, unknown>;
    const pagesChecked = Number(evidence.pagesChecked);
    const pagesFailed = Number(evidence.pagesFailed);
    if (check.scope === "domain" || (pagesChecked > 0 && pagesFailed === pagesChecked)) {
      return "High Priority";
    }
    if (pagesFailed > 1) return "Medium Priority";
  } catch {
    if (check.scope === "domain") return "High Priority";
  }
  return "Low Priority";
}

function generateAuditRecommendations(audit: TechnicalAuditResult): Recommendation[] {
  return audit.checks
    .filter((check) => !check.passed && !check.warning)
    .map((check): Recommendation => ({
      priority: findingPriority(check),
      recommendation: `Resolve the failed "${check.name}" parameter and verify it against the affected-page evidence`,
      reason: `${check.category}: ${check.evidence}`,
      expectedAiVisibilityImpact: `Removes a measured ${check.category.toLowerCase()} failure and increases the percentage of audited parameters that pass.`
    }))
    .sort((a, b) => severityRank(a.priority) - severityRank(b.priority))
    .slice(0, 12);
}

function classificationRecommendation(confidence: number): Recommendation | null {
  if (confidence >= 55) return null;
  return {
    priority: "High Priority",
    recommendation: "Clarify homepage category and service positioning",
    reason: `Business classification confidence is ${confidence}%, which means the homepage evidence is not strong enough to classify industry, sub-industry, and business model reliably.`,
    expectedAiVisibilityImpact: "Improves how AI systems understand what the brand does before they decide whether to recommend it for category-specific prompts."
  };
}

function failedIssueCount(audit: TechnicalAuditResult, ids: number[]) {
  const idSet = new Set(ids);
  return audit.checks.filter((check) => idSet.has(check.id) && !check.passed).length;
}

function categoryStatusWithWarnings(failedChecks: number, warningChecks: number): TechnicalCategoryStatus {
  if (failedChecks === 0 && warningChecks === 0) return "Passed";
  if (failedChecks === 0 || failedChecks <= 2) return "Minor Attention";
  return "Needs Attention";
}

function technicalCategorySummaries(audit: TechnicalAuditResult): TechnicalCategorySummary[] {
  const categoryOrder = [
    "HTTP & Server Health",
    "Security & HTTPS",
    "Robots.txt & Sitemap",
    "Meta Tags",
    "Heading Structure",
    "Canonicalization",
    "Crawl & Redirect Control",
    "Indexability & Crawlability",
    "URL Structure",
    "Core Web Vitals",
    "LCP (Largest Contentful Paint)",
    "INP & Interactivity",
    "CLS (Cumulative Layout Shift)",
    "FCP (First Contentful Paint)",
    "TTFB & Server Response",
    "PageSpeed Scores",
    "Mobile Optimization",
    "Image SEO",
    "Security & Trust Pages",
    "Performance",
    "Performance & Caching",
    "Asset Optimisation",
    "Rendering & DOM",
    "Schema Markup",
    "Social Metadata",
    "External Link Trust",
    "Internal Linking",
    "Semantic HTML",
    "Accessibility",
    "International SEO",
    "Content Basics",
    "Trust Signals",
    "Entity Recognition",
    "Entity Description Consistency",
    "Entity Attribute Consistency",
    "Security & Spam",
    "AI Crawl Readiness",
    "AI Accessibility & Discoverability"
  ];
  const categories = new Map<string, TechnicalCheckResult[]>();

  for (const check of audit.checks) {
    const current = categories.get(check.category) ?? [];
    current.push(check);
    categories.set(check.category, current);
  }

  const orderedCategories = [
    ...categoryOrder.filter((categoryName) => categories.has(categoryName)),
    ...[...categories.keys()].filter((categoryName) => !categoryOrder.includes(categoryName))
  ];

  return orderedCategories
    .filter((categoryName) => categories.has(categoryName))
    .map((categoryName) => {
      const checks = categories.get(categoryName) ?? [];
      const scorableChecks = checks.filter((check) => !check.skipped && check.severity !== "ADVISORY" && check.weight > 0);
      const failedChecks = scorableChecks.filter((check) => !check.passed && !check.warning).length;
      const warningChecks = checks.filter((check) => !check.skipped && (check.warning || check.severity === "ADVISORY")).length;

      return {
        categoryName,
        totalChecks: checks.length,
        passedChecks: checks.filter((check) => !check.skipped && check.passed && !check.warning).length,
        failedChecks,
        warningChecks,
        skippedChecks: checks.filter((check) => check.skipped).length,
        score: scoreParameterOutcomes(scorableChecks, 100),
        status: categoryStatusWithWarnings(failedChecks, warningChecks)
      };
    });
}

function opportunityFloor(score: number) {
  if (score < 25) return 4;
  if (score < 45) return 3;
  if (score < 70) return 2;
  if (score < 85) return 1;
  return 0;
}

function opportunityCount(score: number, auditCount: number) {
  return Math.max(opportunityFloor(score), auditCount);
}

function publicIssueSummary(recommendations: Recommendation[], visibilityScore: number) {
  const highFromFindings = recommendations.filter((item) => item.priority === "High Priority").length;
  const mediumFromFindings = recommendations.filter((item) => item.priority === "Medium Priority").length;
  const lowFromFindings = recommendations.filter((item) => item.priority === "Low Priority").length;
  const highImpactOpportunities = Math.max(opportunityFloor(visibilityScore), highFromFindings);
  const mediumImpactOpportunities = Math.max(visibilityScore < 70 ? 2 : 1, mediumFromFindings);
  const lowImpactOpportunities = lowFromFindings;
  const totalVisible = highImpactOpportunities + mediumImpactOpportunities + lowImpactOpportunities;
  const totalDetected = Math.max(totalVisible, recommendations.length);

  return {
    highImpactOpportunities,
    mediumImpactOpportunities,
    lowImpactOpportunities,
    additionalFindingsDetected: Math.max(0, totalDetected - 3),
    teaserFindings: [
      "Authority signals can be strengthened.",
      "AI recommendation coverage is limited.",
      "Brand trust indicators can be improved."
    ],
    summaryMessages: [
      "Several authority signals are missing.",
      "Multiple AI visibility opportunities were detected.",
      "Important crawlability improvements are available."
    ].filter((_, index) => [highImpactOpportunities, mediumImpactOpportunities, lowImpactOpportunities][index] > 0)
  };
}

function leadMetrics(audit: TechnicalAuditResult, reportBreakdown: AiVisibilityReport["breakdown"]): LeadGenerationMetric[] {
  return [
    {
      label: "AI Decision Coverage",
      score: reportBreakdown.aiDecisionCoverage,
      opportunitiesIdentified: opportunityCount(reportBreakdown.aiDecisionCoverage, failedIssueCount(audit, [77, 78, 79, 80, 81, 82, 85, 91, 107, 113, 114])),
      explanation: "Measures how often AI systems are likely to include your brand in recommendation and decision-making queries.",
      summary: "Multiple AI visibility opportunities were detected."
    },
    {
      label: "Brand Authority",
      score: reportBreakdown.brandAuthority,
      opportunitiesIdentified: opportunityCount(reportBreakdown.brandAuthority, failedIssueCount(audit, [67, 68, 69, 70, 80, 81, 92, 93, 94, 95, 110, 111, 113])),
      explanation: "Measures trust, credibility, and authority signals associated with your brand.",
      summary: "Several authority signals are missing."
    },
    {
      label: "Entity Strength",
      score: reportBreakdown.entityStrength,
      opportunitiesIdentified: opportunityCount(reportBreakdown.entityStrength, failedIssueCount(audit, [77, 78, 79, 80, 81, 82, 87, 88, 89, 100, 105])),
      explanation: "Measures how clearly AI systems understand and identify your business entity.",
      summary: "Entity clarity signals can be strengthened."
    },
    {
      label: "Search Readiness",
      score: reportBreakdown.searchReadiness,
      opportunitiesIdentified: opportunityCount(reportBreakdown.searchReadiness, failedIssueCount(audit, [1, 2, 5, 6, 9, 10, 11, 12, 16, 17, 18, 19, 20, 21, 24, 27, 28, 32, 35, 46, 49, 53, 56, 59, 72, 73, 96, 97, 107])),
      explanation: "Measures how well your website is prepared for discovery, crawling, and indexing.",
      summary: "Important crawlability improvements are available."
    }
  ];
}

async function fetchHomepageHtml(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "AIVisibilityAnalyzer/1.0 (+https://localhost)"
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return "";
    return await response.text();
  } catch {
    return "";
  }
}

function emptySiteCrawl(inputUrl: string, reason: string): SiteCrawlResult {
  const normalizedUrl = inputUrl.startsWith("http") ? inputUrl : `https://${inputUrl}`;
  const url = new URL(normalizedUrl);
  return {
    origin: `${url.protocol}//${url.host}`,
    sitemapUrls: [],
    sitemapSummary: {
      totalUrls: 0,
      sitemapsFound: 0,
      sitemapsFailed: 0,
      discoveryMethod: reason,
      sitemapsDiscovered: 0,
      sitemapFileLimit: 0
    },
    crawlStats: {
      targetUrls: 1,
      attemptedUrls: 1,
      htmlPages: 0,
      failedOrNonHtmlUrls: 1,
      cappedByMaxPages: false
    },
    pages: []
  };
}

export async function generateVisibilityReport(input: ReportInput, origin = "http://localhost:3000"): Promise<AiVisibilityReport> {
  const normalizedUrl = input.websiteUrl.startsWith("http") ? input.websiteUrl : `https://${input.websiteUrl}`;
  const seed = stableHash(`${input.brandName}:${normalizedUrl}:${input.businessEmail}`);
  const htmlContentPromise = fetchHomepageHtml(normalizedUrl);
  const siteCrawlPromise = crawlSite(normalizedUrl, {
    maxPages: 80,
    maxDepth: 3,
    timeoutMs: 2500,
    overallTimeoutMs: 25000,
    concurrency: 8,
    maxSitemapFiles: 25,
    followInternalLinks: true
  }).catch((error) => {
    console.warn("Site crawl failed; continuing with empty crawl", error);
    return emptySiteCrawl(normalizedUrl, "crawl failed");
  });
  const technicalAuditPromise = siteCrawlPromise.then((crawl) => {
    const technicalSample = {
      ...crawl,
      pages: crawl.pages.slice(0, 50)
    };
    return withAuditTimeout(
    runTechnicalAudit(normalizedUrl, technicalSample),
    90000,
    () => fallbackTechnicalAudit("Technical audit timed out", technicalSample),
    "Technical audit"
  );
  });
  const geoAeoAuditPromise = htmlContentPromise.then((html) => withAuditTimeout(
    runGeoAeoAudit(normalizedUrl, html),
    25000,
    fallbackGeoAeoAudit("GEO / AEO audit timed out"),
    "GEO / AEO audit"
  ));
  const indexabilityAuditPromise = htmlContentPromise.then((html) => withAuditTimeout(
    runIndexabilityAudit(normalizedUrl, html, { googleSearchConsole: input.googleSearchConsole }),
    25000,
    fallbackIndexabilityAudit("Indexability audit timed out"),
    "Indexability audit"
  ));
  const structuredDataAuditPromise = Promise.all([htmlContentPromise, siteCrawlPromise]).then(([html, crawl]) => withAuditTimeout(
    runStructuredDataAudit(normalizedUrl, html, crawl),
    15000,
    fallbackStructuredDataAudit("Structured data audit timed out"),
    "Structured data audit"
  ));
  const onPageSeoAuditPromise = Promise.all([htmlContentPromise, siteCrawlPromise]).then(([html, crawl]) => withAuditTimeout(
    runOnPageSeoAudit(normalizedUrl, html, crawl),
    15000,
    fallbackOnPageSeoAudit("On-Page SEO audit timed out"),
    "On-Page SEO audit"
  ));
  const imageSeoAuditPromise = Promise.all([htmlContentPromise, siteCrawlPromise]).then(([html, crawl]) => withAuditTimeout(
    runImageSeoAudit(normalizedUrl, html, crawl),
    15000,
    fallbackImageSeoAudit("Image SEO audit timed out"),
    "Image SEO audit"
  ));
  const eeatAuditPromise = htmlContentPromise.then((html) => withAuditTimeout(
    runEeatAudit(normalizedUrl, html),
    8000,
    fallbackEeatAudit("EEAT audit timed out"),
    "EEAT audit"
  ));
  const trustSignalsAuditPromise = htmlContentPromise.then((html) => withAuditTimeout(
    runTrustSignalsAudit(normalizedUrl, html, input.brandName, input.businessEmail),
    8000,
    fallbackTrustSignalsAudit("Trust Signals audit timed out"),
    "Trust Signals audit"
  ));
  const [technicalAudit, htmlContent, geoAeoAudit, indexabilityAudit, structuredDataAudit, onPageSeoAudit, imageSeoAudit, eeatAudit, trustSignalsAudit, brandVisibility] = await Promise.all([
    technicalAuditPromise,
    htmlContentPromise,
    geoAeoAuditPromise,
    indexabilityAuditPromise,
    structuredDataAuditPromise,
    onPageSeoAuditPromise,
    imageSeoAuditPromise,
    eeatAuditPromise,
    trustSignalsAuditPromise,
    withAuditTimeout(
      fetchBrandVisibility(input.brandName, normalizedUrl),
      12000,
      {
        brandOrganicScore: 50,
        categoryVisibilityScore: 50,
        brandPosition: null,
        aiOverviewDetected: false,
        knowledgePanelDetected: false,
        evidence: { skipped: true, reason: "Brand visibility lookup timed out" }
      },
      "Brand visibility lookup"
    )
  ]);
  const classification = classifyBusiness(normalizedUrl, htmlContent);
  const category = classification.subIndustry;

  const pillars: ScoringPillars = {
    technicalFoundation: technicalAudit.score,
    geoReadiness: geoAeoAudit.score,
    aeoReadiness: clamp((geoAeoAudit.score + onPageSeoAudit.score) / 2),
    brandAuthority: brandVisibility.brandOrganicScore,
    aiSearchVisibility: brandVisibility.categoryVisibilityScore
  };

  const technicalAvailable = technicalAudit.checks.length > 0;
  const geoAvailable = geoAeoAudit.checks.length > 0;
  const visibilityScore = technicalAvailable && geoAvailable
    ? calculateScore(technicalAudit.score, geoAeoAudit.score)
    : technicalAvailable
      ? technicalAudit.score
      : geoAvailable
        ? geoAeoAudit.score
        : 0;
  const categoryVisibility = clamp((pillars.aiSearchVisibility * 0.6) + (pillars.geoReadiness * 0.2) + (pillars.aeoReadiness * 0.2));
  const breakdown = {
    aiDecisionCoverage: pillars.aiSearchVisibility,
    categoryVisibility,
    brandAuthority: pillars.brandAuthority,
    entityStrength: structuredDataAudit.score,
    searchReadiness: clamp((pillars.technicalFoundation + indexabilityAudit.score) / 2)
  };
  const aiMarketPosition: AiMarketPosition = {
    industry: classification.industry,
    subIndustry: classification.subIndustry,
    businessModel: classification.businessModel,
    classificationConfidence: classification.confidence,
    categoryVisibility,
    aiPresenceLevel: getVisibilityLevel(pillars.aiSearchVisibility),
    authorityStrength: authorityStrength(pillars.brandAuthority),
    marketPosition: marketPosition(visibilityScore, categoryVisibility, pillars.brandAuthority)
  };

  const id = `${stableHash(`${Date.now()}:${input.brandName}`).toString(36)}-${Date.now().toString(36)}`;
  const recommendations = [
    classificationRecommendation(classification.confidence),
    ...generateAuditRecommendations(technicalAudit)
  ].filter((item): item is Recommendation => Boolean(item));
  const promptCategory = category.toLowerCase().replace(/\s+services$/i, "");
  const prompts = [
    `${input.brandName} ${promptCategory} services`,
    `${input.brandName} ${category.toLowerCase()} reviews`,
    `Is ${input.brandName} a good ${promptCategory} provider`,
    `${input.brandName} ${classification.businessModel.toLowerCase()}`,
    `${input.brandName} ${classification.industry.toLowerCase()} credibility`
  ];

  return {
    id,
    createdAt: new Date().toISOString(),
    brandName: input.brandName,
    websiteUrl: normalizedUrl,
    businessEmail: input.businessEmail,
    visibilityScore,
    visibilityLevel: getVisibilityLevel(visibilityScore),
    pillars,
    breakdown,
    leadMetrics: leadMetrics(technicalAudit, breakdown),
    visibilityIssueSummary: publicIssueSummary(recommendations, visibilityScore),
    technicalCategorySummaries: technicalCategorySummaries(technicalAudit),
    technicalChecks: technicalAudit.checks,
    technicalCategoryDebug: technicalAudit.categoryDebug,
    coreWebVitals: technicalAudit.pageSpeed,
    geoAeoAudit,
    indexabilityAudit,
    structuredDataAudit,
    onPageSeoAudit,
    imageSeoAudit,
    eeatAudit,
    trustSignalsAudit,
    visibilityOpportunities: [
      "AI systems found opportunities to improve brand understanding.",
      "Authority and trust signals can be strengthened.",
      "Search and crawl readiness can be improved for better discoverability."
    ],
    aiMarketPosition,
    losingPrompts: prompts.slice(0, 4).map((prompt, index) => ({
      prompt,
      intentType: ["Commercial", "Comparison", "Transactional", "Informational"][index] as never,
      visibility: clamp(pillars.aiSearchVisibility - 12 + index * 5)
    })),
    opportunities: prompts.map((prompt, index) => ({
      prompt,
      currentVisibility: clamp(pillars.aiSearchVisibility - 18 + index * 4),
      potentialTrafficOpportunity: ["High-intent buyers", "Brand evaluation traffic", "Evaluation traffic", "Research demand", "Local discovery"][index],
      difficulty: (index < 2 ? "Medium" : index === 2 ? "High" : "Low") as never,
      impact: (index < 3 ? "High" : "Medium") as never
    })),
    perception: {
      businessCategory: category,
      mainServices: classification.evidenceKeywords.length
        ? classification.evidenceKeywords.slice(0, 5)
        : [`${category} services`],
      targetAudience: [
        `${classification.subIndustry} buyers`,
        `${classification.businessModel} evaluators`,
        `${classification.industry} researchers`
      ],
      marketPositioning: [aiMarketPosition.marketPosition, "Brand visibility is evaluated from owned signals and category relevance"],
      strengths: ["Brand visibility signals were detected", "AI discovery potential exists", "Category-level opportunities are available"],
      weaknesses: publicIssueSummary(recommendations, visibilityScore).summaryMessages
    },
    sentiment: {
      value: visibilityScore >= 70 ? "Positive" : visibilityScore >= 40 ? "Neutral" : "Negative",
      explanation:
        visibilityScore >= 70
          ? "AI perception is favorable, with enough authority signals to appear in category conversations."
          : visibilityScore >= 40
            ? "Visibility appears moderate, with room to strengthen authority signals and category clarity."
            : "AI engines have weak evidence to confidently recommend the brand in commercial prompts."
    },
    risk: {
      level: riskLevel(visibilityScore),
      factors: [
        ...(classification.confidence < 55 ? ["Category clarity needs review"] : []),
        ...publicIssueSummary(recommendations, visibilityScore).summaryMessages
      ].slice(0, 4),
      businessImpact: [
        "AI systems may not confidently understand when to recommend your brand.",
        "Potential revenue loss due to AI invisibility.",
        "High-intent customers may complete research without encountering your brand."
      ]
    },
    recommendations,
    internalRecommendations: recommendations,
    shareUrl: `${origin}/report/${id}`
  };
}
