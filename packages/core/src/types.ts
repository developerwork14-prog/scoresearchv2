export type VisibilityLevel = "Critical" | "Poor" | "Below Average" | "Average" | "Strong" | "Excellent";
export type IntentType = "Commercial" | "Transactional" | "Informational" | "Comparison";
export type ImpactLevel = "High" | "Medium" | "Low";
export type Sentiment = "Positive" | "Neutral" | "Negative";
export type RiskLevel = "Low" | "Medium" | "High" | "Critical";
export type GeoAeoGrade = "A" | "B" | "C" | "D" | "F";
export type GeoAeoSeverity = "BLOCKER" | "MAJOR" | "MINOR" | "ADVISORY";
export type GeoAeoScope = "page" | "domain";

export interface ReportInput {
  brandName: string;
  websiteUrl: string;
  businessEmail: string;
  googleSearchConsole?: GoogleSearchConsoleContext;
}

export interface GoogleSearchConsoleContext {
  accessToken: string;
  siteUrl: string;
  inspectionUrl?: string;
}

export interface ScoringPillars {
  technicalFoundation: number;
  geoReadiness: number;
  aeoReadiness: number;
  brandAuthority: number;
  aiSearchVisibility: number;
}

export interface VisibilityBreakdown {
  aiDecisionCoverage: number;
  categoryVisibility: number;
  brandAuthority: number;
  entityStrength: number;
  searchReadiness: number;
}

export interface LosingPrompt {
  prompt: string;
  intentType: IntentType;
  visibility: number;
}

export interface PromptOpportunity {
  prompt: string;
  currentVisibility: number;
  potentialTrafficOpportunity: string;
  difficulty: ImpactLevel;
  impact: ImpactLevel;
}

export interface BrandPerception {
  businessCategory: string;
  mainServices: string[];
  targetAudience: string[];
  marketPositioning: string[];
  strengths: string[];
  weaknesses: string[];
}

export interface AiMarketPosition {
  industry: string;
  subIndustry: string;
  businessModel: string;
  classificationConfidence: number;
  categoryVisibility: number;
  aiPresenceLevel: VisibilityLevel;
  authorityStrength: "Low" | "Moderate" | "Strong" | "Excellent";
  marketPosition: string;
}

export type RecommendationPriority = "High Priority" | "Medium Priority" | "Low Priority";

export interface Recommendation {
  priority: RecommendationPriority;
  recommendation: string;
  reason: string;
  expectedAiVisibilityImpact: string;
}

export interface LeadGenerationMetric {
  label: "AI Decision Coverage" | "Brand Authority" | "Entity Strength" | "Search Readiness";
  score: number;
  opportunitiesIdentified: number;
  explanation: string;
  summary: string;
}

export interface VisibilityIssueSummary {
  highImpactOpportunities: number;
  mediumImpactOpportunities: number;
  lowImpactOpportunities: number;
  additionalFindingsDetected: number;
  teaserFindings: string[];
  summaryMessages: string[];
}

export type TechnicalCategoryStatus = "Passed" | "Minor Attention" | "Needs Attention" | "Skipped";

export interface TechnicalCategorySummary {
  categoryName: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningChecks: number;
  score: number;
  status: TechnicalCategoryStatus;
}

export type PublicTechnicalSeverity = "PASS" | "BLOCKER" | "MAJOR" | "MINOR" | "ADVISORY";
export type PublicTechnicalScope = "page" | "domain";

export interface PublicTechnicalCheck {
  id: number;
  category: string;
  name: string;
  weight: number;
  severity: PublicTechnicalSeverity;
  passed: boolean;
  skipped?: boolean;
  warning?: boolean;
  informational?: boolean;
  opportunity?: string;
  evidence: string;
  issueSummary?: string;
  whatIsWrong?: string;
  businessImpact?: string;
  validationSummary?: string[];
  recommendation?: string;
  recommendationDetails?: Partial<SeoIssueRecommendation>;
  scope: PublicTechnicalScope;
}

export interface GeoAeoCategorySummary {
  categoryName: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningChecks: number;
  skippedChecks: number;
  score: number;
  status: TechnicalCategoryStatus;
  failedCheckDetails?: {
    id: number;
    name: string;
    severity: GeoAeoSeverity;
    evidence: string;
    recommendation: string;
    affectedPages: number;
    sampleUrls: string[];
  }[];
  skippedCheckDetails?: {
    id: number;
    name: string;
    reason: string;
  }[];
}

