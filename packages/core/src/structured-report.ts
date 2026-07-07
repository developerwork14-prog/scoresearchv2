import {
  AiVisibilityReport,
  PublicEeatAudit,
  PublicImageSeoAudit,
  PublicIndexabilityAudit,
  PublicGeoAeoAudit,
  PublicOnPageSeoAudit,
  PublicStructuredDataAudit,
  PublicTechnicalAudit,
  PublicTrustSignalsAudit,
  StructuredAiVisibilityReport,
  StructuredImpact,
  StructuredMetricCategory,
  StructuredOpportunity,
  StructuredRatingLabel
} from "./types.js";
import { generateSeoTasks } from "./tasks/generate-seo-tasks.js";

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function ratingLabel(score: number): StructuredRatingLabel {
  if (score <= 40) return "Poor";
  if (score <= 55) return "Below Average";
  if (score <= 70) return "Average";
  if (score <= 85) return "Good";
  return "Excellent";
}

function ratingDescription(label: StructuredRatingLabel, brand: string) {
  const descriptions: Record<StructuredRatingLabel, string> = {
    Poor: `${brand} has limited visibility in AI-driven discovery and recommendation journeys.`,
    "Below Average": `${brand} has early AI visibility signals, but several growth opportunities remain.`,
    Average: `${brand} has a workable AI visibility foundation with room to improve coverage and authority.`,
    Good: `${brand} is positioned well for AI discovery, with targeted opportunities to strengthen performance.`,
    Excellent: `${brand} shows strong readiness for AI-generated recommendations and decision-making queries.`
  };
  return descriptions[label];
}

function impactFor(index: number, summary: AiVisibilityReport["visibilityIssueSummary"]): StructuredImpact {
  if (index < summary.highImpactOpportunities) return "high";
  if (index < summary.highImpactOpportunities + summary.mediumImpactOpportunities) return "medium";
  return "low";
}

function opportunityCategory(index: number): StructuredMetricCategory {
  const categories: StructuredMetricCategory[] = ["GEO / AEO Audit", "Technical Audit", "AI Visibility"];
  return categories[index % categories.length];
}

function opportunityTitle(category: StructuredMetricCategory) {
  const titles: Record<StructuredMetricCategory, string> = {
    "AI Visibility": "Improve overall AI visibility",
    "Technical Audit": "Improve technical health",
    "GEO / AEO Audit": "Increase GEO / AEO readiness"
  };
  return titles[category];
}

function previewOpportunities(report: AiVisibilityReport): StructuredOpportunity[] {
  const summary = report.visibilityIssueSummary;
  return Array.from({ length: 3 }, (_, index) => {
    const category = opportunityCategory(index);
    return {
      title: opportunityTitle(category),
      category,
      impact: impactFor(index, summary)
    };
  });
}

function playgroundCategory(report: AiVisibilityReport) {
  const category = report.perception.businessCategory;
  if (!category || category === "AI Visibility Preview" || category === "Insufficient Evidence") return "your category";
  return category.toLowerCase();
}