export interface GeoAeoCheckResult {
  id: number;
  category: string;
  name: string;
  severity: GeoAeoSeverity;
  scope: GeoAeoScope;
  passed: boolean;
  evidence: string;
  skipped?: boolean;
  notApplicable?: boolean;
  warning?: boolean;
  priorityScore?: number;
  recommendation?: string;
  whatIsWrong?: string;
}

export interface GeoAeoOpportunityCounts {
  high: number;
  medium: number;
  low: number;
}

export interface GeoAeoAuditResult {
  score: number;
  rawScore: number;
  pageScore: number;
  domainScore: number;
  grade: GeoAeoGrade;
  gradeDescription: string;
  blockerFailed: boolean;
  opportunityCounts: GeoAeoOpportunityCounts;
  checkedAt: string;
  categories: GeoAeoCategorySummary[];
  checks: GeoAeoCheckResult[];
}

export type IndexabilitySeverity = "Critical" | "High" | "Medium" | "Low";

export interface IndexabilityCheckResult {
  id: number;
  category: string;
  name: string;
  severity: IndexabilitySeverity;
  maxScore: number;
  passed: boolean;
  skipped: boolean;
  notApplicable?: boolean;
  warning?: boolean;
  priorityScore?: number;
  recommendation?: string;
  score: number;
  evidence: Record<string, unknown>;
}

export interface IndexabilityCategorySummary {
  categoryName: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningChecks: number;
  skippedChecks: number;
  score: number;
  status: TechnicalCategoryStatus;
}

export interface IndexabilityAuditResult {
  score: number;
  checkedAt: string;
  categories: IndexabilityCategorySummary[];
  checks: IndexabilityCheckResult[];
}

export type StructuredDataSeverity = "Critical" | "High" | "Medium" | "Low" | "Advisory";

export interface StructuredDataCheckResult {
  id: number;
  category: string;
  name: string;
  severity: StructuredDataSeverity;
  weight: number;
  passed: boolean;
  skipped: boolean;
  notApplicable?: boolean;
  warning: boolean;
  informational?: boolean;
  opportunity?: string;
  score: number;
  evidence: Record<string, unknown>;
  priorityScore?: number;
  recommendation?: string;
  whatIsWrong?: string;
}

export interface StructuredDataCategorySummary {
  categoryName: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningChecks: number;
  skippedChecks: number;
  score: number;
  status: TechnicalCategoryStatus;
}

export interface StructuredDataAuditResult {
  score: number;
  checkedAt: string;
  categories: StructuredDataCategorySummary[];
  checks: StructuredDataCheckResult[];
}

export type OnPageSeoSeverity = "Critical" | "High" | "Medium" | "Low";

export interface SeoIssueRecommendation {
  issue: string;
  issueSummary: string;
  severity: string;
  priority: string;
  priorityScore?: number;
  impactLevel?: "Low" | "Medium" | "High";
  scaleLevel?: "Low" | "Medium" | "High";
  effortLevel?: "Low" | "Medium" | "High";
  affectedRate: number;
  affectedPages: string[];
  affectedAssets?: string[];
  uniqueAssetsAffected?: number;
  rootCause?: string[];
  likelyTemplates?: string[];
  estimatedFixScope?: {
    level: "Asset-level fix" | "Template-level fix" | "Infrastructure-level fix" | "Schema generator fix" | "Manual review";
    description: string;
  };
  overallAiVisibilityImpact?: {
    level: "Low" | "Moderate" | "High";
    explanation: string;
  };
  whatIsWrong: string;
  whyItMatters: string;
  businessImpact: string;
  aiVisibilityImpact: string;
  recommendedFix: string[];
  validationSummary: {
    pagesCrawled: number | null;
    pagesAnalyzed: number | null;
    pagesAffected: number;
    uniqueAssetsAffected?: number;
    affectedRate: number;
    mostCommonIssue: string;
    expectedOutcome: string;
  };
  detectionConfidence?: {
    score: number;
    reason: string;
  };
  topFixCandidates: string[];
  technicalEvidence: Record<string, unknown>;
  whatWeChecked: string[];
  rawEvidence: Record<string, unknown>;
  howToFix: string;
  bestPracticeExample: string;
  developerNotes: string;
}