function auditGrade(score: number): PublicTechnicalAudit["grade"] {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function publicTechnicalAudit(report: AiVisibilityReport): PublicTechnicalAudit {
  const score = report.pillars.technicalFoundation;
  const issuesFound = (report.technicalCategorySummaries ?? []).reduce((sum, category) => sum + category.failedChecks, 0);

  return {
    score,
    checked_at: report.createdAt,
    grade: auditGrade(score),
    issues_found: issuesFound,
    checks: report.technicalChecks ?? [],
    category_debug: report.technicalCategoryDebug
  };
}

function publicGeoAeoAudit(report: AiVisibilityReport): PublicGeoAeoAudit {
  const audit = report.geoAeoAudit;
  if (!audit) {
    return {
      score: 0,
      grade: "F",
      grade_description: "Critical GEO issues",
      page_score: 0,
      domain_score: 0,
      blocker_cap_applied: false,
      opportunity_counts: { high: 0, medium: 0, low: 0 },
      categories: [],
      checks: []
    };
  }

  return {
    score: audit.score,
    checked_at: audit.checkedAt,
    grade: audit.grade,
    grade_description: audit.gradeDescription,
    page_score: audit.pageScore,
    domain_score: audit.domainScore,
    blocker_cap_applied: audit.blockerFailed && audit.score < audit.rawScore,
    opportunity_counts: audit.opportunityCounts,
    categories: audit.categories,
    checks: audit.checks
  };
}

function publicIndexabilityAudit(report: AiVisibilityReport): PublicIndexabilityAudit {
  const audit = report.indexabilityAudit;
  if (!audit) return { score: 0, issues_found: 0, categories: [], checks: [] };
  return {
    score: audit.score,
    checked_at: audit.checkedAt,
    issues_found: audit.categories.reduce((sum, category) => sum + category.failedChecks, 0),
    categories: audit.categories,
    checks: audit.checks
  };
}

function publicStructuredDataAudit(report: AiVisibilityReport): PublicStructuredDataAudit {
  const audit = report.structuredDataAudit;
  if (!audit) return { score: 0, issues_found: 0, categories: [], checks: [] };
  return {
    score: audit.score,
    checked_at: audit.checkedAt,
    issues_found: audit.categories.reduce((sum, category) => sum + category.failedChecks, 0),
    categories: audit.categories,
    checks: audit.checks
  };
}

function publicOnPageSeoAudit(report: AiVisibilityReport): PublicOnPageSeoAudit {
  const audit = report.onPageSeoAudit;
  if (!audit) return { score: 0, issues_found: 0, categories: [], checks: [] };
  return {
    score: audit.score,
    checked_at: audit.checkedAt,
    issues_found: audit.categories.reduce((sum, category) => sum + category.failedChecks, 0),
    categories: audit.categories,
    checks: audit.checks
  };
}

function publicImageSeoAudit(report: AiVisibilityReport): PublicImageSeoAudit {
  const audit = report.imageSeoAudit;
  if (!audit) return { score: 0, issues_found: 0, categories: [], checks: [] };
  return {
    score: audit.score,
    checked_at: audit.checkedAt,
    issues_found: audit.categories.reduce((sum, category) => sum + category.failedChecks, 0),
    categories: audit.categories,
    checks: audit.checks
  };
}

function publicEeatAudit(report: AiVisibilityReport): PublicEeatAudit {
  const audit = report.eeatAudit;
  if (!audit) return { score: 0, issues_found: 0, categories: [], checks: [] };
  return {
    score: audit.score,
    checked_at: audit.checkedAt,
    issues_found: audit.categories.reduce((sum, category) => sum + category.failedChecks, 0),
    categories: audit.categories,
    checks: audit.checks
  };
}

function publicTrustSignalsAudit(report: AiVisibilityReport): PublicTrustSignalsAudit {
  const audit = report.trustSignalsAudit;
  if (!audit) return { score: 0, issues_found: 0, categories: [], checks: [] };
  return {
    score: audit.score,
    checked_at: audit.checkedAt,
    issues_found: audit.categories.reduce((sum, category) => sum + category.failedChecks, 0),
    categories: audit.categories,
    checks: audit.checks
  };
}

export function toStructuredAiVisibilityReport(report: AiVisibilityReport): StructuredAiVisibilityReport {
  const technicalAudit = publicTechnicalAudit(report);
  const geoAeoAudit = publicGeoAeoAudit(report);
  const indexabilityAudit = publicIndexabilityAudit(report);
  const structuredDataAudit = publicStructuredDataAudit(report);
  const onPageSeoAudit = publicOnPageSeoAudit(report);
  const imageSeoAudit = publicImageSeoAudit(report);
  const eeatAudit = publicEeatAudit(report);
  const trustSignalsAudit = publicTrustSignalsAudit(report);
  const overallScore = clamp(technicalAudit.score * 0.4 + geoAeoAudit.score * 0.6);
  const label = ratingLabel(overallScore);
  const opportunities = previewOpportunities(report);
  const category = playgroundCategory(report);

  return {
    id: report.id,
    created_at: report.createdAt,
    brand: report.brandName,
    url: report.websiteUrl,
    overall_score: overallScore,
    rating_label: label,
    rating_description: ratingDescription(label, report.brandName),
    score_explanation:
      "The overall score is calculated from Technical Audit health (40%) and GEO / AEO readiness (60%). Scores are normalized from 0 to 100 and summarized as Poor, Below Average, Average, Good, or Excellent.",
    opportunities,
    opportunity_counts: {
      high: report.visibilityIssueSummary.highImpactOpportunities,
      medium: report.visibilityIssueSummary.mediumImpactOpportunities,
      low: report.visibilityIssueSummary.lowImpactOpportunities
    },
    technical_categories: report.technicalCategorySummaries ?? [],
    technical_audit: technicalAudit,
    core_web_vitals: report.coreWebVitals,
    geo_aeo_audit: geoAeoAudit,
    indexability_audit: indexabilityAudit,
    structured_data_audit: structuredDataAudit,
    on_page_seo_audit: onPageSeoAudit,
    image_seo_audit: imageSeoAudit,
    eeat_audit: eeatAudit,
    trust_signals_audit: trustSignalsAudit,
    seo_tasks: generateSeoTasks(report, { now: report.createdAt }),
    playground_questions: [
      `What does ${report.brandName} offer in ${category}?`,
      `Is ${report.brandName} a trusted option for ${category}?`,
      `When should someone choose ${report.brandName}?`
    ]
  };
}