export interface OnPageSeoCheckResult {
  id: number;
  category: string;
  name: string;
  severity: OnPageSeoSeverity;
  weight: number;
  passed: boolean;
  skipped: boolean;
  warning: boolean;
  informational?: boolean;
  opportunity?: string;
  score: number;
  evidence: Record<string, unknown>;
  recommendation: SeoIssueRecommendation;
}

export interface OnPageSeoCategorySummary {
  categoryName: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningChecks: number;
  skippedChecks: number;
  score: number;
  status: TechnicalCategoryStatus;
}

export interface OnPageSeoAuditResult {
  score: number;
  checkedAt: string;
  categories: OnPageSeoCategorySummary[];
  checks: OnPageSeoCheckResult[];
}

export type ImageSeoSeverity = "Critical" | "High" | "Medium" | "Low";

export interface ImageSeoCheckResult {
  id: number;
  category: string;
  name: string;
  recommendation?: SeoIssueRecommendation;
  severity: ImageSeoSeverity;
  weight: number;
  passed: boolean;
  skipped: boolean;
  warning: boolean;
  informational?: boolean;
  opportunity?: string;
  score: number;
  evidence: Record<string, unknown>;
}

export interface ImageSeoCategorySummary {
  categoryName: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningChecks: number;
  skippedChecks: number;
  score: number;
  status: TechnicalCategoryStatus;
}

export interface ImageSeoAuditResult {
  score: number;
  checkedAt: string;
  categories: ImageSeoCategorySummary[];
  checks: ImageSeoCheckResult[];
}

export type EeatSeverity = "Critical" | "High" | "Medium" | "Low";

export interface EeatCheckResult {
  id: number;
  category: string;
  name: string;
  severity: EeatSeverity;
  weight: number;
  passed: boolean;
  skipped: boolean;
  notApplicable?: boolean;
  warning: boolean;
  priorityScore?: number;
  recommendation?: string;
  score: number;
  evidence: Record<string, unknown>;
}

export interface EeatCategorySummary {
  categoryName: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningChecks: number;
  skippedChecks: number;
  score: number;
  status: TechnicalCategoryStatus;
}

export interface EeatAuditResult {
  score: number;
  checkedAt: string;
  categories: EeatCategorySummary[];
  checks: EeatCheckResult[];
}

export type TrustSignalsSeverity = "Critical" | "High" | "Medium" | "Low" | "Advisory";

export interface TrustSignalsCheckResult {
  id: number;
  category: string;
  name: string;
  severity: TrustSignalsSeverity;
  weight: number;
  passed: boolean;
  skipped: boolean;
  notApplicable?: boolean;
  warning: boolean;
  priorityScore?: number;
  recommendation?: string;
  score: number;
  evidence: Record<string, unknown>;
}

export interface TrustSignalsCategorySummary {
  categoryName: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningChecks: number;
  skippedChecks: number;
  score: number;
  status: TechnicalCategoryStatus;
}

export interface TrustSignalsAuditResult {
  score: number;
  checkedAt: string;
  categories: TrustSignalsCategorySummary[];
  checks: TrustSignalsCheckResult[];
}

export interface PublicIndexabilityAudit {
  score: number;
  checked_at?: string;
  issues_found: number;
  categories: IndexabilityCategorySummary[];
  checks: IndexabilityCheckResult[];
}

export interface PublicImageSeoAudit {
  score: number;
  checked_at?: string;
  issues_found: number;
  categories: ImageSeoCategorySummary[];
  checks: ImageSeoCheckResult[];
}

export interface PublicEeatAudit {
  score: number;
  checked_at?: string;
  issues_found: number;
  categories: EeatCategorySummary[];
  checks: EeatCheckResult[];
}

export interface PublicTrustSignalsAudit {
  score: number;
  checked_at?: string;
  issues_found: number;
  categories: TrustSignalsCategorySummary[];
  checks: TrustSignalsCheckResult[];
}

export interface PublicStructuredDataAudit {
  score: number;
  checked_at?: string;
  issues_found: number;
  categories: StructuredDataCategorySummary[];
  checks: StructuredDataCheckResult[];
}

export interface PublicOnPageSeoAudit {
  score: number;
  checked_at?: string;
  issues_found: number;
  categories: OnPageSeoCategorySummary[];
  checks: OnPageSeoCheckResult[];
}

export interface PublicGeoAeoAudit {
  score: number;
  checked_at?: string;
  grade: GeoAeoGrade;
  grade_description: string;
  page_score: number;
  domain_score: number;
  blocker_cap_applied: boolean;
  opportunity_counts: GeoAeoOpportunityCounts;
  categories: GeoAeoCategorySummary[];
  checks: GeoAeoCheckResult[];
}

export interface PublicTechnicalAudit {
  score: number;
  checked_at?: string;
  grade: GeoAeoGrade;
  issues_found: number;
  checks: PublicTechnicalCheck[];
  category_debug?: {
    category: string;
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    failedCheckDetails: {
      id: number;
      name: string;
      evidence: string;
    }[];
  }[];
}

export interface CoreWebVitalsSnapshot {
  website: string;
  performanceScore?: number;
  mobileLcp?: number;
  desktopLcp?: number;
  cls?: number;
  inp?: number;
  ttfb?: number;
  fcp?: number;
  speedIndex?: number;
  tbt?: number;
  checkedAt: string;
  source?: "PageSpeed Insights" | "Crawl Timing";
  unavailableReason?: string;
}

export interface RiskAssessment {
  level: RiskLevel;
  factors: string[];
  businessImpact: string[];
}

export interface AiVisibilityReport {
  id: string;
  createdAt: string;
  brandName: string;
  websiteUrl: string;
  businessEmail: string;
  visibilityScore: number;
  visibilityLevel: VisibilityLevel;
  pillars: ScoringPillars;
  breakdown: VisibilityBreakdown;
  leadMetrics: LeadGenerationMetric[];
  visibilityIssueSummary: VisibilityIssueSummary;
  technicalCategorySummaries: TechnicalCategorySummary[];
  technicalChecks: PublicTechnicalCheck[];
  technicalCategoryDebug?: PublicTechnicalAudit["category_debug"];
  coreWebVitals?: CoreWebVitalsSnapshot;
  geoAeoAudit: GeoAeoAuditResult;
  indexabilityAudit?: IndexabilityAuditResult;
  structuredDataAudit?: StructuredDataAuditResult;
  onPageSeoAudit?: OnPageSeoAuditResult;
  imageSeoAudit?: ImageSeoAuditResult;
  eeatAudit?: EeatAuditResult;
  trustSignalsAudit?: TrustSignalsAuditResult;
  visibilityOpportunities: string[];
  aiMarketPosition?: AiMarketPosition;
  losingPrompts: LosingPrompt[];
  opportunities: PromptOpportunity[];
  perception: BrandPerception;
  sentiment: {
    value: Sentiment;
    explanation: string;
  };
  risk: RiskAssessment;
  recommendations: Recommendation[];
  internalRecommendations?: Recommendation[];
  shareUrl: string;
}

export interface PlaygroundResult {
  prompt: string;
  answer: string;
  mentionStatus: "Mentioned" | "Not Mentioned" | "Partially Mentioned";
  confidenceScore: number;
}

export type StructuredRatingLabel = "Poor" | "Below Average" | "Average" | "Good" | "Excellent";
export type StructuredMetricCategory = "AI Visibility" | "Technical Audit" | "GEO / AEO Audit";
export type StructuredImpact = "high" | "medium" | "low";

export interface StructuredMetric {
  score: number;
  opportunities: number;
  description: string;
  detail: string;
  conflict_note?: string;
}

export interface StructuredOpportunity {
  title: string;
  category: StructuredMetricCategory;
  impact: StructuredImpact;
}

export interface StructuredAiVisibilityReport {
  id?: string;
  created_at?: string;
  brand: string;
  url: string;
  overall_score: number;
  rating_label: StructuredRatingLabel;
  rating_description: string;
  score_explanation: string;
  opportunities: StructuredOpportunity[];
  opportunity_counts: {
    high: number;
    medium: number;
    low: number;
  };
  technical_categories: TechnicalCategorySummary[];
  technical_audit: PublicTechnicalAudit;
  core_web_vitals?: CoreWebVitalsSnapshot;
  geo_aeo_audit: PublicGeoAeoAudit;
  indexability_audit: PublicIndexabilityAudit;
  structured_data_audit: PublicStructuredDataAudit;
  on_page_seo_audit: PublicOnPageSeoAudit;
  image_seo_audit: PublicImageSeoAudit;
  eeat_audit: PublicEeatAudit;
  trust_signals_audit: PublicTrustSignalsAudit;
  playground_questions: string[];
}

export interface CreatedPublicReport extends StructuredAiVisibilityReport {
  id: string;
}
