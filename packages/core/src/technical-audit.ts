import * as cheerio from "cheerio";
import tls from "node:tls";
import { crawlSite, type SiteCrawlResult } from "./site-crawler.js";
import { isLikelyDecorativeImage } from "./image-alt-utils.js";
import { scoreParameterOutcomes } from "./audit-outcome.js";
import { fetchPageSpeedInsights, pageSpeedSnapshot, type PageSpeedMetrics, type PageSpeedSnapshot } from "./pagespeed-insights.js";

export type TechnicalSeverity = "PASS" | "BLOCKER" | "MAJOR" | "MINOR" | "ADVISORY";
export type TechnicalGrade = "A" | "B" | "C" | "D" | "F";
type TechnicalScope = "page" | "domain";
type ObservedFetchStatus = number | "Timeout" | "SSL Failure" | "Redirect Loop" | "Network Failure";
export type BrokenLinkFailure = "DNS Error" | "Connection Error" | "Timeout";

export interface BrokenLinkValidation {
  url: string;
  finalUrl: string;
  finalStatus: number | BrokenLinkFailure;
  redirectHops: number;
  broken: boolean;
}

interface CrawlabilityRecommendationDetails {
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
  estimatedFixScope?: {
    level: "Asset-level fix" | "Template-level fix" | "Infrastructure-level fix" | "Manual review";
    description: string;
  };
  overallAiVisibilityImpact?: {
    level: "Low" | "Moderate" | "High";
    explanation: string;
  };
  whatIsWrong?: string;
  whyItMatters?: string;
  businessImpact?: string;
  aiVisibilityImpact?: string;
  recommendedFix?: string[];
  validationSummary?: {
    pagesCrawled: number | null;
    pagesAnalyzed: number | null;
    pagesAffected: number;
    uniqueAssetsAffected?: number;
    affectedRate: number;
    mostCommonIssue: string;
    expectedOutcome: string;
  };
  topFixCandidates?: string[];
  technicalEvidence?: Record<string, unknown>;
  whatWeChecked?: string[];
  howToFix?: string;
  bestPracticeExample?: string;
  developerNotes?: string;
}

interface CheckDefinition {
  id: number;
  category: string;
  name: string;
  weight: number;
  severity: TechnicalSeverity;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  headers: Headers;
  html: string;
  responseTimeMs: number;
  redirectHops: number;
  $: cheerio.CheerioAPI;
  wordCount: number;
}

interface MixedContentAsset {
  tag: string;
  url: string;
  pageUrl: string;
}

export interface ViewportMetaDebug {
  viewportFound: boolean;
  rawViewportTag: string;
  viewportContent: string;
  passed: boolean;
}

export interface TechnicalCheckResult extends CheckDefinition {
  passed: boolean;
  skipped?: boolean;
  informational?: boolean;
  opportunity?: string;
  warning?: boolean;
  evidence: string;
  issueSummary?: string;
  whatIsWrong?: string;
  businessImpact?: string;
  validationSummary?: string[];
  recommendation?: string;
  recommendationDetails?: CrawlabilityRecommendationDetails;
  scope: TechnicalScope;
}

export interface TechnicalCategoryDebug {
  category: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  failedCheckDetails: {
    id: number;
    name: string;
    evidence: string;
  }[];
}

export interface TechnicalAuditResult {
  score: number;
  rawScore: number;
  pageScore: number;
  domainScore: number;
  grade: TechnicalGrade;
  blockerFailed: boolean;
  checkedAt: string;
  pageSpeed?: PageSpeedSnapshot;
  checks: TechnicalCheckResult[];
  categoryDebug?: TechnicalCategoryDebug[];
}

const PERMANENT_REDIRECT_STATUSES = new Set([301, 308]);

const CHECKS: CheckDefinition[] = [
  [1, "HTTP & Server Health", "Page returns HTTP 200", 10, "BLOCKER"],
  [2, "HTTP & Server Health", "HTTPS protocol enabled", 10, "BLOCKER"],
  [3, "HTTP & Server Health", "SSL certificate valid and not expired", 8, "BLOCKER"],
  [4, "HTTP & Server Health", "HSTS header present", 4, "MINOR"],
  [5, "HTTP & Server Health", "GZIP or Brotli compression enabled", 5, "MAJOR"],
  [6, "HTTP & Server Health", "X-Robots-Tag header does NOT contain noindex", 7, "BLOCKER"],
  [7, "HTTP & Server Health", "WWW vs non-WWW redirects consistently", 5, "MAJOR"],
  [8, "HTTP & Server Health", "No mixed content on HTTPS pages", 7, "MAJOR"],
  [9, "HTTP & Server Health", "TTFB < 800ms", 6, "MAJOR"],
  [10, "Robots.txt & Sitemap", "robots.txt returns HTTP 200", 5, "MAJOR"],
  [11, "Robots.txt & Sitemap", "Sitemap declared in robots.txt", 5, "MINOR"],
  [12, "Robots.txt & Sitemap", "Declared sitemap returns HTTP 200 with XML content", 7, "MAJOR"],
  [13, "Robots.txt & Sitemap", "All sitemap URLs have lastmod element", 4, "MINOR"],
  [14, "Robots.txt & Sitemap", "No noindex pages included in sitemap", 6, "MAJOR"],
  [16, "Meta Tags", "Title tag exists and non-empty", 8, "BLOCKER"],
  [17, "Meta Tags", "Title length 30-60 characters", 0, "ADVISORY"],
  [18, "Meta Tags", "Meta description exists and non-empty", 7, "MINOR"],
  [19, "Meta Tags", "Meta description length 120-160 characters", 0, "ADVISORY"],
  [20, "Meta Tags", "Viewport meta tag present", 8, "BLOCKER"],
  [21, "Meta Tags", "No noindex in meta robots", 8, "BLOCKER"],
  [22, "Meta Tags", "Duplicate titles sitewide", 6, "MAJOR"],
  [23, "Meta Tags", "Duplicate meta descriptions sitewide", 5, "MAJOR"],
  [24, "Heading Structure", "Exactly 1 H1 per page", 7, "MAJOR"],
  [25, "Heading Structure", "H1 length 10-90 characters", 0, "ADVISORY"],
  [26, "Heading Structure", "Heading hierarchy never skips levels", 0, "ADVISORY"],
  [27, "Canonicalization", "Canonical tag exists on every page", 6, "MAJOR"],
  [28, "Canonicalization", "Canonical URL is self-referencing", 7, "BLOCKER"],
  [29, "Canonicalization", "Canonical does not point to noindex page", 7, "BLOCKER"],
  [30, "Canonicalization", "Paginated pages have rel next or prev", 4, "ADVISORY"],
  [31, "Canonicalization", "No duplicate content at slug and slug slash", 4, "MINOR"],
  [32, "Indexability & Crawlability", "Page is indexable", 8, "MAJOR"],
  [33, "Indexability & Crawlability", "No nosnippet or max-snippet:0", 7, "BLOCKER"],
  [34, "Indexability & Crawlability", "JS content rendering check", 9, "BLOCKER"],
  [35, "Indexability & Crawlability", "0 broken internal links", 7, "MAJOR"],
  [36, "Indexability & Crawlability", "Redirect chain <= 1 hop", 6, "MAJOR"],
  [37, "Indexability & Crawlability", "No important page at crawl depth > 3", 5, "MAJOR"],
  [38, "Indexability & Crawlability", "0 orphan pages detected", 5, "MAJOR"],
  [39, "Indexability & Crawlability", "No content hidden in display:none > 100w", 7, "MAJOR"],
  [40, "Indexability & Crawlability", "No infinite scroll", 4, "MINOR"],
  [41, "Indexability & Crawlability", "No cookie wall blocking DOM content", 5, "MAJOR"],
  [42, "URL Structure", "Hyphens used with no underscores", 4, "MINOR"],
  [43, "URL Structure", "URL total length <= 75 characters", 3, "ADVISORY"],
  [44, "URL Structure", "URL path all lowercase", 4, "MINOR"],
  [45, "URL Structure", "Trailing slash consistent sitewide", 4, "MINOR"],
  [46, "Core Web Vitals", "LCP < 2500ms mobile p75", 8, "MAJOR"],
  [47, "Core Web Vitals", "INP < 200ms p75", 7, "MAJOR"],
  [48, "Core Web Vitals", "CLS < 0.1 p75", 7, "MAJOR"],
  [49, "Core Web Vitals", "TTFB < 800ms", 6, "MAJOR"],
  [50, "Core Web Vitals", "All images have explicit width and height", 6, "MAJOR"],
  [51, "Core Web Vitals", "LCP hero image does not have loading lazy", 6, "BLOCKER"],
  [52, "Core Web Vitals", "All font-face use font-display swap", 4, "MINOR"],
  [53, "Core Web Vitals", "0 render-blocking scripts in head", 6, "MAJOR"],
  [54, "Core Web Vitals", "Inline critical CSS in head", 4, "MINOR"],
  [55, "Core Web Vitals", "LCP image preloaded", 5, "MINOR"],
  [56, "Core Web Vitals", "Mobile PSI score >= 60", 6, "MAJOR"],
  [57, "Core Web Vitals", "All tap targets adequate", 4, "MINOR"],
  [58, "Mobile Optimization", "Viewport meta tag correct", 8, "MAJOR"],
  [59, "Mobile Optimization", "Mobile PSI score >= 60", 6, "MAJOR"],
  [60, "Mobile Optimization", "Tap target size adequate", 4, "MINOR"],
  [61, "Image SEO", "All non-decorative images have alt text", 7, "MAJOR"],
  [62, "Image SEO", "Data/chart images have detailed alt text", 4, "ADVISORY"],
  [63, "Image SEO", "All images have explicit width and height", 6, "MAJOR"],
  [64, "Image SEO", "Below-fold images have loading lazy", 4, "MINOR"],
  [65, "Image SEO", "70 percent images are WebP or AVIF", 5, "MINOR"],
  [66, "Image SEO", "Image filenames are descriptive", 3, "ADVISORY"],
  [67, "Security & Trust Pages", "Privacy Policy page linked from footer", 5, "MINOR"],
  [68, "Security & Trust Pages", "Terms page linked from footer", 4, "MINOR"],
  [69, "Security & Trust Pages", "Contact page linked and contains NAP", 5, "MAJOR"],
  [70, "Security & Trust Pages", "About page has at least 200 words", 0, "ADVISORY"],
  [71, "Security & Trust Pages", "Cookie consent element present", 3, "MINOR"],
  [72, "Performance", "GZIP or Brotli compression on responses", 5, "MAJOR"],
  [73, "Performance", "0 render-blocking scripts in head", 6, "MAJOR"],
  [74, "Performance", "Inline critical CSS in head", 4, "MINOR"],
  [75, "Performance", "LCP image preloaded", 5, "MINOR"],
  [76, "Performance", "70 percent images in WebP or AVIF", 5, "MINOR"],
  [77, "Schema Markup", "At least 1 JSON-LD block on every page", 8, "MAJOR"],
  [78, "Schema Markup", "All JSON-LD blocks parse without error", 8, "BLOCKER"],
  [79, "Schema Markup", "All JSON-LD blocks have schema.org context", 4, "MINOR"],
  [80, "Schema Markup", "Organization schema on homepage", 7, "MAJOR"],
  [81, "Schema Markup", "Optional Organization sameAs reinforcement", 0, "ADVISORY"],
  [82, "Schema Markup", "WebSite schema with SearchAction", 4, "MINOR"],
  [83, "Schema Markup", "BreadcrumbList on interior pages", 5, "MINOR"],
  [84, "Schema Markup", "Article schema on blog posts", 6, "MAJOR"],
  [85, "Schema Markup", "FAQPage schema when FAQ section exists", 7, "MAJOR"],
  [86, "Schema Markup", "HowTo schema on step pages", 5, "MINOR"],
  [87, "Schema Markup", "LocalBusiness schema on service pages", 6, "MAJOR"],
  [88, "Schema Markup", "Person schema on author bio pages", 5, "MINOR"],
  [89, "Schema Markup", "Product schema on product pages", 6, "MAJOR"],
  [90, "Schema Markup", "Schema price matches DOM price", 8, "BLOCKER"],
  [91, "Schema Markup", "Schema validation has 0 rich result errors", 6, "MAJOR"],
  [92, "Social Metadata", "og:title present", 5, "MINOR"],
  [93, "Social Metadata", "og:description present", 4, "MINOR"],
  [94, "Social Metadata", "og:image URL returns valid image", 4, "MINOR"],
  [95, "Social Metadata", "Twitter card metadata present", 3, "ADVISORY"],
  [96, "Internal Linking", "Each page has at least 3 internal links", 4, "MINOR"],
  [97, "Internal Linking", "No generic anchor text", 5, "MINOR"],
  [98, "Internal Linking", "0 orphan pages detected", 5, "MAJOR"],
  [99, "Internal Linking", "Maximum crawl depth detected: 3", 5, "MAJOR"],
  [100, "Semantic HTML", "At least 3 semantic HTML5 elements used", 0, "ADVISORY"],
  [101, "Semantic HTML", "All tables have caption element", 0, "ADVISORY"],
  [102, "Semantic HTML", "All time tags have datetime attribute", 3, "MINOR"],
  [103, "Accessibility", "All non-decorative images have alt text", 7, "MAJOR"],
  [104, "Accessibility", "Unlabelled interactive elements have aria-label", 4, "MINOR"],
  [105, "Accessibility", "HTML lang attribute set", 3, "MINOR"],
  [106, "International SEO", "hreflang tags on multi-language pages", 5, "MAJOR"],
  [107, "Content Basics", "Word count threshold met", 5, "MAJOR"],
  [108, "Content Basics", "Published date present", 4, "MINOR"],
  [109, "Content Basics", "Modified date present", 4, "MINOR"],
  [110, "Content Basics", "Named author byline present", 5, "MINOR"],
  [111, "Content Basics", "Author linked to bio page", 4, "MINOR"],
  [112, "Content Basics", "At least 2 outbound links", 4, "MINOR"],
  [113, "Trust Signals", "Review or testimonial signals present", 4, "MINOR"],
  [114, "AI Crawl Readiness", "llms.txt present and useful", 5, "MAJOR"],
  [115, "Performance", "Compression on all text assets", 5, "MAJOR"],
  [116, "Performance", "Cache-Control configured", 5, "MAJOR"],
  [117, "Performance", "ETag or Last-Modified headers present", 3, "MINOR"],
  [118, "Performance", "CDN edge caching detected", 3, "MINOR"],
  [119, "HTTP & Server Health", "Correct Content-Type headers", 3, "MINOR"],
  [120, "External Link Trust", "No broken external links", 3, "MINOR"],
  [121, "URL Structure", "URL params stripped from internal links", 3, "MINOR"],
  [122, "Indexability & Crawlability", "Internal search blocked", 5, "MAJOR"],
  [123, "Indexability & Crawlability", "No soft-404s", 5, "MAJOR"],
  [125, "AI Crawl Readiness", "RSS feed full-text", 0, "ADVISORY"],
  [126, "Security & Spam", "No back-button hijacking", 8, "BLOCKER"],
  [127, "Security & Spam", "No exit-intent redirects", 5, "MAJOR"],
  [128, "HTTP & Server Health", "CORS on public APIs", 2, "ADVISORY"],
  [129, "HTTP & Server Health", "SSL covers discovered subdomains", 3, "MAJOR"],
  [130, "Indexability & Crawlability", "SSR contains primary content", 8, "BLOCKER"],
  [131, "Indexability & Crawlability", "No empty-shell SPA", 7, "BLOCKER"],
  [132, "Indexability & Crawlability", "No key content in accordions or tabs", 5, "MAJOR"],
  [133, "Performance", "DOM node count under 1500", 3, "MINOR"],
  [134, "Security & Spam", "No CSS-hidden keyword text", 8, "BLOCKER"],
  [135, "Schema Markup", "Server-side schema injection", 6, "BLOCKER"],
  [137, "Canonicalization", "No canonical chains", 5, "MAJOR"],
  [138, "Performance", "TTFB competitive under 200ms", 4, "MINOR"],
  [139, "HTTP & Server Health", "AI crawler accessibility", 6, "BLOCKER"],
  [140, "Indexability & Crawlability", "Headless browser content match", 4, "MAJOR"],
  [141, "Indexability & Crawlability", "IndexNow implemented", 0, "ADVISORY"],
  [142, "Canonicalization", "301 for permanent redirects", 4, "MAJOR"],
  [143, "LCP (Largest Contentful Paint)", "LCP <2500ms Mobile p75", 0, "MAJOR"],
  [144, "LCP (Largest Contentful Paint)", "LCP <1800ms Competitive", 0, "ADVISORY"],
  [145, "LCP (Largest Contentful Paint)", "LCP <2500ms Desktop", 2, "MINOR"],
  [146, "LCP (Largest Contentful Paint)", "LCP Element Identified", 2, "MINOR"],
  [147, "LCP (Largest Contentful Paint)", "LCP Preload Hint", 3, "BLOCKER"],
  [148, "LCP (Largest Contentful Paint)", "LCP Not Lazy-Loaded", 3, "BLOCKER"],
  [149, "LCP (Largest Contentful Paint)", "LCP WebP/AVIF Format", 2, "MAJOR"],
  [150, "LCP (Largest Contentful Paint)", "LCP Size <200KB", 2.5, "MAJOR"],
  [151, "LCP (Largest Contentful Paint)", "LCP Phase Breakdown", 1.5, "MINOR"],
  [152, "INP & Interactivity", "INP <200ms p75", 3, "BLOCKER"],
  [153, "INP & Interactivity", "INP <150ms Competitive", 2, "MAJOR"],
  [154, "INP & Interactivity", "Long Tasks Count", 2.5, "MAJOR"],
  [155, "INP & Interactivity", "Task Yielding Patterns", 1.5, "MINOR"],
  [156, "INP & Interactivity", "Third-Party Scripts Deferred", 2.5, "MAJOR"],
  [157, "CLS (Cumulative Layout Shift)", "CLS <0.1 p75", 3, "BLOCKER"],
  [158, "CLS (Cumulative Layout Shift)", "CLS Zero in Content Area", 2, "MINOR"],
  [159, "CLS (Cumulative Layout Shift)", "All Images width+height", 2.5, "MAJOR"],
  [160, "CLS (Cumulative Layout Shift)", "Ad Slots Reserved Space", 1.5, "MINOR"],
  [161, "CLS (Cumulative Layout Shift)", "No Dynamic Injection Above", 2, "MAJOR"],
  [162, "CLS (Cumulative Layout Shift)", "font-display:swap CLS", 1.5, "MINOR"],
  [163, "FCP (First Contentful Paint)", "FCP <1.8s Mobile", 2.5, "MAJOR"],
  [164, "FCP (First Contentful Paint)", "No Render-Blocking in <head>", 2.5, "MAJOR"],
  [165, "FCP (First Contentful Paint)", "Critical CSS Inlined", 2, "MINOR"],
  [166, "TTFB & Server Response", "TTFB <800ms", 2.5, "MAJOR"],
  [167, "TTFB & Server Response", "TTFB Consistency Low Variance", 1.5, "MINOR"],
  [168, "TTFB & Server Response", "CDN Edge Caching", 2, "MINOR"],
  [169, "PageSpeed Scores", "Mobile PSI >=60", 2.5, "MAJOR"],
  [170, "PageSpeed Scores", "Desktop PSI >=80", 2, "MINOR"],
  [171, "PageSpeed Scores", "Tap Targets >=48px", 1.5, "MINOR"],
  [172, "CLS (Cumulative Layout Shift)", "No Intrusive Interstitials", 2, "BLOCKER"],
  [173, "Asset Optimisation", "Unused JS <20%", 2, "MINOR"],
  [174, "Asset Optimisation", "Unused CSS <40%", 1.5, "MINOR"],
  [175, "Asset Optimisation", "WebP/AVIF >=70%", 2, "MINOR"],
  [176, "Asset Optimisation", "JS Bundle <500KB", 2, "MAJOR"],
  [177, "Asset Optimisation", "Image Compression Quantified", 1.5, "MINOR"],
  [178, "Asset Optimisation", "Text Compression GZIP/Brotli", 2, "MINOR"],
  [179, "INP & Interactivity", "Third-Party Impact <500ms", 2, "MAJOR"],
  [180, "FCP (First Contentful Paint)", "FCP <0.4s Optimal", 2, "MINOR"],
  [181, "Asset Optimisation", "font-display:swap All Fonts", 2, "MINOR"],
  [182, "Asset Optimisation", "Self-Hosted Fonts", 1.5, "MINOR"],
  [183, "Asset Optimisation", "Preconnect Hints", 1.5, "MINOR"],
  [184, "TTFB & Server Response", "TTFB <200ms AI Optimal", 2, "MINOR"],
  [185, "Asset Optimisation", "Below-Fold Lazy Loading", 1.5, "MINOR"],
  [186, "Asset Optimisation", "Preload Critical Resources", 1.5, "MINOR"],
  [187, "Asset Optimisation", "Total Page Weight <3MB", 2, "MAJOR"],
  [188, "INP & Interactivity", "TTI <3800ms", 2, "MAJOR"],
  [189, "PageSpeed Scores", "Speed Index <3400ms", 1.5, "MINOR"],
  [190, "INP & Interactivity", "TBT <200ms", 2.5, "MAJOR"],
  [191, "Security & HTTPS", "HTTP 200 on All Target Pages", 3.96, "BLOCKER"],
  [192, "Security & HTTPS", "HTTPS + Valid SSL Certificate", 3.38, "BLOCKER"],
  [193, "Security & HTTPS", "HSTS Header", 1.69, "MINOR"],
  [194, "Security & HTTPS", "SSL Covers All Subdomains", 1.69, "MAJOR"],
  [195, "Performance & Caching", "Compression on All Text Assets", 1.69, "MINOR"],
  [196, "Performance & Caching", "Cache-Control Configured", 1.69, "MINOR"],
  [197, "Crawl & Redirect Control", "Infinite Scroll Crawlable Pagination", 0, "ADVISORY"],
  [198, "Performance & Caching", "LCP Image Not Lazy-Loaded", 2.82, "BLOCKER"],
  [200, "Crawl & Redirect Control", "Canonical on All Indexable Pages", 2.82, "BLOCKER"],
  [201, "Crawl & Redirect Control", "Self-Referencing Canonical", 2.82, "MAJOR"],
  [202, "Crawl & Redirect Control", "Canonical Target Returns 200", 2.25, "MAJOR"],
  [203, "Crawl & Redirect Control", "Absolute HTTPS Canonical", 2.25, "MAJOR"],
  [204, "Security & HTTPS", "No Back-Button Hijacking", 2.25, "BLOCKER"],
  [205, "Security & HTTPS", "No Exit-Intent Redirects", 1.69, "MAJOR"],
  [206, "Crawl & Redirect Control", "No Noindex in Sitemap", 1.69, "MAJOR"],
  [207, "Crawl & Redirect Control", "No Soft-404s", 1.69, "MAJOR"],
  [208, "Crawl & Redirect Control", "301 for Permanent Redirects", 1.69, "MAJOR"],
  [209, "Crawl & Redirect Control", "No URL Path Case Inconsistency", 1.13, "MINOR"],
  [210, "Security & HTTPS", "No Broken External Links", 1.69, "MINOR"],
  [211, "Security & HTTPS", "No Mixed Content", 2.25, "MAJOR"],
  [212, "Performance & Caching", "GZIP/Brotli on HTML", 2.25, "MINOR"],
  [213, "Performance & Caching", "CDN Edge Caching", 2.25, "MINOR"],
  [214, "Performance & Caching", "ETag/Last-Modified Headers", 1.69, "ADVISORY"],
  [215, "Rendering & DOM", "SSR Contains Primary Content", 4.51, "BLOCKER"],
  [216, "Rendering & DOM", "No Empty-Shell SPA", 3.38, "BLOCKER"],
  [217, "Rendering & DOM", "No Key Content in Accordions/Tabs", 2.25, "MAJOR"],
  [218, "Rendering & DOM", "No Consent Wall Blocking DOM", 2.25, "BLOCKER"],
  [219, "Rendering & DOM", "DOM Node Count <1500", 1.69, "MINOR"],
  [220, "Rendering & DOM", "CSS Hidden Content <100w", 2.25, "MAJOR"],
  [221, "Rendering & DOM", "No CSS-Hidden Keyword Text", 2.25, "BLOCKER"],
  [222, "Rendering & DOM", "No Render-Blocking Scripts in <head>", 2.25, "MAJOR"],
  [223, "Rendering & DOM", "Critical CSS Inlined", 1.69, "MINOR"],
  [224, "Performance & Caching", "All Images width+height", 2.25, "MAJOR"],
  [225, "Performance & Caching", "Below-Fold Images Lazy-Loaded", 1.69, "MINOR"],
  [226, "Performance & Caching", "font-display: swap", 1.69, "MINOR"],
  [227, "Rendering & DOM", "Server-Side Schema Injection", 2.82, "BLOCKER"],
  [228, "AI Accessibility & Discoverability", "RSS Feed Full-Text", 0, "ADVISORY"],
  [229, "AI Accessibility & Discoverability", "ai.txt Exists", 0.85, "ADVISORY"],
  [230, "AI Accessibility & Discoverability", "llms.txt Present+Valid", 1.69, "MAJOR"],
  [231, "Security & HTTPS", "CORS on Public APIs", 1.13, "ADVISORY"],
  [232, "Performance & Caching", "TTFB <800ms Pass / <200ms Competitive", 2.82, "MAJOR"],
  [233, "AI Accessibility & Discoverability", "AI Crawler IP Accessibility", 2.25, "BLOCKER"],
  [234, "AI Accessibility & Discoverability", "Headless Browser Content Match", 1.69, "MAJOR"],
  [235, "AI Accessibility & Discoverability", "IndexNow Implemented", 0, "ADVISORY"],
  [236, "Crawl & Redirect Control", "Internal Search Blocked", 1.69, "MAJOR"],
  [237, "Crawl & Redirect Control", "URL Params Stripped from Internal Links", 1.69, "MINOR"],
  [238, "Security & HTTPS", "Correct Content-Type Headers", 1.13, "MINOR"],
  [239, "Content & On-Page", "No Duplicate H1 Text Across Pages", 4, "MAJOR"]
].map(([id, category, name, weight, severity]) => ({ id, category, name, weight, severity })) as CheckDefinition[];

const DUPLICATE_CHECK_IDS = new Set([
  1, 2, 3, 4, 5, 8, 9,
  27, 28, 29, 37, 38, 39, 40,
  46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
  59, 60, 63, 64, 65, 72, 73, 74, 75, 76,
  103, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 125, 126, 127, 128, 129, 130, 131,
  133, 134, 135, 136, 137, 138, 141, 142,
  148, 159, 162, 164, 165, 166, 178, 181
]);

const GENERIC_ANCHORS = new Set(["click here", "read more", "here", "learn more", "link", "this"]);
const DOMAIN_CHECK_IDS = new Set([3, 4, 7, 10, 11, 12, 13, 14, 22, 23, 35, 37, 38, 45, 56, 59, 67, 68, 69, 70, 80, 81, 83, 91, 98, 99, 106, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142]);
const SCORE_CAP_BLOCKER_IDS = new Set([
  191, // target pages do not return HTTP 200
  192, // HTTPS/TLS unavailable
  215, // primary content missing from raw HTML
  216 // empty-shell SPA
]);

type AssetKind = "html" | "css" | "js" | "json" | "xml" | "txt" | "svg" | "image" | "font" | "other";

interface AssetReference {
  url: string;
  kind: AssetKind;
}

interface AssetSample extends AssetReference {
  status: number;
  headers: Headers;
  text?: string;
}

type LabVitals = PageSpeedMetrics;

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function viewportMetaDebug($: cheerio.CheerioAPI): ViewportMetaDebug {
  const viewportTag = metaElementByName($, "viewport");
  const rawViewportTag = viewportTag ? $.html(viewportTag) : "";
  const viewportContent = viewportTag ? ($(viewportTag).attr("content") ?? "").trim() : "";
  return {
    viewportFound: Boolean(viewportTag),
    rawViewportTag,
    viewportContent,
    passed: Boolean(viewportTag && viewportContent)
  };
}

export function metaElementByName($: cheerio.CheerioAPI, name: string) {
  const expected = name.trim().toLowerCase();
  return $("meta").toArray().find((el) => ($(el).attr("name") ?? "").trim().toLowerCase() === expected);
}

export function metaContentByName($: cheerio.CheerioAPI, name: string) {
  const el = metaElementByName($, name);
  return el ? ($(el).attr("content") ?? "").trim() : "";
}

function metaContentsByNames($: cheerio.CheerioAPI, names: string[]) {
  const expected = new Set(names.map((name) => name.trim().toLowerCase()));
  return $("meta").toArray()
    .filter((el) => expected.has(($(el).attr("name") ?? "").trim().toLowerCase()))
    .map((el) => ($(el).attr("content") ?? "").trim())
    .filter(Boolean);
}

function relTokens(value: string) {
  return value.toLowerCase().split(/\s+/).filter(Boolean);
}

export function linkElementsByRel($: cheerio.CheerioAPI, rel: string) {
  const expected = rel.toLowerCase();
  return $("link").toArray().filter((el) => relTokens($(el).attr("rel") ?? "").includes(expected));
}

export function linkHrefByRel($: cheerio.CheerioAPI, rel: string) {
  const el = linkElementsByRel($, rel)[0];
  return el ? ($(el).attr("href") ?? "").trim() : "";
}

function linkAttr($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0], ...names: string[]) {
  return names.map((name) => ($(el).attr(name) ?? "").trim()).find(Boolean) ?? "";
}

export function hasImagePreloadHint($: cheerio.CheerioAPI) {
  return linkElementsByRel($, "preload").some((el) => {
    const as = ($(el).attr("as") ?? "").trim().toLowerCase();
    if (as !== "image") return false;
    return Boolean(linkAttr($, el, "href") || linkAttr($, el, "imagesrcset", "imageSrcSet"));
  });
}

export function isModernLcpImageUrl(value: string) {
  return /\.(webp|avif)(?:[?#].*)?$/i.test(value);
}

function passRate<T>(items: T[], predicate: (item: T) => boolean) {
  const total = items.length;
  const passed = items.filter(predicate).length;
  const rate = total > 0 ? passed / total : 0;
  return { passed, total, rate, percent: Math.round(rate * 100) };
}

function optimizationLengthOutcome(rate: number): { passed: boolean; severity: TechnicalSeverity; warning: boolean } {
  if (rate >= 0.8) return { passed: true, severity: "ADVISORY", warning: false };
  return { passed: false, severity: "ADVISORY", warning: true };
}

function normalizeUrl(value: string) {
  return value.startsWith("http") ? value : `https://${value}`;
}

function sameOrigin(url: URL, href: string) {
  try {
    return new URL(href, url).hostname.replace(/^www\./, "") === url.hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

function absolute(url: URL, href: string) {
  try {
    return new URL(href, url).toString();
  } catch {
    return "";
  }
}

async function fetchCrux(url: string): Promise<LabVitals | null> {
  const key = process.env.CRUX_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, formFactor: "PHONE" }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return null;
    const data = await response.json() as {
      record?: {
        metrics?: Record<string, { percentiles?: { p75?: number } }>;
      };
    };
    const metrics = data.record?.metrics ?? {};
    return {
      lcp: metrics.largest_contentful_paint?.percentiles?.p75,
      inp: metrics.interaction_to_next_paint?.percentiles?.p75,
      cls: metrics.cumulative_layout_shift?.percentiles?.p75,
      ttfb: metrics.experimental_time_to_first_byte?.percentiles?.p75,
      checkedAt: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "AIVisibilityAnalyzer/1.0", accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      ...init
    });
    const text = await response.text().catch(() => "");
    return { response, text, responseTimeMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timeout);
  }
}

function observedFetchStatus(error: unknown): ObservedFetchStatus {
  if (error instanceof DOMException && error.name === "AbortError") return "Timeout";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const cause = error instanceof Error && "cause" in error ? String((error as Error & { cause?: unknown }).cause ?? "") : "";
  const combined = `${message} ${cause}`.toLowerCase();
  if (/redirect|maximum redirects/.test(combined)) return "Redirect Loop";
  if (/ssl|tls|certificate|cert_|self[- ]signed|handshake/.test(combined)) return "SSL Failure";
  if (/abort|timeout|timed out/.test(combined)) return "Timeout";
  return "Network Failure";
}

async function fetchTextWithObservedStatus(url: string, init: RequestInit = {}, timeoutMs = 9000) {
  try {
    const result = await fetchText(url, init, timeoutMs);
    return { result, observedStatus: result.response.status as ObservedFetchStatus };
  } catch (error) {
    return { result: null, observedStatus: observedFetchStatus(error) };
  }
}

async function fetchTextWithRetryStatus(url: string, init: RequestInit = {}, timeoutMs = 2500, retryTimeoutMs = 8000) {
  const first = await fetchTextWithObservedStatus(url, init, timeoutMs);
  if (first.result || !["Timeout", "Network Failure"].includes(String(first.observedStatus))) return first;
  return fetchTextWithObservedStatus(url, init, retryTimeoutMs);
}

async function fetchPage(url: string, timeoutMs = 9000): Promise<FetchedPage> {
  const { response, text, responseTimeMs } = await fetchText(url, {}, timeoutMs);
  const $ = cheerio.load(text);
  return {
    url,
    finalUrl: response.url,
    status: response.status,
    headers: response.headers,
    html: text,
    responseTimeMs,
    redirectHops: response.redirected && response.url !== url ? 1 : 0,
    $,
    wordCount: wordCount($("body").text())
  };
}

export function excludedBrokenLinkHref(href: string) {
  const value = href.trim();
  if (!value) return true;
  if (value.startsWith("#") || /^(?:mailto|tel|javascript):/i.test(value)) return true;
  if (/\/(?:cdn-cgi|wp-admin|wp-content|wp-json)(?:\/|$)/i.test(value)) return true;
  try {
    const pathname = new URL(value, "https://audit.invalid/").pathname.toLowerCase();
    return /\/(?:cdn-cgi|wp-admin|wp-content|wp-json)(?:\/|$)/.test(pathname);
  } catch {
    return false;
  }
}

export function isBrokenLinkStatus(status: number | BrokenLinkFailure) {
  return status === "DNS Error"
    || status === "Connection Error"
    || status === "Timeout"
    || status === 404
    || status === 410
    || status === 500
    || status === 502
    || status === 503
    || status === 504;
}

export function dedupeBrokenLinkEvidence<T extends { brokenUrl: string; sourcePage: string }>(items: T[]) {
  return [...new Map(items.map((item) => [
    `${comparableCanonicalUrl(item.brokenUrl)}\n${comparableCanonicalUrl(item.sourcePage)}`,
    item
  ])).values()];
}

function brokenLinkFailure(error: unknown): BrokenLinkFailure {
  if (error instanceof DOMException && error.name === "AbortError") return "Timeout";
  const cause = error instanceof Error && "cause" in error
    ? (error as Error & { cause?: { code?: string; message?: string } }).cause
    : undefined;
  const code = String(cause?.code ?? "");
  const message = `${error instanceof Error ? error.message : String(error ?? "")} ${cause?.message ?? ""}`.toLowerCase();
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /dns|name or service not known|getaddrinfo/.test(message)) return "DNS Error";
  if (/abort|timeout|timed out/.test(message)) return "Timeout";
  return "Connection Error";
}

const BROKEN_LINK_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_BROKEN_LINK_STATUSES = new Set([500, 502, 503, 504]);

async function fetchBrokenLinkHop(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "AIVisibilityAnalyzer/1.0" }
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateBrokenLink(url: string, timeoutMs = 8000, maxRedirects = 5): Promise<BrokenLinkValidation> {
  let currentUrl = url;
  let redirectHops = 0;
  let retriedServerErrorUrl = "";
  try {
    while (true) {
      let response: Response;
      try {
        response = await fetchBrokenLinkHop(
          currentUrl,
          retriedServerErrorUrl === currentUrl ? Math.max(timeoutMs * 2, 12000) : timeoutMs
        );
      } catch {
        // A single timeout or connection reset is not sufficient evidence. Confirm it once
        // with a fresh request and a larger per-hop budget before classifying the URL.
        response = await fetchBrokenLinkHop(currentUrl, Math.max(timeoutMs * 2, 12000));
      }
      const location = response.headers.get("location");
      if (BROKEN_LINK_REDIRECT_STATUSES.has(response.status) && location && redirectHops < maxRedirects) {
        const nextUrl = new URL(location, currentUrl).toString();
        await response.body?.cancel().catch(() => undefined);
        currentUrl = nextUrl;
        redirectHops += 1;
        continue;
      }
      if (RETRYABLE_BROKEN_LINK_STATUSES.has(response.status) && retriedServerErrorUrl !== currentUrl) {
        // A single 5xx response can be caused by transient origin/CDN pressure during a
        // crawl. Confirm it with a fresh, slower request before reporting a broken URL.
        await response.body?.cancel().catch(() => undefined);
        retriedServerErrorUrl = currentUrl;
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      const finalStatus = response.status;
      const finalUrl = response.url || currentUrl;
      await response.body?.cancel().catch(() => undefined);
      return { url, finalUrl, finalStatus, redirectHops, broken: isBrokenLinkStatus(finalStatus) };
    }
  } catch (error) {
    const finalStatus = brokenLinkFailure(error);
    return { url, finalUrl: currentUrl, finalStatus, redirectHops, broken: true };
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchImageHeadOk(url: string, timeoutMs = 1800) {
  if (!url) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    return response.ok && /image/i.test(response.headers.get("content-type") ?? "");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function safeFetch(url: string, init: RequestInit = {}, timeoutMs = 2200) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { "user-agent": "AIVisibilityAnalyzer/1.0", ...(init.headers as Record<string, string> | undefined) };
  try {
    return await fetch(url, {
      redirect: "follow",
      ...init,
      signal: controller.signal,
      headers
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function safeHeadOrGet(url: string, timeoutMs = 2200, init: RequestInit = {}) {
  const head = await safeFetch(url, { ...init, method: "HEAD" }, timeoutMs);
  if (head && head.status !== 405 && head.status !== 501) return head;
  return safeFetch(url, { ...init, method: "GET" }, timeoutMs);
}

function dedupeByUrl<T extends { url: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function kindFromUrl(value: string): AssetKind {
  const path = value.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "js";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".xml") || /sitemap|feed|atom|rss/.test(path)) return "xml";
  if (path.endsWith(".txt")) return "txt";
  if (path.endsWith(".svg")) return "svg";
  if (/\.(png|jpe?g|gif|webp|avif|ico)$/i.test(path)) return "image";
  if (/\.(woff2?|ttf|otf|eot)$/i.test(path)) return "font";
  return "other";
}

function expectedKindFromContentType(contentType: string): AssetKind {
  if (/html/i.test(contentType)) return "html";
  if (/css/i.test(contentType)) return "css";
  if (/javascript|ecmascript|x-javascript/i.test(contentType)) return "js";
  if (/json/i.test(contentType)) return "json";
  if (/xml/i.test(contentType)) return "xml";
  if (/text\/plain/i.test(contentType)) return "txt";
  if (/svg/i.test(contentType)) return "svg";
  if (/image\//i.test(contentType)) return "image";
  if (/font|woff|ttf|otf/i.test(contentType)) return "font";
  return "other";
}

function isTextAsset(kind: AssetKind) {
  return kind === "html" || kind === "css" || kind === "js" || kind === "json" || kind === "xml" || kind === "txt" || kind === "svg";
}

function extractSrcsetUrls(root: URL, srcset: string) {
  return srcset.split(",").map((part) => absolute(root, part.trim().split(/\s+/)[0] ?? "")).filter(Boolean);
}

function extractAssets(page: FetchedPage, root: URL) {
  const assets: AssetReference[] = [{ url: page.finalUrl, kind: "html" }];
  const add = (href: string | undefined, forcedKind?: AssetKind) => {
    if (!href || href.startsWith("data:") || href.startsWith("blob:") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    const resolved = absolute(root, href);
    if (!resolved) return;
    assets.push({ url: resolved, kind: forcedKind ?? kindFromUrl(resolved) });
  };

  page.$("link[href]").each((_, el) => {
    const link = page.$(el);
    const rel = (link.attr("rel") ?? "").toLowerCase();
    const as = (link.attr("as") ?? "").toLowerCase();
    const href = link.attr("href");
    if (rel.includes("stylesheet")) add(href, "css");
    else if (as === "font" || rel.includes("preload") && /font/i.test(href ?? "")) add(href, "font");
    else if (as === "image" || rel.includes("icon")) add(href, "image");
    else if (/manifest|alternate/.test(rel)) add(href);
  });
  page.$("script[src]").each((_, el) => add(page.$(el).attr("src"), "js"));
  page.$("img[src],source[src],video[poster]").each((_, el) => {
    add(page.$(el).attr("src") ?? page.$(el).attr("poster"), "image");
    extractSrcsetUrls(root, page.$(el).attr("srcset") ?? "").forEach((src) => assets.push({ url: src, kind: "image" }));
  });

  return dedupeByUrl(assets);
}

async function sampleAssets(assets: AssetReference[], limit = 24, includeBody = false, init: RequestInit = {}): Promise<AssetSample[]> {
  const sampled = dedupeByUrl(assets).slice(0, limit);
  const samples = await Promise.all(sampled.map(async (asset): Promise<AssetSample | null> => {
    const response = includeBody
      ? await safeFetch(asset.url, { ...init, method: "GET" }, 2400)
      : await safeHeadOrGet(asset.url, 2200, init);
    if (!response) return null;
    const contentType = response.headers.get("content-type") ?? "";
    const kind = asset.kind === "other" ? expectedKindFromContentType(contentType) : asset.kind;
    const text = includeBody && isTextAsset(kind) ? await response.text().catch(() => "") : undefined;
    const sample: AssetSample = { ...asset, kind, status: response.status, headers: response.headers };
    if (text !== undefined) sample.text = text;
    return sample;
  }));
  return samples.filter((item): item is AssetSample => item !== null);
}

function appropriateCacheControl(asset: AssetSample) {
  const cacheControl = asset.headers.get("cache-control")?.toLowerCase() ?? "";
  if (!cacheControl) return false;
  if (asset.kind === "html") return /no-cache|max-age=0|must-revalidate/.test(cacheControl) || Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? 999999) <= 3600;
  return /max-age=\d+/.test(cacheControl);
}

function contentTypeMatches(asset: AssetSample) {
  const contentType = asset.headers.get("content-type") ?? "";
  if (asset.kind === "html") return /text\/html|application\/xhtml\+xml/i.test(contentType);
  if (asset.kind === "css") return /text\/css/i.test(contentType);
  if (asset.kind === "js") return /javascript|ecmascript|text\/plain/i.test(contentType);
  if (asset.kind === "xml") return /xml|text\/plain/i.test(contentType);
  if (asset.kind === "json") return /json|text\/plain/i.test(contentType);
  if (asset.kind === "txt") return /text\/plain/i.test(contentType);
  if (asset.kind === "svg") return /image\/svg\+xml|xml|text\/plain/i.test(contentType);
  if (asset.kind === "image") return /image\//i.test(contentType);
  if (asset.kind === "font") return /font|woff|ttf|otf|octet-stream/i.test(contentType);
  return true;
}

function contentLengthBytes(headers: Headers) {
  const value = Number(headers.get("content-length") ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function cdnSignal(headers: Headers) {
  const headerNames = ["cf-cache-status", "x-cache", "x-vercel-cache", "x-nextjs-cache", "x-served-by", "x-cache-hits", "age", "via"];
  for (const name of headerNames) {
    const value = headers.get(name);
    if (value) return `${name}: ${value}`;
  }
  const server = headers.get("server") ?? "";
  if (/cloudflare|akamai|fastly|cloudfront|vercel|netlify/i.test(server)) return `server: ${server}`;
  return "";
}

function extractExternalLinks(page: FetchedPage, root: URL) {
  return dedupeByUrl(page.$("a[href]").toArray().map((el) => ({
    rawHref: page.$(el).attr("href") ?? "",
    url: absolute(root, page.$(el).attr("href") ?? ""),
    pageUrl: page.finalUrl
  })).filter((link) => !excludedBrokenLinkHref(link.rawHref) && link.url.startsWith("http") && !sameOrigin(root, link.url)));
}

function findTrackingInternalLinks(links: { href: string }[]) {
  const trackingParams = new Set(["utm_source", "utm_medium", "utm_campaign", "gclid", "fbclid", "msclkid"]);
  return links.filter((link) => {
    try {
      const parsed = new URL(link.href);
      return [...trackingParams].some((param) => parsed.searchParams.has(param));
    } catch {
      return false;
    }
  });
}

function robotsBlocksInternalSearch(robotsText: string) {
  return /^disallow:\s*(\/search\/?|\/?\?s=|\*?\?s=)/im.test(robotsText);
}

function internalSearchLinks(links: { href: string }[]) {
  return links.filter((link) => {
    try {
      const parsed = new URL(link.href);
      return /\/search\/?$/i.test(parsed.pathname) || parsed.searchParams.has("s") || parsed.searchParams.has("q") && /search/i.test(parsed.pathname);
    } catch {
      return false;
    }
  });
}

function llmsStats(text: string) {
  const words = wordCount(text);
  const sections = (text.match(/^#{1,3}\s+\S.+$/gm) ?? []).length + (text.match(/https?:\/\/\S+/g) ?? []).length;
  const strongSignals = (text.match(/\b(brand|services?|pages?|contact|about|pricing|products?)\b/gi) ?? []).length;
  return { words, sections, strongSignals };
}

function suspiciousHistoryPattern(scriptText: string) {
  const patterns = [
    /popstate[\s\S]{0,180}(location\.(href|assign|replace)|window\.location|document\.location)/i,
    /onpopstate[\s\S]{0,180}(location\.(href|assign|replace)|window\.location|document\.location)/i,
    /(pushState|replaceState)[\s\S]{0,120}(setInterval|while\s*\(|for\s*\()/i,
    /(setInterval|while\s*\(|for\s*\()[\s\S]{0,120}(pushState|replaceState)/i
  ];
  return patterns.find((pattern) => pattern.test(scriptText))?.source ?? "";
}

function exitIntentRedirectPattern(scriptText: string) {
  const patterns = [
    /(?:mouseleave|mouseout)[\s\S]{0,220}(location\.(href|assign|replace)|window\.location|document\.location)/i,
    /(?:beforeunload|unload)[\s\S]{0,220}(location\.(href|assign|replace)|window\.location|document\.location)/i
  ];
  return patterns.find((pattern) => pattern.test(scriptText))?.source ?? "";
}

function publicApiUrls(page: FetchedPage, root: URL) {
  const urls = new Set<string>();
  const scan = (value: string) => {
    const matches = value.match(/["'(](\/(?:api|wp-json|graphql)[^"'()\s]*)/gi) ?? [];
    matches.forEach((match) => urls.add(absolute(root, match.replace(/^["'(]/, ""))));
  };
  page.$("a[href],script[src]").each((_, el) => {
    const value = page.$(el).attr("href") ?? page.$(el).attr("src") ?? "";
    if (/\/(api|wp-json|graphql)(\/|$|\?)/i.test(value)) urls.add(absolute(root, value));
  });
  scan(page.html);
  return [...urls].filter(Boolean).slice(0, 8);
}

async function sslValid(url: URL) {
  if (url.protocol !== "https:") return false;
  return new Promise<boolean>((resolve) => {
    const socket = tls.connect({ host: url.hostname, port: 443, servername: url.hostname, timeout: 2500 }, () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert.valid_to ? Date.parse(cert.valid_to) : 0;
      socket.end();
      resolve(Boolean(cert.subject) && validTo > Date.now());
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function discoveredSubdomains(pages: FetchedPage[], root: URL) {
  const rootHost = root.hostname.replace(/^www\./, "");
  const hosts = new Set<string>();
  pages.forEach((p) => {
    p.$("[href],[src]").each((_, el) => {
      const value = p.$(el).attr("href") ?? p.$(el).attr("src") ?? "";
      const resolved = absolute(new URL(p.finalUrl), value);
      if (!resolved) return;
      const host = new URL(resolved).hostname.replace(/^www\./, "");
      if (host !== rootHost && host.endsWith(`.${rootHost}`)) hosts.add(host);
    });
  });
  return [...hosts].slice(0, 6);
}

function visiblePrimaryWordCount(page: FetchedPage) {
  const clone = cheerio.load(page.html);
  clone("script,style,noscript,template,svg").remove();
  clone("[hidden],[aria-hidden='true'],[style*='display:none'],[style*='display: none'],[style*='visibility:hidden'],[style*='visibility: hidden']").remove();
  return wordCount(clone("main").text() || clone("body").text());
}

function emptyShellEvidence(page: FetchedPage) {
  const body = page.$("body");
  const rootShells = body.find("#root,#__next,#app,[data-reactroot]").length;
  const meaningfulElements = body.find("h1,h2,p,article,section,main,li").length;
  const scripts = body.find("script[src]").length + page.$("head script[src]").length;
  const words = visiblePrimaryWordCount(page);
  const isShell = words < 80 && rootShells > 0 && scripts >= meaningfulElements;
  return { isShell, evidence: `${words} visible words, ${rootShells} app roots, ${scripts} scripts` };
}

function accordionHiddenWords(page: FetchedPage) {
  const selectors = [
    "[aria-expanded='false']",
    "[role='tabpanel'][hidden]",
    "[role='tablist'] ~ [hidden]",
    "details:not([open])",
    "[class*='accordion'][style*='display:none']",
    "[class*='tab'][style*='display:none']",
    "[class*='collapse'][style*='display:none']"
  ].join(",");
  return page.$(selectors).toArray().reduce((sum, el) => sum + wordCount(page.$(el).text()), 0);
}

function collapsedPrimaryContentEvidence(page: FetchedPage) {
  const hiddenWords = accordionHiddenWords(page);
  const visibleWords = visiblePrimaryWordCount(page);
  const primaryOnlyCollapsed = hiddenWords >= 100 && visibleWords < 80;
  const hiddenSample = page.$([
    "[role='tabpanel'][hidden]",
    "[role='tablist'] ~ [hidden]",
    "details:not([open])",
    "[class*='accordion'][style*='display:none']",
    "[class*='tab'][style*='display:none']",
    "[class*='collapse'][style*='display:none']"
  ].join(",")).first().text().replace(/\s+/g, " ").trim().slice(0, 180);
  return { pageUrl: page.finalUrl, hiddenWords, visibleWords, primaryOnlyCollapsed, hiddenSample };
}

async function renderedDomWordCount(url: string, timeoutMs = 8000) {
  if (process.env.AIVA_ENABLE_RENDERED_AUDIT !== "true") {
    return { words: null as number | null, error: "Rendered browser audit disabled" };
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Rendered browser audit timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    const work = (async () => {
      const loadPuppeteer = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{
        default: {
          launch(options: { args: string[]; headless: "new" }): Promise<{
            newPage(): Promise<{
              goto(url: string, options: { waitUntil: "networkidle2"; timeout: number }): Promise<unknown>;
              content(): Promise<string>;
            }>;
            close(): Promise<void>;
          }>;
        };
      }>;
      const puppeteer = await loadPuppeteer("puppeteer");
      const browser = await puppeteer.default.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      });
      try {
        const browserPage = await browser.newPage();
        await browserPage.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
        const renderedHtml = await browserPage.content();
        return { words: wordCount(cheerio.load(renderedHtml)("body").text()) };
      } finally {
        await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 1000))]);
      }
    })();
    return await Promise.race([work, timeoutPromise]);
  } catch (error) {
    return { words: null as number | null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function cssHiddenKeywordText(page: FetchedPage) {
  const suspiciousWords = /\b(best|cheap|top|near me|casino|loan|viagra|crypto|forex|escort|betting)\b/i;
  const hiddenSelectors = [
    "[style*='display:none']",
    "[style*='display: none']",
    "[style*='visibility:hidden']",
    "[style*='visibility: hidden']",
    "[style*='opacity:0']",
    "[style*='opacity: 0']",
    "[style*='font-size:0']",
    "[style*='font-size: 0']",
    "[style*='text-indent:-']",
    "[style*='position:absolute'][style*='left:-']"
  ].join(",");
  const matches = page.$(hiddenSelectors).toArray().filter((el) => suspiciousWords.test(page.$(el).text()));
  return matches.length;
}

function schemaInjectionEvidence(page: FetchedPage) {
  const rawJsonLdCount = page.$("script[type='application/ld+json']").length;
  const gtmHints = /googletagmanager|GTM-|dataLayer\.push|schema\.org[\s\S]{0,120}dataLayer/i.test(page.html);
  return {
    passed: rawJsonLdCount > 0 || !gtmHints,
    evidence: rawJsonLdCount > 0 ? `${rawJsonLdCount} JSON-LD blocks in raw HTML` : gtmHints ? "Schema/GTM hints found without raw JSON-LD" : "No schema injection hint detected"
  };
}

function comparableCanonicalUrl(value: string) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

export function isPermanentRedirectStatus(status?: number) {
  return PERMANENT_REDIRECT_STATUSES.has(status ?? 0);
}

function oppositeTrailingSlashUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.pathname === "/") return "";
  parsed.pathname = parsed.pathname.endsWith("/")
    ? parsed.pathname.replace(/\/+$/, "")
    : `${parsed.pathname}/`;
  return parsed.toString();
}

async function trailingSlashVariantRedirect(url: string, timeoutMs = 1800) {
  const variantUrl = oppositeTrailingSlashUrl(url);
  if (!variantUrl) {
    return {
      url,
      variantUrl: "",
      status: 0,
      location: "",
      targetUrl: "",
      passed: true,
      reason: "Root URL has no opposite trailing-slash variant"
    };
  }

  const response = await safeFetch(variantUrl, { method: "GET", redirect: "manual" }, timeoutMs);
  const status = response?.status ?? 0;
  const location = response?.headers.get("location") ?? "";
  const targetUrl = location ? new URL(location, variantUrl).toString() : "";
  const passed = isPermanentRedirectStatus(status) && comparableCanonicalUrl(targetUrl) === comparableCanonicalUrl(url);

  return {
    url,
    variantUrl,
    status,
    location,
    targetUrl,
    passed,
    reason: passed
      ? `Opposite variant returns permanent redirect ${status} to canonical URL`
      : `Opposite variant status ${status || "missing"}${targetUrl ? ` to ${targetUrl}` : ""}`
  };
}

function contentSimilarity(leftHtml: string, rightHtml: string) {
  const normalize = (html: string) => cheerio.load(html)("body").text().toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N}\s]/gu, "").trim();
  const leftWords = new Set(normalize(leftHtml).split(/\s+/).filter((word) => word.length > 2));
  const rightWords = new Set(normalize(rightHtml).split(/\s+/).filter((word) => word.length > 2));
  if (!leftWords.size || !rightWords.size) return 0;
  const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
  return overlap / Math.min(leftWords.size, rightWords.size);
}

function infiniteScrollAuditEvidence(pages: FetchedPage[]) {
  const signalPatterns = [
    { label: "IntersectionObserver", pattern: /IntersectionObserver/i },
    { label: "scroll autoload handler", pattern: /addEventListener\(\s*["']scroll["']|onscroll\s*=|\.on\(\s*["']scroll["']/i },
    { label: "infinite scroll library", pattern: /infinite[-_\s]?scroll|endless[-_\s]?scroll|jscroll|ias\.|infiniteScroll\(/i },
    { label: "AJAX load-more pagination", pattern: /load[-_\s]?more|data-(?:next|page|pagination)|ajax(?:url|load|pagination)|fetch\([^)]*(?:page|offset|cursor)|XMLHttpRequest/i },
    { label: "auto-loading content on scroll", pattern: /(?:scroll|viewport)[\s\S]{0,160}(?:appendChild|insertAdjacentHTML|loadMore|nextPage|page\s*\+\+|offset\s*\+=|cursor)/i }
  ];
  const paginationSelector = [
    "a[href*='page=']",
    "a[href*='?p=']",
    "a[href*='/page/']",
    "a[rel='next']",
    "a[rel='prev']",
    "link[rel='next']",
    "link[rel='prev']",
    ".pagination a[href]",
    "[class*='pagination'] a[href]",
    "nav[aria-label*='pagination' i] a[href]"
  ].join(",");
  const pageResults = pages.map((page) => {
    const signals = signalPatterns.filter((item) => item.pattern.test(page.html)).map((item) => item.label);
    const paginationLinks = page.$(paginationSelector).length;
    return { url: page.finalUrl, signals: [...new Set(signals)], paginationLinks };
  }).filter((item) => item.signals.length > 0);
  const detected = pageResults.length > 0;
  const pagesWithPagination = pageResults.filter((item) => item.paginationLinks > 0).length;
  const pass = !detected || pagesWithPagination === pageResults.length;
  const signalSummary = [...new Set(pageResults.flatMap((item) => item.signals))].join(", ");
  return {
    detected,
    pass,
    pageResults,
    evidence: !detected
      ? "N/A - no infinite-scroll or auto-loading content behavior detected"
      : `${pagesWithPagination}/${pageResults.length} infinite-scroll pages expose crawlable pagination links${signalSummary ? `; signals: ${signalSummary}` : ""}`
  };
}

async function canonicalChainLength(startUrl: string, timeoutMs = 2200) {
  const seen = new Set<string>();
  let current = startUrl;
  let hops = 0;
  for (let i = 0; i < 3; i += 1) {
    if (seen.has(current)) return { hops: hops + 1, loop: true };
    seen.add(current);
    const nextPage = await fetchPage(current, timeoutMs).catch(() => null);
    const nextCanonical = nextPage ? linkHrefByRel(nextPage.$, "canonical") : "";
    const resolved = nextCanonical && nextPage ? absolute(new URL(nextPage.finalUrl), nextCanonical) : "";
    if (!resolved || resolved === current) return { hops, loop: false };
    hops += 1;
    current = resolved;
  }
  return { hops, loop: false };
}

async function fetchWithUserAgent(url: string, userAgent: string, timeoutMs = 2200) {
  return fetchText(url, { headers: { "user-agent": userAgent } }, timeoutMs).catch(() => null);
}

async function redirectStatus(url: string, timeoutMs = 1800) {
  const response = await safeFetch(url, { method: "GET", redirect: "manual" }, timeoutMs);
  return response?.status ?? 0;
}

function indexNowCandidateUrls(origin: string, robotsText: string, html: string) {
  const urls = new Set<string>();
  const keyLocation = robotsText.match(/^key-location:\s*(.+)$/im)?.[1]?.trim();
  if (keyLocation) urls.add(keyLocation.startsWith("http") ? keyLocation : `${origin}${keyLocation.startsWith("/") ? "" : "/"}${keyLocation}`);
  const explicit = html.match(/https?:\/\/[^"'\s]+\/[a-f0-9-]{8,}\.txt/gi) ?? [];
  explicit.forEach((item) => urls.add(item));
  return [...urls].slice(0, 4);
}

function robotsContentAllowsIndex(page: FetchedPage) {
  const header = page.headers.get("x-robots-tag")?.toLowerCase() ?? "";
  const meta = metaContentsByNames(page.$, ["robots", "googlebot", "bingbot"]).join(",").toLowerCase();
  return !`${header} ${meta}`.includes("noindex");
}

function metaRobots(page: FetchedPage) {
  return metaContentsByNames(page.$, ["robots", "googlebot", "bingbot"]).join(",").toLowerCase();
}

function jsonLd(page: FetchedPage) {
  const blocks: unknown[] = [];
  const errors: string[] = [];
  page.$("script[type='application/ld+json']").each((_, el) => {
    const text = page.$(el).text().trim();
    if (!text) return;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Invalid JSON-LD");
    }
  });
  return { blocks, errors };
}

function schemaTypes(blocks: unknown[]): string[] {
  const out: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    const type = obj["@type"];
    if (typeof type === "string") out.push(type);
    if (Array.isArray(type)) out.push(...type.filter((item): item is string => typeof item === "string"));
    Object.values(obj).forEach((child) => {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    });
  };
  blocks.forEach(visit);
  return out;
}

function hasSchemaType(blocks: unknown[], matcher: RegExp) {
  return schemaTypes(blocks).some((type) => matcher.test(type));
}

function visibleFaqSignals(page: FetchedPage) {
  const $ = page.$;
  const roots = $("main,article").length ? $("main,article") : $("body");
  const scopedRoots = roots.toArray().filter((element) => $(element).closest("footer,nav,header,aside").length === 0);
  const rootText = scopedRoots.map((element) => $(element).text()).join(" ").replace(/\s+/g, " ");
  const hasFaqHeading = /\b(faqs?|frequently asked questions)\b/i.test(rootText);
  const containers = roots.find("details,.faq,[id*='faq' i],[class*='faq' i],[aria-label*='faq' i],[data-state],[aria-expanded]").filter((_, element) =>
    $(element).closest("footer,nav,header,aside").length === 0
  );
  const questionPattern = /\?|^(?:what|how|why|when|where|who|which|can|does|do|is|are|will|should)\b/i;
  const detailsQuestions = containers.filter("details").toArray().filter((element) => {
    const node = $(element);
    const question = node.find("summary").text().trim();
    return questionPattern.test(question) && node.text().replace(question, "").trim().length > 0;
  }).length;
  const questionElements = roots.find("summary,button,h2,h3,h4,[class*='question' i],[aria-controls]").toArray()
    .filter((element) => $(element).closest("footer,nav,header,aside").length === 0)
    .filter((element) => questionPattern.test($(element).text().trim())).length;
  const questionTextMatches = (rootText.match(/\b(?:what|how|why|when|where|who|which|can|does|do|is|are|will|should)\b[^?]{8,140}\?/gi) ?? []).length;
  const questions = detailsQuestions + questionElements + questionTextMatches;
  return {
    containers: containers.length,
    questions,
    hasFaqHeading,
    applicable: (hasFaqHeading && questions >= 1) || (containers.length > 0 && questions >= 1) || questionTextMatches >= 3
  };
}

function firstImage(page: FetchedPage) {
  return page.$("main img, img").first();
}

function imageStats(page: FetchedPage) {
  const images = page.$("img").toArray();
  const count = images.length;
  const nonDecorative = images.filter((el) => !isLikelyDecorativeImage(page.$, el));
  const missingAlt = nonDecorative.filter((el) => !(page.$(el).attr("alt") ?? "").trim()).length;
  const missingDimensions = images.filter((el) => !page.$(el).attr("width") || !page.$(el).attr("height")).length;
  const modern = images.filter((el) => /\.(webp|avif)(\?|$)/i.test(page.$(el).attr("src") ?? "")).length;
  const generic = images.filter((el) => {
    const src = page.$(el).attr("src") ?? "";
    const filename = src.split(/[?#]/)[0].split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") ?? "";
    return /^(img|image|photo|pic|screenshot)[-_]?\d+$/i.test(filename);
  }).length;
  const chartImages = images.filter((el) => /chart|graph|infographic|data/i.test(page.$(el).attr("src") ?? ""));
  const chartDetailedAlt = chartImages.filter((el) => {
    const alt = page.$(el).attr("alt") ?? "";
    return wordCount(alt) >= 8 || alt.trim().length >= 40;
  }).length;
  const belowFold = images.slice(2);
  const belowFoldLazy = belowFold.filter((el) => page.$(el).attr("loading")?.toLowerCase() === "lazy").length;
  return {
    count,
    nonDecorativeCount: nonDecorative.length,
    altPresent: nonDecorative.length - missingAlt,
    missingAlt,
    dimensionsPresent: count - missingDimensions,
    missingDimensions,
    modern,
    modernRatio: count ? modern / count : 1,
    generic,
    chartCount: chartImages.length,
    chartDetailedAlt,
    belowFoldCount: belowFold.length,
    belowFoldLazy
  };
}

function imageUrl(page: FetchedPage, el: Parameters<cheerio.CheerioAPI>[0]) {
  return absolute(new URL(page.finalUrl), page.$(el).attr("src") || page.$(el).attr("data-src") || "");
}

function imageIssueSamples(pages: FetchedPage[], predicate: (page: FetchedPage, el: Parameters<cheerio.CheerioAPI>[0], index: number) => boolean) {
  return pages.flatMap((page) =>
    page.$("img").toArray()
      .map((el, index) => ({ pageUrl: page.finalUrl, imageUrl: imageUrl(page, el), index }))
      .filter((item) => {
        const el = page.$("img").toArray()[item.index];
        return el ? predicate(page, el, item.index) : false;
      })
      .map(({ pageUrl, imageUrl }) => ({ pageUrl, imageUrl: imageUrl || "inline image" }))
  ).slice(0, 10);
}

function aggregateImageStats(stats: ReturnType<typeof imageStats>[]) {
  const sum = (key: keyof ReturnType<typeof imageStats>) => stats.reduce((total, item) => total + Number(item[key]), 0);
  const count = sum("count");
  const nonDecorativeCount = sum("nonDecorativeCount");
  const altPresent = sum("altPresent");
  const dimensionsPresent = sum("dimensionsPresent");
  const modern = sum("modern");
  const generic = sum("generic");
  const chartCount = sum("chartCount");
  const chartDetailedAlt = sum("chartDetailedAlt");
  const belowFoldCount = sum("belowFoldCount");
  const belowFoldLazy = sum("belowFoldLazy");
  return {
    count,
    nonDecorativeCount,
    altPresent,
    altRate: nonDecorativeCount ? altPresent / nonDecorativeCount : 1,
    dimensionsPresent,
    dimensionsRate: count ? dimensionsPresent / count : 1,
    modern,
    modernRate: count ? modern / count : 1,
    generic,
    genericRate: count ? generic / count : 0,
    chartCount,
    chartDetailedAlt,
    chartDetailedRate: chartCount ? chartDetailedAlt / chartCount : 1,
    belowFoldCount,
    belowFoldLazy,
    belowFoldLazyRate: belowFoldCount ? belowFoldLazy / belowFoldCount : 1
  };
}

function interactiveLabelStats(page: FetchedPage) {
  const controls = page.$("button,input,select,textarea,[role='button'],[role='link'],[role='checkbox'],[role='switch'],[role='combobox'],[role='textbox']").toArray()
    .filter((el) => {
      const item = page.$(el);
      const type = (item.attr("type") ?? "").toLowerCase();
      return !item.is("[hidden],[aria-hidden='true'],[disabled]") && type !== "hidden" && item.css("display") !== "none";
    });
  const labelled = controls.filter((el) => {
    const item = page.$(el);
    const id = item.attr("id");
    const hasLabelElement = Boolean(id && page.$(`label[for='${id}']`).length);
    return Boolean(item.text().trim() || item.attr("aria-label") || item.attr("aria-labelledby") || item.attr("placeholder") || item.attr("title") || hasLabelElement);
  }).length;
  return { total: controls.length, labelled };
}

function internalLinks(page: FetchedPage, root: URL) {
  return page.$("a[href]").toArray().map((el) => {
    const rawHref = page.$(el).attr("href") ?? "";
    return {
    rawHref,
    href: absolute(root, rawHref),
    text: page.$(el).text().trim().toLowerCase()
  };
  }).filter((link) => !excludedBrokenLinkHref(link.rawHref) && link.href && sameOrigin(root, link.href));
}

function footerLink(page: FetchedPage, pattern: RegExp) {
  return page.$("footer a[href]").toArray().map((el) => ({
    href: page.$(el).attr("href") ?? "",
    text: page.$(el).text()
  })).find((link) => pattern.test(link.href) || pattern.test(link.text));
}

function checkScope(id: number): TechnicalScope {
  return DOMAIN_CHECK_IDS.has(id) ? "domain" : "page";
}

function numberFromEvidence(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function statusLabel(value: unknown) {
  return typeof value === "number" ? String(value) : String(value ?? "Unavailable");
}

function brokenLinkRootCause(evidence: Record<string, unknown>) {
  const grouped = Array.isArray(evidence.brokenUrlGroups) ? evidence.brokenUrlGroups as Record<string, unknown>[] : [];
  const samples = Array.isArray(evidence.sampleEvidence) ? evidence.sampleEvidence as Record<string, unknown>[] : [];
  const locations = grouped.flatMap((group) => Array.isArray(group.locations) ? group.locations : [])
    .concat(samples.map((sample) => sample.location))
    .map((item) => String(item ?? "").toLowerCase());
  if (locations.some((location) => location.includes("shared navigation"))) return "Shared navigation menu";
  if (locations.some((location) => location.includes("footer"))) return "Shared footer link";
  return "Page content internal link";
}

function brokenUrlGroupsFromEvidence(evidence: Record<string, unknown>) {
  const groups = Array.isArray(evidence.brokenUrlGroups)
    ? evidence.brokenUrlGroups as Record<string, unknown>[]
    : Array.isArray(evidence.sampleEvidence)
      ? evidence.sampleEvidence as Record<string, unknown>[]
      : [];
  const seen = new Set<string>();
  return groups.flatMap((group) => {
    const brokenUrl = String(group.brokenUrl ?? "").trim();
    if (!brokenUrl) return [];
    const normalized = comparableCanonicalUrl(brokenUrl);
    if (seen.has(normalized)) return [];
    seen.add(normalized);
    return [{ ...group, brokenUrl }];
  });
}

function brokenUrlSampleLines(evidence: Record<string, unknown>, uniqueBrokenUrls: number, limit = 5) {
  if (!Number.isFinite(uniqueBrokenUrls) || uniqueBrokenUrls <= 1) return [];
  const groups = brokenUrlGroupsFromEvidence(evidence).slice(0, limit);
  const lines = groups.map((group, index) => `Broken URL Sample ${index + 1}: ${String(group.brokenUrl)}`);
  const remaining = uniqueBrokenUrls - groups.length;
  if (remaining > 0) lines.push(`Additional broken URLs not shown: ${remaining}`);
  return lines;
}

function sourceTemplateLabel(rootCause: string) {
  const normalized = rootCause.toLowerCase();
  if (normalized.includes("shared navigation")) return "Shared Navigation Template";
  if (normalized.includes("footer")) return "Shared Footer Template";
  return "";
}

function robotsTxtUrlFromEvidence(sample: Record<string, unknown>) {
  const robotsUrl = String(sample.robotsUrl ?? "").trim();
  if (robotsUrl) return robotsUrl;
  const requestedUrl = String(sample.requestedUrl ?? "").trim();
  try {
    const parsed = new URL(requestedUrl);
    return `${parsed.origin}/robots.txt`;
  } catch {
    return requestedUrl.endsWith("/robots.txt") ? requestedUrl : "";
  }
}

function lcpEvidenceRecord(evidence: string) {
  const parsed = evidenceRecord(evidence);
  const sample = Array.isArray(parsed.sampleEvidence) ? parsed.sampleEvidence[0] : undefined;
  if (typeof sample === "string") {
    try {
      const sampleRecord = JSON.parse(sample) as unknown;
      if (sampleRecord && typeof sampleRecord === "object" && !Array.isArray(sampleRecord)) {
        return { ...parsed, ...(sampleRecord as Record<string, unknown>) };
      }
    } catch {
      return parsed;
    }
  }
  if (sample && typeof sample === "object" && !Array.isArray(sample)) {
    return { ...parsed, ...(sample as Record<string, unknown>) };
  }
  return parsed;
}

function priorityFromTechnicalSeverity(severity: TechnicalSeverity) {
  if (severity === "BLOCKER") return { severity: "High", priority: "High Priority", priorityScore: 86, impactLevel: "High" as const };
  if (severity === "MAJOR") return { severity: "Medium", priority: "Medium Priority", priorityScore: 68, impactLevel: "Medium" as const };
  if (severity === "MINOR") return { severity: "Low", priority: "Low Priority", priorityScore: 45, impactLevel: "Low" as const };
  return { severity: "Low", priority: "Low Priority", priorityScore: 20, impactLevel: "Low" as const };
}

function lcpRecommendationDetails(id: number, evidence: string, definedSeverity: TechnicalSeverity): CrawlabilityRecommendationDetails | undefined {
  const parsed = lcpEvidenceRecord(evidence);
  const measuredValue = Number(parsed.measuredValue);
  const threshold = Number(parsed.threshold);
  const unit = String(parsed.unit ?? "ms");
  const metric = String(parsed.metric ?? "LCP");
  const lcpCandidate = String(parsed.lcpCandidate ?? "").trim() || undefined;
  const affectedPages = Array.isArray(parsed.affectedPages)
    ? (parsed.affectedPages as Record<string, unknown>[]).map((page) => String(page.url ?? "")).filter(Boolean)
    : [];

  if (id === 143 || id === 144 || id === 145) {
    const competitive = id === 144;
    const desktop = id === 145;
    const priority = priorityFromTechnicalSeverity(definedSeverity);
    const target = Number.isFinite(threshold) ? threshold : competitive ? 1800 : 2500;
    const measured = Number.isFinite(measuredValue) ? Math.round(measuredValue) : undefined;
    const measuredLabel = measured !== undefined ? `${measured}${unit}` : "unavailable";
    const targetLabel = `${target}${unit}`;
    return {
      issueSummary: `${metric} is ${measuredLabel}, above the ${targetLabel} target.`,
      whatIsWrong: `${desktop ? "Desktop" : "Mobile"} LCP is slower than the required threshold. The largest above-the-fold element is taking too long to render.`,
      severity: priority.severity,
      priority: priority.priority,
      priorityScore: priority.priorityScore,
      impactLevel: priority.impactLevel,
      scaleLevel: "High",
      effortLevel: "Medium",
      affectedRate: 100,
      affectedPages,
      rootCause: [
        "The largest above-the-fold content is not rendering within the LCP target.",
        "Common causes include slow server response, render-blocking CSS or JavaScript, delayed hero image discovery, or an oversized hero asset."
      ],
      estimatedFixScope: {
        level: "Template-level fix",
        description: "Optimize the homepage hero/template path that controls above-the-fold content and critical asset loading."
      },
      overallAiVisibilityImpact: {
        level: competitive ? "Moderate" : "High",
        explanation: "Slow first-viewport rendering can reduce engagement and weaken page experience signals for discovery traffic."
      },
      whyItMatters: "LCP measures when the main above-the-fold content becomes visible. Users often abandon pages that keep the primary content waiting.",
      businessImpact: "A slow first impression can reduce conversions, lead quality, and organic landing-page performance.",
      aiVisibilityImpact: "Fast, readable pages are easier for users and crawlers to evaluate after discovery.",
      recommendedFix: competitive ? [
        "Target the exact LCP element from PageSpeed and make it load within 1.8 seconds.",
        "Inline or preload only critical above-the-fold CSS and defer non-critical scripts below the hero.",
        "Serve the hero/LCP asset from a compressed modern format with explicit dimensions and high-priority loading."
      ] : [
        "Identify the PageSpeed LCP element and prioritize that asset or text block first.",
        "Reduce server response time and remove render-blocking CSS or JavaScript from the first viewport.",
        "Preload the LCP image or critical font only when it is the confirmed above-the-fold bottleneck."
      ],
      validationSummary: {
        pagesCrawled: null,
        pagesAnalyzed: 1,
        pagesAffected: 1,
        affectedRate: 100,
        mostCommonIssue: `${metric} measured ${measuredLabel}; target is under ${targetLabel}.`,
        expectedOutcome: `${metric} is below ${targetLabel} on the affected page.`
      },
      technicalEvidence: parsed,
      whatWeChecked: [
        `Metric: ${metric}`,
        `Measured value: ${measuredLabel}`,
        `Required threshold: <${targetLabel}`,
        "Source: PageSpeed Insights or CrUX performance data"
      ],
      developerNotes: "Re-run PageSpeed after each change and compare the LCP element, TTFB, load delay, render delay, and resource load duration."
    };
  }

  if (id === 149) {
    return {
      issueSummary: lcpCandidate
        ? `The LCP candidate is not served as WebP or AVIF: ${lcpCandidate}`
        : "The likely LCP image is not served in a modern compressed format.",
      whatIsWrong: "The image selected as the likely LCP candidate does not use WebP or AVIF, so the browser may download more bytes before the hero content can render.",
      severity: "Medium",
      priority: "Medium Priority",
      priorityScore: 64,
      impactLevel: "Medium",
      scaleLevel: "Low",
      effortLevel: "Low",
      affectedRate: 100,
      affectedPages,
      affectedAssets: lcpCandidate ? [lcpCandidate] : undefined,
      uniqueAssetsAffected: lcpCandidate ? 1 : undefined,
      rootCause: ["The above-the-fold image candidate is using a legacy or unrecognized image format."],
      estimatedFixScope: {
        level: "Asset-level fix",
        description: "Convert the LCP image asset and update the image markup/preload reference that serves it."
      },
      overallAiVisibilityImpact: {
        level: "Moderate",
        explanation: "A heavier hero image can delay the first meaningful view of the page and hurt landing-page engagement."
      },
      whyItMatters: "Modern image formats usually deliver the same visual quality with fewer bytes, which helps the LCP element appear sooner.",
      businessImpact: "A heavy hero image can make the page feel slow before users see the main offer or content.",
      aiVisibilityImpact: "Improved first-viewport performance supports stronger user experience after AI or search discovery.",
      recommendedFix: [
        "Convert the LCP image to AVIF or WebP and keep a fallback only if needed.",
        "Update the hero image srcset or picture sources to serve the modern file first.",
        "Make the preload href match the final modern LCP image URL."
      ],
      validationSummary: {
        pagesCrawled: null,
        pagesAnalyzed: 1,
        pagesAffected: 1,
        uniqueAssetsAffected: lcpCandidate ? 1 : undefined,
        affectedRate: 100,
        mostCommonIssue: lcpCandidate ? `LCP candidate uses a non-modern format: ${lcpCandidate}` : "LCP candidate is not confirmed as WebP or AVIF.",
        expectedOutcome: "The confirmed LCP image is served as AVIF or WebP and still matches the preload hint."
      },
      topFixCandidates: lcpCandidate ? [lcpCandidate] : undefined,
      technicalEvidence: parsed,
      whatWeChecked: [
        lcpCandidate ? `LCP candidate: ${lcpCandidate}` : "LCP candidate: unavailable",
        "Expected format: WebP or AVIF",
        "Also verify: matching preload URL, explicit dimensions, and no lazy loading on the LCP image."
      ],
      bestPracticeExample: "Use a picture element or srcset that offers AVIF/WebP first, with the same optimized URL referenced by the LCP preload."
    };
  }

  return undefined;
}

function crawlabilityRecommendationDetails(id: number, passed: boolean, evidence: string, definedSeverity: TechnicalSeverity): CrawlabilityRecommendationDetails | undefined {
  if (passed) return undefined;
  const lcpDetails = lcpRecommendationDetails(id, evidence, definedSeverity);
  if (lcpDetails) return lcpDetails;
  if (![10, 11, 12, 35, 81].includes(id)) return undefined;
  const parsed = evidenceRecord(evidence);
  const sample = evidenceSample(evidence);
  const pagesCrawled = Number(parsed.pagesCrawled);
  const pagesChecked = Number(parsed.pagesChecked);
  const pagesFailed = Number(parsed.pagesFailed);
  const affectedRate = Number(parsed.passRate);
  const affectedPages = Array.isArray(parsed.affectedPages)
    ? (parsed.affectedPages as Record<string, unknown>[]).map((page) => String(page.url ?? "")).filter(Boolean)
    : [];
  const baseValidation = {
    pagesCrawled: Number.isFinite(pagesCrawled) ? pagesCrawled : null,
    pagesAnalyzed: Number.isFinite(pagesChecked) ? pagesChecked : null,
    pagesAffected: Number.isFinite(pagesFailed) ? pagesFailed : 0,
    affectedRate: Number.isFinite(affectedRate) ? Number((100 - affectedRate).toFixed(1)) : 0
  };

  if (id === 81) {
    return {
      issueSummary: "Optional entity reinforcement is available when verified official profiles exist.",
      whatIsWrong: "Organization sameAs is absent. This property is helpful for entity reinforcement, but it is not mandatory.",
      severity: "Advisory",
      priority: "Low Priority",
      priorityScore: 15,
      impactLevel: "Low",
      scaleLevel: "Low",
      effortLevel: "Low",
      affectedRate: baseValidation.affectedRate,
      affectedPages,
      rootCause: ["No verified official profile links are currently represented in Organization sameAs."],
      estimatedFixScope: {
        level: "Template-level fix",
        description: "Update the Organization schema generator only if verified official profiles are available."
      },
      overallAiVisibilityImpact: {
        level: "Low",
        explanation: "Verified sameAs links can reinforce entity confidence, but their absence does not invalidate Organization schema."
      },
      whyItMatters: "Verified official profile links can help disambiguate the organization.",
      businessImpact: "This is an optional entity-confidence enhancement, not a rich-result requirement.",
      aiVisibilityImpact: "Verified profiles may modestly reinforce entity confidence.",
      recommendedFix: [
        "Optional entity reinforcement: add official sameAs links when verified profiles exist.",
        "Do not create Wikidata, Crunchbase, LinkedIn, or social profiles only to satisfy this check."
      ],
      validationSummary: {
        ...baseValidation,
        mostCommonIssue: "Organization schema has no verified sameAs links.",
        expectedOutcome: "Verified official profiles are linked when they genuinely exist."
      },
      topFixCandidates: affectedPages.slice(0, 3),
      technicalEvidence: parsed,
      whatWeChecked: [
        `Pages analyzed: ${baseValidation.pagesAnalyzed ?? "Unavailable"}`,
        `Pages affected: ${baseValidation.pagesAffected}`,
        "Requirement level: Optional advisory",
        "Expected outcome: verified official profiles are linked when available."
      ]
    };
  }

  if (id === 10) {
    const requestedUrl = String(sample.requestedUrl ?? "Unavailable");
    const observed = statusLabel(sample.status ?? sample.observed);
    return {
      issueSummary: technicalFailureDescription(id, evidence),
      whatIsWrong: technicalFailureDescription(id, evidence),
      severity: "High",
      priority: "High Priority",
      priorityScore: 90,
      impactLevel: "High",
      scaleLevel: "High",
      effortLevel: "Medium",
      affectedRate: 100,
      affectedPages,
      rootCause: ["Server configuration or WAF restriction"],
      estimatedFixScope: {
        level: "Infrastructure-level fix",
        description: "Review server, CDN, firewall, or WAF rules controlling robots.txt access."
      },
      overallAiVisibilityImpact: {
        level: "High",
        explanation: "AI crawlers may be unable to discover or access content."
      },
      businessImpact: technicalBusinessImpact(id) ?? "",
      aiVisibilityImpact: "AI crawlers may be unable to discover or access content.",
      whyItMatters: "robots.txt controls crawler access instructions and should be reliably available.",
      recommendedFix: [
        "Allow public GET access to robots.txt.",
        "Return HTTP 200 for the robots.txt URL.",
        "Review server, CDN, and WAF rules if the file is blocked."
      ],
      validationSummary: {
        ...baseValidation,
        mostCommonIssue: `robots.txt returned ${/^\d+$/.test(observed) ? `HTTP ${observed}` : observed}.`,
        expectedOutcome: "robots.txt returns HTTP 200."
      },
      topFixCandidates: [requestedUrl],
      technicalEvidence: parsed,
      whatWeChecked: [
        `robots.txt: robots.txt returned ${/^\d+$/.test(observed) ? `HTTP ${observed}` : observed}.`,
        `Requested URL: ${requestedUrl}`,
        `Observed Status: ${observed}`,
        "Expected Status: 200"
      ]
    };
  }

  if (id === 11) {
    const directive = String(sample.directive ?? "").trim();
    const robotsUrl = robotsTxtUrlFromEvidence(sample);
    return {
      issueSummary: technicalFailureDescription(id, evidence),
      whatIsWrong: technicalFailureDescription(id, evidence),
      severity: "Medium",
      priority: "Medium Priority",
      priorityScore: 65,
      impactLevel: "Medium",
      scaleLevel: "High",
      effortLevel: "Low",
      affectedRate: 100,
      affectedPages,
      rootCause: ["robots.txt missing Sitemap directive"],
      estimatedFixScope: {
        level: "Infrastructure-level fix",
        description: "Update robots.txt to include the preferred XML sitemap URL."
      },
      overallAiVisibilityImpact: {
        level: "Moderate",
        explanation: "Content discovery may be less efficient."
      },
      businessImpact: technicalBusinessImpact(id) ?? "",
      aiVisibilityImpact: "Content discovery may be less efficient.",
      whyItMatters: "The Sitemap directive helps crawlers discover the preferred XML sitemap.",
      recommendedFix: [
        "Add a Sitemap directive to robots.txt.",
        "Point it to the canonical XML sitemap URL.",
        "Confirm the declared sitemap returns HTTP 200."
      ],
      validationSummary: {
        ...baseValidation,
        mostCommonIssue: directive ? `Sitemap directive is not reachable: ${directive}` : "Sitemap directive missing from robots.txt.",
        expectedOutcome: "robots.txt includes a reachable Sitemap directive."
      },
      topFixCandidates: [robotsUrl].filter(Boolean),
      technicalEvidence: parsed,
      whatWeChecked: [
        directive ? `Sitemap: Sitemap directive is not reachable: ${directive}` : "Sitemap: Sitemap directive missing from robots.txt.",
        `Requested URL: ${String(sample.requestedUrl ?? "Unavailable")}`,
        `Observed Status: ${directive ? statusLabel(sample.status) : "Sitemap directive missing"}`,
        "Expected Status: 200"
      ]
    };
  }

  if (id === 12) {
    const observed = statusLabel(sample.observed ?? sample.status);
    const robotsUrl = robotsTxtUrlFromEvidence(sample);
    return {
      issueSummary: technicalFailureDescription(id, evidence),
      whatIsWrong: technicalFailureDescription(id, evidence),
      severity: "High",
      priority: "High Priority",
      priorityScore: 82,
      impactLevel: "High",
      scaleLevel: "High",
      effortLevel: "Medium",
      affectedRate: 100,
      affectedPages,
      rootCause: ["Server configuration or sitemap routing issue"],
      estimatedFixScope: {
        level: "Infrastructure-level fix",
        description: "Restore the XML sitemap endpoint and verify it returns XML with HTTP 200."
      },
      overallAiVisibilityImpact: {
        level: "Moderate",
        explanation: "Content discovery may be less efficient."
      },
      businessImpact: technicalBusinessImpact(id) ?? "",
      aiVisibilityImpact: "Content discovery may be less efficient.",
      whyItMatters: "A reachable XML sitemap improves discovery and recrawling of important URLs.",
      recommendedFix: [
        "Restore the XML sitemap URL.",
        "Return HTTP 200 with XML content.",
        "Remove redirects, blocking rules, or plugin settings that make the sitemap unavailable."
      ],
      validationSummary: {
        ...baseValidation,
        mostCommonIssue: `Sitemap returned ${/^\d+$/.test(observed) ? `HTTP ${observed}` : observed}.`,
        expectedOutcome: "The declared XML sitemap returns HTTP 200 with XML content."
      },
      topFixCandidates: [robotsUrl].filter(Boolean),
      technicalEvidence: parsed,
      whatWeChecked: [
        `Sitemap: Sitemap returned ${/^\d+$/.test(observed) ? `HTTP ${observed}` : observed}.`,
        `Requested URL: ${String(sample.requestedUrl ?? "Unavailable")}`,
        `Observed Status: ${observed}`,
        "Expected Status: 200"
      ]
    };
  }

  const uniqueBrokenUrls = numberFromEvidence(parsed.uniqueBrokenUrls ?? parsed.brokenLinks);
  const affected = numberFromEvidence(parsed.pagesFailed);
  const rootCause = brokenLinkRootCause(parsed);
  const sampleBrokenUrl = String(sample.brokenUrl ?? "Unavailable");
  const affectedPageCount = numberFromEvidence(parsed.pagesFailed ?? sample.affectedPages);
  const sampleLocation = String((Array.isArray(sample.locations) ? sample.locations[0] : sample.location) ?? "page content");
  const brokenUrlSamples = brokenUrlSampleLines(parsed, uniqueBrokenUrls);
  const templateCandidate = sourceTemplateLabel(rootCause);
  const sourcePageCandidates = affectedPages.slice(0, templateCandidate ? 2 : 3);
  const topFixCandidates = [...sourcePageCandidates, templateCandidate].filter(Boolean).slice(0, 3);
  return {
    issueSummary: `${uniqueBrokenUrls} unique broken internal URL${uniqueBrokenUrls === 1 ? "" : "s"} detected across ${affected} affected page${affected === 1 ? "" : "s"}.`,
    whatIsWrong: technicalFailureDescription(id, evidence),
    severity: "Medium",
    priority: "Medium Priority",
    priorityScore: 58,
    impactLevel: "Low",
    scaleLevel: affected > 10 ? "High" : affected > 1 ? "Medium" : "Low",
    effortLevel: rootCause.includes("Shared") ? "Low" : "Medium",
    affectedRate: Number.isFinite(affectedRate) ? Number((100 - affectedRate).toFixed(1)) : 0,
    affectedPages,
    uniqueAssetsAffected: uniqueBrokenUrls,
    rootCause: [rootCause],
    estimatedFixScope: {
      level: rootCause.includes("Shared") ? "Template-level fix" : "Manual review",
      description: rootCause.includes("Shared")
        ? "Fix the shared component once to remove the repeated broken link across affected pages."
        : "Update or remove the broken internal link where it appears."
    },
    overallAiVisibilityImpact: {
      level: "Low",
      explanation: "Broken links primarily affect crawl efficiency and navigation. AI visibility impact is indirect."
    },
    businessImpact: technicalBusinessImpact(id) ?? "",
    aiVisibilityImpact: "Broken links primarily affect crawl efficiency and navigation. AI visibility impact is indirect.",
    whyItMatters: "Broken internal links create dead ends for crawlers and users, especially when repeated in shared navigation.",
    recommendedFix: [
      "Update the broken internal URL to a working destination.",
      "Fix the shared navigation component if the same URL appears site-wide.",
      "Re-crawl the affected pages to confirm the link no longer fails."
    ],
    validationSummary: {
      ...baseValidation,
      uniqueAssetsAffected: uniqueBrokenUrls,
      mostCommonIssue: `Broken link to ${sampleBrokenUrl} found in ${sampleLocation}.`,
      expectedOutcome: "All internal links resolve to reachable pages."
    },
    topFixCandidates,
    technicalEvidence: parsed,
    whatWeChecked: [
      `Broken Links: Broken link to ${sampleBrokenUrl} found in ${sampleLocation}.`,
      `Unique Broken URLs: ${uniqueBrokenUrls}`,
      ...brokenUrlSamples,
      `Affected Pages: ${affectedPageCount || affected}`,
      `Root Cause: ${rootCause}`
    ]
  };
}

function pass(def: CheckDefinition, passed: boolean, evidence: string, warning = false, skipped = false): TechnicalCheckResult {
  return {
    ...def,
    passed: skipped ? true : passed,
    skipped: skipped || undefined,
    warning: !skipped && (warning || undefined),
    ...(!skipped && !passed && def.severity === "ADVISORY" ? {
      informational: true,
      opportunity: crawlabilityRecommendation(def.id)
    } : {}),
    evidence,
    issueSummary: skipped ? undefined : technicalIssueSummary(def.id, passed, evidence),
    whatIsWrong: skipped || passed ? undefined : technicalFailureDescription(def.id, evidence),
    businessImpact: skipped || passed ? undefined : technicalBusinessImpact(def.id),
    validationSummary: skipped ? undefined : technicalValidationSummary(def.id, passed, evidence),
    recommendation: skipped || passed ? undefined : crawlabilityRecommendation(def.id),
    recommendationDetails: skipped ? undefined : crawlabilityRecommendationDetails(def.id, passed, evidence, def.severity),
    scope: checkScope(def.id)
  };
}

const TECHNICAL_RECOMMENDATIONS: Record<number, string> = {
  10: "Allow public access to robots.txt and return HTTP 200.",
  11: "Add a valid Sitemap directive to robots.txt and ensure the declared sitemap URL is publicly reachable.",
  12: "Return the declared XML sitemap with HTTP 200 and a valid XML response.",
  13: "Add accurate lastmod values to sitemap entries when reliable modification dates are available.",
  14: "Remove noindex or otherwise non-indexable URLs from the XML sitemap.",
  32: "Remove unintended noindex directives and crawl blocks from pages that should appear in search.",
  33: "Remove nosnippet or max-snippet:0 from pages whose content should be eligible for search and AI summaries.",
  34: "Render primary page content in the initial HTML instead of requiring client-side JavaScript.",
  35: "Update each broken internal link to a working destination or remove the link when no replacement exists.",
  36: "Point internal links directly to the final URL and reduce redirect chains to one hop or fewer.",
  37: "Add contextual internal links from high-authority pages so important URLs are reachable within three clicks.",
  38: "Link orphaned pages from relevant navigation, category, hub, or contextual content pages.",
  39: "Keep primary content visible in rendered HTML; reserve display:none for non-essential interface states.",
  40: "Provide crawlable paginated URLs and standard anchor links alongside infinite-scroll behavior.",
  41: "Ensure consent controls do not prevent crawlers or users from accessing the primary page content.",
  96: "Add at least three relevant, crawlable internal links to pages with insufficient internal connectivity.",
  97: "Replace generic anchors with concise text that describes the destination page.",
  98: "Add crawlable links to orphaned pages from relevant site sections.",
  99: "Improve internal linking so important pages are reachable within three crawl levels.",
  114: "Publish a useful llms.txt file with concise links to authoritative brand and content resources.",
  122: "Block low-value internal search result URLs in robots.txt and avoid linking to indexable search-result pages.",
  123: "Return HTTP 404 or 410 for missing URLs instead of serving an error-like page with HTTP 200.",
  125: "Expose complete article content in the RSS or Atom feed when feed discovery is part of the publishing workflow.",
  130: "Server-render the primary content so it is present in the initial HTML response.",
  131: "Return meaningful server-rendered page content instead of an empty application shell.",
  132: "Ensure critical content is present in rendered HTML and accessible without interaction.",
  140: "Align rendered and raw HTML content so crawlers receive the same primary information as users.",
  141: "Optional enhancement: implement IndexNow only when the CMS or publishing workflow can submit changed URLs reliably.",
  217: "Ensure critical content is present in rendered HTML and accessible without interaction."
};

function evidenceSample(evidence: string) {
  try {
    const parsed = JSON.parse(evidence) as Record<string, unknown>;
    const sample = Array.isArray(parsed.sampleEvidence) ? parsed.sampleEvidence[0] : undefined;
    return sample && typeof sample === "object" ? sample as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function evidenceRecord(evidence: string) {
  try {
    const parsed = JSON.parse(evidence) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function crawlabilityRecommendation(id: number) {
  return TECHNICAL_RECOMMENDATIONS[id];
}

export function robotsTxtStatusPass(status?: number) {
  return status !== undefined && status !== 403 && status !== 404 && status < 500;
}

export function sitemapDirectivePass(directive: string, status?: number) {
  return Boolean(validSitemapDirectiveUrl(directive)) && status === 200;
}

export function sitemapDirectivesFromRobots(robotsText: string) {
  return [...robotsText.matchAll(/^sitemap:\s*(.+)$/gim)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
}

function validSitemapDirectiveUrl(directive: string) {
  try {
    const parsed = new URL(directive.trim());
    return /^https?:$/.test(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function technicalIssueSummary(id: number, passed: boolean, evidence: string) {
  if (id === 10) return passed ? "robots.txt is publicly available." : technicalFailureDescription(id, evidence);
  if (id === 11) return passed ? "A reachable Sitemap directive was found." : technicalFailureDescription(id, evidence);
  if (id === 12) return passed ? "The XML sitemap is publicly available." : technicalFailureDescription(id, evidence);
  if (id === 140 || id === 234) return passed ? "Rendered content matches the raw HTML." : "Rendered content differs significantly from raw HTML.";
  if (id !== 35) return undefined;
  if (passed) return "No broken internal links found.";
  const parsed = evidenceRecord(evidence);
  const count = Number(parsed.uniqueBrokenUrls ?? parsed.brokenLinks);
  const brokenLinks = Number.isFinite(count)
    ? Math.max(0, Math.floor(count))
    : Array.isArray(parsed.sampleEvidence) ? parsed.sampleEvidence.length : 0;
  const affectedPages = Number(parsed.pagesFailed);
  return `${brokenLinks} unique broken internal URL${brokenLinks === 1 ? "" : "s"} detected${Number.isFinite(affectedPages) ? ` across ${affectedPages} affected page${affectedPages === 1 ? "" : "s"}` : ""}.`;
}

export function technicalBusinessImpact(id: number) {
  const impacts: Record<number, string> = {
    10: "Crawler access risk: search engines may be unable to retrieve crawl instructions reliably.",
    11: "URL discovery risk: search engines may not discover the preferred XML sitemap from robots.txt.",
    12: "URL discovery risk: an unavailable or invalid sitemap can delay discovery and recrawling of important pages.",
    14: "Indexation efficiency risk: sitemap URLs that cannot be indexed waste crawl attention and weaken sitemap quality signals.",
    35: "Broken links create dead-end user journeys, waste crawl activity, and interrupt internal authority flow.",
    36: "Redirect chains waste crawl resources, slow navigation, and dilute internal linking efficiency.",
    37: "Excessive crawl depth can delay discovery and reduce the internal authority reaching important pages.",
    38: "Orphan pages may remain undiscovered by crawlers and users because no internal navigation path reaches them.",
    40: "Content available only through infinite scroll may be missed by crawlers and become difficult for users to navigate.",
    41: "Consent barriers can prevent crawlers and users from accessing primary content.",
    130: "Search engines may index less content than users see when primary content is absent from the initial HTML.",
    131: "Empty application shells can leave search engines with insufficient content to index.",
    132: "Critical content hidden behind interaction may receive weaker crawl, indexing, and engagement signals.",
    140: "Search engines may index less content than users see when key content loads only after JavaScript execution.",
    217: "Critical content hidden behind interaction may receive weaker crawl, indexing, and engagement signals.",
    234: "Search engines may index less content than users see when key content loads only after JavaScript execution."
  };
  return impacts[id];
}

export function technicalValidationSummary(id: number, passed: boolean, evidence: string) {
  const parsed = evidenceRecord(evidence);
  const sample = evidenceSample(evidence);
  const pagesCrawled = Number(parsed.pagesCrawled);
  const pagesChecked = Number(parsed.pagesChecked);
  const pagesFailed = Number(parsed.pagesFailed);
  const lines = [
    `Pages crawled: ${Number.isFinite(pagesCrawled) ? pagesCrawled : "Unavailable"}`,
    `Pages analyzed: ${Number.isFinite(pagesChecked) ? pagesChecked : "Unavailable"}`,
    `Pages affected: ${Number.isFinite(pagesFailed) ? pagesFailed : passed ? 0 : "Unavailable"}`
  ];
  if (id === 10 || id === 11 || id === 12) {
    lines.push(`Requested URL: ${String(sample.requestedUrl ?? "Unavailable")}`);
    lines.push(`Observed Status: ${String(sample.status ?? sample.observed ?? "Unavailable").replace(/^HTTP\s+/i, "")}`);
    lines.push(`Expected Status: ${String(sample.expected ?? "200").replace(/^HTTP\s+/i, "")}`);
  }
  if (id === 35) {
    const uniqueBrokenUrls = Number(parsed.uniqueBrokenUrls ?? parsed.brokenLinks);
    const affectedPages = Number(parsed.pagesFailed ?? sample.affectedPages);
    const rootCause = brokenLinkRootCause(parsed);
    const brokenUrl = String(sample.brokenUrl ?? "Unavailable");
    lines.push(`Unique Broken URLs: ${Number.isFinite(uniqueBrokenUrls) ? uniqueBrokenUrls : "Unavailable"}`);
    lines.push(...brokenUrlSampleLines(parsed, uniqueBrokenUrls));
    lines.push(`Affected Pages: ${Number.isFinite(affectedPages) ? affectedPages : "Unavailable"}`);
    lines.push(`Root Cause: ${rootCause}`);
    lines.push(`Broken Links: Broken link to ${brokenUrl} found in ${String((Array.isArray(sample.locations) ? sample.locations[0] : sample.location) ?? "page content")}.`);
  }
  if (id === 140 || id === 234) {
    lines.push(`Raw HTML: ${String(sample.rawHtmlWords ?? "Unavailable")} words`);
    lines.push(`Rendered DOM: ${String(sample.renderedDomWords ?? "Unavailable")} words`);
    lines.push(`Content difference: ${String(sample.differencePercent ?? "Unavailable")}%`);
    lines.push(`Reason: ${String(sample.reason ?? "Rendered and raw content differ beyond the accepted threshold.")}`);
  }
  if (typeof parsed.metric === "string" && parsed.measuredValue !== undefined && parsed.threshold !== undefined) {
    lines.push(`${parsed.metric}: ${String(parsed.measuredValue)}${String(parsed.unit ?? "")}`);
    lines.push(`Threshold: ${String(parsed.metric).startsWith("CLS") ? "<" : "<"}${String(parsed.threshold)}${String(parsed.unit ?? "")}`);
    lines.push(`Result: ${passed ? "Passed" : "Failed"}`);
  }
  if (id === 78 || id === 91) {
    const errors = Array.isArray(parsed.parseErrors)
      ? parsed.parseErrors
      : Array.isArray(parsed.validationFailures)
        ? parsed.validationFailures
        : [];
    errors.slice(0, 3).forEach((item) => {
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        lines.push(`Schema error: ${String(record.error ?? "Unknown validation error")}${record.url ? ` — ${String(record.url)}` : ""}`);
      }
    });
  }
  const failure = technicalFailureDescription(id, evidence);
  lines.push(`Most common issue: ${passed ? technicalIssueSummary(id, true, evidence) ?? "No failure detected." : failure}`);
  return lines;
}

export function technicalFailureDescription(id: number, evidence: string) {
  const sample = evidenceSample(evidence);
  if (id === 10) {
    const status = sample.status ?? sample.observed ?? "Unavailable";
    return typeof status === "number" ? `robots.txt returned HTTP ${status}.` : `robots.txt failed: ${status}.`;
  }
  if (id === 11) {
    const directive = String(sample.directive ?? "").trim();
    const expectedDirective = String(sample.expectedDirective ?? "").trim();
    const malformed = sample.malformed === true;
    return directive
      ? malformed
        ? `The detected Sitemap directive is malformed: ${directive}`
        : `The detected Sitemap directive is unreachable: ${directive}`
      : `Sitemap directive missing.${expectedDirective ? ` Expected: Sitemap: ${expectedDirective}` : ""}`;
  }
  if (id === 12) {
    const requestedUrl = String(sample.requestedUrl ?? "the declared sitemap");
    const observed = String(sample.observed ?? sample.status ?? "Unavailable");
    return `${requestedUrl} returned ${/^\d+$/.test(observed) ? `HTTP ${observed}` : observed}; expected HTTP 200 with XML content.`;
  }
  if (id === 35) {
    const brokenUrl = String(sample.brokenUrl ?? "");
    const sourcePage = String(sample.sourcePage ?? "");
    const location = String(sample.location ?? (Array.isArray(sample.locations) ? sample.locations[0] : ""));
    const affectedPages = Number(sample.affectedPages);
    return brokenUrl
      ? `Broken link to ${brokenUrl} was found${location ? ` in ${location}` : ""}${sourcePage ? ` on ${sourcePage}` : Number.isFinite(affectedPages) ? ` across ${affectedPages} affected page${affectedPages === 1 ? "" : "s"}` : ""}.`
      : "One or more broken internal links were detected.";
  }
  if (id === 140 || id === 234) {
    const rawWords = Number(sample.rawHtmlWords);
    const renderedWords = Number(sample.renderedDomWords);
    const difference = Number(sample.differencePercent);
    if (Number.isFinite(rawWords) && Number.isFinite(renderedWords) && Number.isFinite(difference)) {
      const reason = renderedWords > rawWords
        ? "Key content loads only after JavaScript execution."
        : "The rendered DOM contains substantially less content than the raw response.";
      return `Raw HTML contains ${rawWords} words; rendered DOM contains ${renderedWords} words; content difference is ${difference}%. ${reason}`;
    }
    return "Rendered content differs significantly from raw HTML.";
  }
  if (id === 132 || id === 217) {
    const pageUrl = String(sample.pageUrl ?? "");
    const hiddenSample = String(sample.hiddenSample ?? "").trim();
    return pageUrl
      ? `Primary content is available only inside collapsed elements on ${pageUrl}.${hiddenSample ? ` Hidden content sample: “${hiddenSample}”` : ""}`
      : "Primary content is available only inside collapsed elements.";
  }
  if (id === 78 || id === 91) {
    const parsed = evidenceRecord(evidence);
    const errors = Array.isArray(parsed.parseErrors)
      ? parsed.parseErrors
      : Array.isArray(parsed.validationFailures)
        ? parsed.validationFailures
        : [];
    const first = errors[0];
    if (first && typeof first === "object") {
      const record = first as Record<string, unknown>;
      return `JSON-LD validation failed: ${String(record.error ?? "Unknown parsing error")}${record.url ? ` on ${String(record.url)}` : ""}.`;
    }
    return "JSON-LD validation failed, but no parser detail was available.";
  }
  const parsed = evidenceRecord(evidence);
  if (typeof parsed.metric === "string" && parsed.measuredValue !== undefined && parsed.threshold !== undefined) {
    return `${parsed.metric} measured ${String(parsed.measuredValue)}${String(parsed.unit ?? "")}; required less than ${String(parsed.threshold)}${String(parsed.unit ?? "")}.`;
  }
  const definition = CHECKS.find((check) => check.id === id);
  const pagesChecked = Number(parsed.pagesChecked);
  const pagesFailed = Number(parsed.pagesFailed);
  if (Number.isFinite(pagesChecked) && Number.isFinite(pagesFailed)) {
    return `${definition?.name ?? "This check"} failed on ${pagesFailed} of ${pagesChecked} analyzed pages.`;
  }
  return `${definition?.name ?? "This check"} failed based on the recorded audit evidence.`;
}

const BROWSER_LOADED_HTTP_ASSET_SELECTORS = [
  { tag: "script", attr: "src" },
  { tag: "link", attr: "href" },
  { tag: "img", attr: "src" },
  { tag: "iframe", attr: "src" },
  { tag: "video", attr: "src" },
  { tag: "audio", attr: "src" }
];

function linkElementLoadsResource($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]) {
  const rel = ($(el).attr("rel") ?? "").toLowerCase();
  return /\b(?:stylesheet|preload|modulepreload|prefetch|icon|apple-touch-icon|manifest)\b/.test(rel);
}

export function mixedContentAssets(pages: FetchedPage[]): MixedContentAsset[] {
  return pages.flatMap((page) =>
    BROWSER_LOADED_HTTP_ASSET_SELECTORS.flatMap(({ tag, attr }) =>
      page.$(`${tag}[${attr}]`).toArray()
        .filter((el) => tag !== "link" || linkElementLoadsResource(page.$, el))
        .map((el) => ({
          tag,
          url: (page.$(el).attr(attr) ?? "").trim(),
          pageUrl: page.finalUrl
        }))
        .filter((asset) => /^http:\/\//i.test(asset.url))
    )
  );
}

export function http200SeverityForPercent(percent: number): TechnicalSeverity {
  if (percent >= 95) return "ADVISORY";
  if (percent >= 80) return "MAJOR";
  return "BLOCKER";
}

export async function runTechnicalAudit(inputUrl: string, siteCrawl?: SiteCrawlResult): Promise<TechnicalAuditResult> {
  const url = new URL(normalizeUrl(inputUrl));
  let page: FetchedPage;
  const crawledHomepage = siteCrawl?.pages.find((candidate) =>
    candidate.source === "homepage" ||
    comparableCanonicalUrl(candidate.url) === comparableCanonicalUrl(url.toString()) ||
    comparableCanonicalUrl(candidate.finalUrl) === comparableCanonicalUrl(url.toString())
  );
  if (crawledHomepage) {
    page = crawledHomepage;
  } else {
    try {
      page = await fetchPage(url.toString(), 12000);
    } catch (error) {
      throw new Error(`Technical audit homepage unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  const origin = `${url.protocol}//${url.host}`;
  const robotsFetch = await fetchTextWithRetryStatus(`${origin}/robots.txt`, {}, 2500, 8000);
  const robots = robotsFetch.result;
  const robotsObservedStatus = robotsFetch.observedStatus;
  const sitemapDirectives = sitemapDirectivesFromRobots(robots?.text ?? "");
  const sitemapDirectiveChecksPromise = Promise.all(sitemapDirectives.map(async (directive) => {
    const requestedUrl = validSitemapDirectiveUrl(directive);
    if (!requestedUrl) {
      return {
        directive,
        requestedUrl: directive,
        result: null,
        observedStatus: "Malformed URL" as const,
        malformed: true
      };
    }
    const fetched = await fetchTextWithRetryStatus(requestedUrl, {}, 2500, 8000);
    return {
      directive,
      requestedUrl,
      result: fetched.result,
      observedStatus: fetched.observedStatus,
      malformed: false
    };
  }));
  const [sitemapDirectiveChecks, aiTxt, llms, psi, desktopPsi, crux, renderedAudit, crawled] = await Promise.all([
    sitemapDirectiveChecksPromise,
    fetchText(`${origin}/ai.txt`, {}, 1800).catch(() => null),
    fetchText(`${origin}/llms.txt`, {}, 1800).catch(() => null),
    fetchPageSpeedInsights(page.finalUrl, "mobile"),
    fetchPageSpeedInsights(page.finalUrl, "desktop"),
    fetchCrux(page.finalUrl),
    renderedDomWordCount(page.finalUrl),
    siteCrawl ? Promise.resolve(siteCrawl) : crawlSite(url.toString(), {
      maxPages: 1000,
      maxDepth: 0,
      timeoutMs: 3500,
      concurrency: 8,
      maxSitemapFiles: 250,
      followInternalLinks: false
    })
  ]);
  const reachableSitemapDirective = sitemapDirectiveChecks.find((check) => check.result?.response.status === 200);
  const firstSitemapDirectiveCheck = sitemapDirectiveChecks[0];
  const selectedSitemapDirectiveCheck = reachableSitemapDirective ?? firstSitemapDirectiveCheck;
  const sitemapDirective = selectedSitemapDirectiveCheck?.directive ?? "";
  const sitemapUrl = selectedSitemapDirectiveCheck?.requestedUrl ?? "";
  const sitemap = selectedSitemapDirectiveCheck?.result ?? null;
  const sitemapObservedStatus = selectedSitemapDirectiveCheck?.observedStatus ?? "Sitemap directive missing";
  const sitemap$ = sitemap?.text ? cheerio.load(sitemap.text, { xmlMode: true }) : null;
  const pages = (crawled.pages.length ? crawled.pages : [page]) as FetchedPage[];
  const samplePages = pages.slice(1);
  const ld = jsonLd(page);
  const pageLd = pages.map((candidate) => ({ ...jsonLd(candidate), page: candidate }));
  const allLdBlocks = pageLd.flatMap((item) => item.blocks);
  const allLdTypes = schemaTypes(allLdBlocks);
  const ldTypes = schemaTypes(ld.blocks);
  const images = imageStats(page);
  const pageImages = pages.map(imageStats);
  const imageAggregate = aggregateImageStats(pageImages);
  const missingAltImageSamples = imageIssueSamples(pages, (p, el) => {
    return !isLikelyDecorativeImage(p.$, el) && !(p.$(el).attr("alt") ?? "").trim();
  });
  const missingDimensionImageSamples = imageIssueSamples(pages, (p, el) => !p.$(el).attr("width") || !p.$(el).attr("height"));
  const genericImageSamples = imageIssueSamples(pages, (p, el) => {
    const src = p.$(el).attr("src") ?? "";
    const filename = src.split(/[?#]/)[0].split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") ?? "";
    return /^(img|image|photo|pic|screenshot)[-_]?\d+$/i.test(filename);
  });
  const nonModernImageSamples = imageIssueSamples(pages, (p, el) => !/\.(webp|avif)(\?|$)/i.test(p.$(el).attr("src") ?? ""));
  const nonLazyBelowFoldImageSamples = pages.flatMap((p) =>
    p.$("img").toArray().slice(2).filter((el) => p.$(el).attr("loading")?.toLowerCase() !== "lazy").map((el) => ({
      pageUrl: p.finalUrl,
      imageUrl: imageUrl(p, el) || "inline image"
    }))
  ).slice(0, 10);
  const imageEvidence = (summary: string, sampleImages: { pageUrl: string; imageUrl: string }[]) =>
    sampleImages.length ? JSON.stringify({ summary, sampleImages }) : summary;
  const interactiveAggregate = pages.map(interactiveLabelStats).reduce((total, item) => ({
    total: total.total + item.total,
    labelled: total.labelled + item.labelled
  }), { total: 0, labelled: 0 });
  const interactiveLabelRate = interactiveAggregate.total ? interactiveAggregate.labelled / interactiveAggregate.total : 1;
  const links = internalLinks(page, url);
  const allInternalLinks = pages.flatMap((p) => internalLinks(p, new URL(p.finalUrl)));
  const canonical = linkHrefByRel(page.$, "canonical");
  const canonicalAbs = canonical ? absolute(url, canonical) : "";
  const canonicalSelfRef = passRate(pages, (p) => {
    const value = linkHrefByRel(p.$, "canonical");
    const resolved = value ? absolute(new URL(p.finalUrl), value) : "";
    return Boolean(resolved) && comparableCanonicalUrl(resolved) === comparableCanonicalUrl(p.finalUrl);
  });
  const robotsValue = metaRobots(page);
  const h1 = page.$("h1").first().text().trim();
  const title = page.$("title").first().text().trim();
  const description = metaContentByName(page.$, "description");
  const viewportDebug = viewportMetaDebug(page.$);
  const viewport = viewportDebug.viewportContent.toLowerCase();
  const headBlockingScripts = page.$("head script[src]:not([async]):not([defer]):not([type='module'])").length;
  const hiddenWords = page.$("[style*='display:none'],[hidden]").toArray().reduce((sum, el) => sum + wordCount(page.$(el).text()), 0);
  const semanticCount = page.$("article,section,main,aside,header,footer").length;
  const outboundCount = page.$("a[href]").toArray().filter((el) => {
    const href = page.$(el).attr("href") ?? "";
    return href.startsWith("http") && !sameOrigin(url, href);
  }).length;
  const footerPrivacy = footerLink(page, /privacy/i);
  const footerTerms = footerLink(page, /terms|conditions/i);
  const contactLink = page.$("a[href]").toArray().find((el) => /contact/i.test(page.$(el).attr("href") ?? "") || /contact/i.test(page.$(el).text()));
  const aboutLink = page.$("a[href]").toArray().find((el) => /about/i.test(page.$(el).attr("href") ?? "") || /about/i.test(page.$(el).text()));
  const firstImg = firstImage(page);
  const firstImgLazy = firstImg.attr("loading")?.toLowerCase() === "lazy";
  const contextsValid = ld.blocks.every((block) => {
    const context = (block as Record<string, unknown>)?.["@context"];
    return typeof context === "string" ? context.includes("schema.org") : true;
  });
  const titleValues = pages.map((p) => p.$("title").first().text().trim());
  const descriptionValues = pages.map((p) => metaContentByName(p.$, "description"));
  const titlePresence = passRate(titleValues, (value) => value.length > 0);
  const titleLength = passRate(titleValues, (value) => value.length >= 30 && value.length <= 60);
  const descriptionPresence = passRate(descriptionValues, (value) => value.length > 0);
  const availableDescriptions = descriptionValues.filter(Boolean);
  const descriptionLength = passRate(descriptionValues, (value) => value.length >= 120 && value.length <= 160);
  const titleLengthOutcome = optimizationLengthOutcome(titleLength.rate);
  const descriptionLengthOutcome = optimizationLengthOutcome(descriptionLength.rate);
  const viewportPresence = passRate(pages, (p) => viewportMetaDebug(p.$).passed);
  const viewportDebugEvidence = JSON.stringify(viewportDebug);
  console.debug("Technical audit viewport meta", viewportDebug);
  const duplicateTitleSet = new Set([...titleValues.filter(Boolean).reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map<string, number>()).entries()].filter(([, count]) => count > 1).map(([value]) => value));
  const duplicateDescriptionSet = new Set([...availableDescriptions.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map<string, number>()).entries()].filter(([, count]) => count > 1).map(([value]) => value));
  const duplicateTitlePages = titleValues.filter((value) => duplicateTitleSet.has(value)).length;
  const duplicateDescriptionPages = availableDescriptions.filter((value) => duplicateDescriptionSet.has(value)).length;
  const duplicateTitleRate = pages.length ? duplicateTitlePages / pages.length : 0;
  const duplicateDescriptionRate = availableDescriptions.length ? duplicateDescriptionPages / availableDescriptions.length : 0;
  const titleMissingUrls = pages.filter((p) => !p.$("title").first().text().trim()).map((p) => p.finalUrl).slice(0, 10);
  const titleLengthIssueUrls = pages.filter((p) => {
    const value = p.$("title").first().text().trim();
    return value.length < 30 || value.length > 60;
  }).map((p) => p.finalUrl).slice(0, 10);
  const descriptionMissingUrls = pages.filter((p) => !metaContentByName(p.$, "description")).map((p) => p.finalUrl).slice(0, 10);
  const descriptionLengthIssueUrls = pages.filter((p) => {
    const value = metaContentByName(p.$, "description");
    return value.length < 120 || value.length > 160;
  }).map((p) => p.finalUrl).slice(0, 10);
  const duplicateTitleUrls = pages.filter((p) => duplicateTitleSet.has(p.$("title").first().text().trim())).map((p) => p.finalUrl).slice(0, 10);
  const duplicateDescriptionUrls = pages.filter((p) => duplicateDescriptionSet.has(metaContentByName(p.$, "description"))).map((p) => p.finalUrl).slice(0, 10);
  const hreflangs = linkElementsByRel(page.$, "alternate").filter((el) => Boolean(page.$(el).attr("hreflang"))).length;
  const hasLanguageAlternates = page.html.match(/\/(en|hi|fr|es|de|ar)\//i) !== null || hreflangs > 0;
  const aboutWords = aboutLink ? await fetchPage(absolute(url, page.$(aboutLink).attr("href") ?? ""), 2000).then((p) => p.wordCount).catch(() => 0) : 0;
  const contactText = contactLink ? await fetchPage(absolute(url, page.$(contactLink).attr("href") ?? ""), 2000).then((p) => p.$("body").text()).catch(() => "") : "";
  const reviewSignals = page.$("[class*='review'],[class*='testimonial'],[id*='review'],[id*='testimonial']").length;
  const reviewWords = (page.$("body").text().match(/\b(review|reviews|testimonial|testimonials|rating|ratings|stars?|customer stories)\b/gi) ?? []).length;
  const everyPage = (predicate: (p: FetchedPage) => boolean) => pages.every(predicate);
  const somePage = (predicate: (p: FetchedPage) => boolean) => pages.some(predicate);
  const pagePassRate = (predicate: (p: FetchedPage) => boolean) => passRate(pages, predicate);
  const failedPageUrls = (predicate: (p: FetchedPage) => boolean, limit = 10) => pages.filter((p) => !predicate(p)).map((p) => p.finalUrl).slice(0, limit);
  const pageRateEvidence = (rate: ReturnType<typeof passRate<FetchedPage>>, label: string, predicate?: (p: FetchedPage) => boolean) => {
    const failed = predicate ? pages.filter((p) => !predicate(p)).slice(0, 10) : [];
    return JSON.stringify({
      scope: "page-level-site-wide",
      pagesCrawled: pages.length,
      pagesChecked: rate.total,
      pagesPassed: rate.passed,
      pagesFailed: rate.total - rate.passed,
      passRate: rate.percent,
      affectedPages: failed.map((p) => ({ url: p.finalUrl, issueCount: 1, sampleEvidence: label })),
      sampleEvidence: failed.map((p) => ({ url: p.finalUrl, issue: label }))
    });
  };
  const countEvidence = (passed: number, total: number, failedUrls: string[], issue: string) => JSON.stringify({
    scope: "page-level-site-wide",
    pagesCrawled: pages.length,
    pagesChecked: total,
    pagesPassed: passed,
    pagesFailed: Math.max(0, total - passed),
    passRate: total ? Number(((passed / total) * 100).toFixed(1)) : 100,
    affectedPages: failedUrls.slice(0, 10).map((affectedUrl) => ({ url: affectedUrl, issueCount: 1, sampleEvidence: issue })),
    sampleEvidence: failedUrls.slice(0, 10).map((affectedUrl) => ({ url: affectedUrl, issue }))
  });
  const crawlStats = crawled.crawlStats;
  const sitemapTargetCount = crawlStats?.targetUrls || crawled.sitemapUrls.length || crawled.sitemapSummary?.totalUrls || pages.length;
  const crawlLimitNote = crawlStats?.cappedByMaxPages ? `, capped by max page limit` : "";
  const crawlDropNote = crawlStats?.failedOrNonHtmlUrls ? `, ${crawlStats.failedOrNonHtmlUrls} failed or non-HTML` : "";
  const pageCountEvidence = `${pages.length}/${sitemapTargetCount} sitemap/homepage pages returned crawlable HTML${crawlLimitNote}${crawlDropNote}`;
  const assetRefs = dedupeByUrl(pages.flatMap((p) => extractAssets(p, new URL(p.finalUrl))));
  const textAssetRefs = assetRefs.filter((asset) => isTextAsset(asset.kind));
  const sampleableAssetRefs = assetRefs.filter((asset) => asset.kind !== "other");
  // Keep network validation bounded. A 200-page crawl can expose thousands of
  // unique links; validating all of them serially by concurrency batch can
  // exceed the report-level timeout and discard otherwise usable audit data.
  const externalLinkRefs = pages.flatMap((p) => extractExternalLinks(p, new URL(p.finalUrl))).slice(0, 100);
  const externalLinkTargets = [...new Set(externalLinkRefs.map((link) => link.url))];
  const internalLinkTargets = [...new Set(allInternalLinks.map((link) => link.href))].slice(0, 100);
  const trackingInternalLinks = findTrackingInternalLinks(allInternalLinks);
  const searchLinks = internalSearchLinks(allInternalLinks);
  const fakeUrl = `${origin}/__audit-soft-404-test-${Date.now()}`;
  const apiUrls = publicApiUrls(page, url);
  const inlineScriptText = pages.map((p) => p.$("script:not([src])").toArray().map((el) => p.$(el).text()).join("\n")).join("\n");

  const [
    compressedTextAssets,
    headerAssetSamples,
    scriptTextAssets,
    internalLinkResponses,
    externalLinkResponses,
    soft404Response,
    feedCandidates,
    apiResponses
  ] = await Promise.all([
    sampleAssets(textAssetRefs, 24, false, { headers: { "accept-encoding": "br, gzip, deflate" } }),
    sampleAssets(sampleableAssetRefs, 28, false),
    sampleAssets(assetRefs.filter((asset) => asset.kind === "js"), 12, true),
    mapWithConcurrency(internalLinkTargets, 16, (href) => validateBrokenLink(href, 8000, 5)),
    mapWithConcurrency(externalLinkTargets, 16, (href) => validateBrokenLink(href, 2200)),
    fetchText(fakeUrl, {}, 2400).catch(() => null),
    Promise.all(["/feed", "/rss", "/atom.xml"].map(async (path) => ({ url: `${origin}${path}`, result: await fetchText(`${origin}${path}`, {}, 2200).catch(() => null) }))),
    Promise.all(apiUrls.map(async (apiUrl) => ({ url: apiUrl, response: await safeFetch(apiUrl, { method: "OPTIONS" }, 1800) ?? await safeFetch(apiUrl, { method: "GET" }, 1800) })))
  ]);

  const compressedCount = compressedTextAssets.filter((asset) => /gzip|br|deflate/i.test(asset.headers.get("content-encoding") ?? "")).length;
  const compressionPercent = compressedTextAssets.length ? Math.round((compressedCount / compressedTextAssets.length) * 100) : 0;
  const htmlCompressionSample = compressedTextAssets.find((asset) => asset.kind === "html");
  const htmlCompression = htmlCompressionSample?.headers.get("content-encoding") ?? page.headers.get("content-encoding") ?? "";
  const cacheOkCount = headerAssetSamples.filter(appropriateCacheControl).length;
  const cachePercent = headerAssetSamples.length ? Math.round((cacheOkCount / headerAssetSamples.length) * 100) : 0;
  const validatorHeaders = [
    page.headers.get("etag") ? `etag: ${page.headers.get("etag")}` : "",
    page.headers.get("last-modified") ? `last-modified: ${page.headers.get("last-modified")}` : ""
  ].filter(Boolean);
  const assetValidatorCount = headerAssetSamples.filter((asset) => asset.headers.has("etag") || asset.headers.has("last-modified")).length;
  const cdnEvidence = [page, ...headerAssetSamples].map((item) => cdnSignal(item.headers)).find(Boolean) ?? "";
  const contentTypeOkCount = headerAssetSamples.filter(contentTypeMatches).length;
  const externalValidationByUrl = new Map(externalLinkResponses.map((item) => [item.url, item]));
  const brokenExternalLinks = externalLinkRefs.flatMap((link) => {
    const validation = externalValidationByUrl.get(link.url);
    return validation?.broken ? [{ ...validation, pageUrl: link.pageUrl }] : [];
  });
  const externalAffectedPages = [...new Set(brokenExternalLinks.map((item) => item.pageUrl))];
  const externalLinkEvidence = JSON.stringify({
    scope: "page-level-site-wide",
    pagesCrawled: pages.length,
    pagesChecked: pages.length,
    linkTargetsChecked: externalLinkTargets.length,
    pagesPassed: pages.length - externalAffectedPages.length,
    pagesFailed: externalAffectedPages.length,
    passRate: pages.length ? Number((((pages.length - externalAffectedPages.length) / pages.length) * 100).toFixed(1)) : 100,
    affectedPages: externalAffectedPages.slice(0, 10).map((pageUrl) => ({
      url: pageUrl,
      issueCount: brokenExternalLinks.filter((item) => item.pageUrl === pageUrl).length,
      sampleEvidence: brokenExternalLinks.filter((item) => item.pageUrl === pageUrl).slice(0, 3).map((item) => ({
        brokenUrl: item.url,
        finalUrl: item.finalUrl,
        finalStatus: item.finalStatus,
        redirectHops: item.redirectHops,
        sourcePage: item.pageUrl
      }))
    })),
    brokenLinkEvidence: brokenExternalLinks.map((item) => ({
      brokenUrl: item.url,
      finalUrl: item.finalUrl,
      finalStatus: item.finalStatus,
      redirectHops: item.redirectHops,
      sourcePage: item.pageUrl
    })),
    sampleEvidence: brokenExternalLinks.slice(0, 10).map((item) => ({
      brokenUrl: item.url,
      finalUrl: item.finalUrl,
      finalStatus: item.finalStatus,
      redirectHops: item.redirectHops,
      sourcePage: item.pageUrl
    }))
  });
  const brokenInternalLinks = internalLinkResponses.filter((item) => item.broken);
  const soft404Status = soft404Response?.response.status ?? 0;
  const soft404Body = soft404Response?.text ?? "";
  const llmsWordStats = llmsStats(llms?.text ?? "");
  const llmsContentType = llms?.response.headers.get("content-type") ?? "";
  const foundFeed = feedCandidates.find((feed) => feed.result?.response.ok && /xml|rss|atom|text/i.test(feed.result.response.headers.get("content-type") ?? ""));
  const feedItems = foundFeed?.result?.text ? cheerio.load(foundFeed.result.text, { xmlMode: true })("item,entry").toArray() : [];
  const feedWordCounts = feedItems.slice(0, 8).map((el) => {
    if (!foundFeed?.result?.text) return 0;
    const feed$ = cheerio.load(foundFeed.result.text, { xmlMode: true });
    const item = feed$(el);
    return wordCount(item.find("content\\:encoded, encoded, content, summary, description").text());
  });
  const avgFeedWords = feedWordCounts.length ? Math.round(feedWordCounts.reduce((sum, count) => sum + count, 0) / feedWordCounts.length) : 0;
  const externalScriptText = scriptTextAssets.map((asset) => asset.text ?? "").join("\n");
  const scriptAuditText = `${inlineScriptText}\n${externalScriptText}`;
  const historyMatch = suspiciousHistoryPattern(scriptAuditText);
  const exitIntentMatch = exitIntentRedirectPattern(scriptAuditText);
  const corsValues = apiResponses.map((item) => item.response?.headers.get("access-control-allow-origin") ?? "").filter(Boolean);
  const subdomains = discoveredSubdomains(pages, url);
  const [
    subdomainSslResults,
    canonicalChain,
    openAiFetch,
    googleExtendedFetch,
    slashRedirectStatus,
    caseVariantStatus,
    indexNowResponses
  ] = await Promise.all([
    Promise.all(subdomains.map(async (host) => ({ host, valid: await sslValid(new URL(`https://${host}`)) }))),
    canonicalAbs ? canonicalChainLength(canonicalAbs) : Promise.resolve({ hops: 0, loop: false }),
    fetchWithUserAgent(page.finalUrl, "GPTBot/1.2; +https://openai.com/gptbot"),
    fetchWithUserAgent(page.finalUrl, "Google-Extended"),
    redirectStatus(url.toString().endsWith("/") ? url.toString().slice(0, -1) : `${url.toString()}/`),
    redirectStatus(`${origin}${new URL(page.finalUrl).pathname.toUpperCase()}`),
    Promise.all(indexNowCandidateUrls(origin, robots?.text ?? "", page.html).map(async (item) => ({ url: item, response: await safeHeadOrGet(item, 1800) })))
  ]);
  const primaryWordCounts = pages.map(visiblePrimaryWordCount);
  const ssrPassCount = primaryWordCounts.filter((count) => count >= 150).length;
  const emptyShells = pages.map(emptyShellEvidence).filter((item) => item.isShell);
  const accordionWords = pages.reduce((sum, item) => sum + accordionHiddenWords(item), 0);
  const collapsedPrimaryPages = pages.map(collapsedPrimaryContentEvidence).filter((item) => item.primaryOnlyCollapsed);
  const maxDomNodes = Math.max(...pages.map((p) => p.$("*").length), 0);
  const hiddenKeywordCount = pages.reduce((sum, item) => sum + cssHiddenKeywordText(item), 0);
  const schemaInjection = schemaInjectionEvidence(page);
  const ttfbSamples = [page.responseTimeMs, ...headerAssetSamples.filter((asset) => asset.kind === "html").map(() => page.responseTimeMs)];
  const medianTtfb = ttfbSamples.sort((a, b) => a - b)[Math.floor(ttfbSamples.length / 2)] ?? page.responseTimeMs;
  const aiCrawlerChecks = [
    { label: "GPTBot", result: openAiFetch },
    { label: "Google-Extended", result: googleExtendedFetch }
  ].map((item) => {
    const bodyWords = item.result ? wordCount(cheerio.load(item.result.text)("body").text()) : 0;
    return {
      label: item.label,
      result: item.result,
      bodyWords,
      passed: Boolean(item.result && item.result.response.status < 400 && bodyWords >= 50)
    };
  });
  const aiCrawlerOk = aiCrawlerChecks.every((item) => item.passed);
  const aiCrawlerEvidence = aiCrawlerChecks
    .map((item) => item.result ? `${item.label} GET: HTTP ${item.result.response.status}, ${item.bodyWords} body words` : `${item.label} GET: fetch failed`)
    .join("; ");
  const rawHtmlWords = page.wordCount;
  const renderedDomWords = renderedAudit.words;
  const renderedDifferencePercent = renderedDomWords !== null && rawHtmlWords > 0
    ? Math.round((Math.abs(renderedDomWords - rawHtmlWords) / rawHtmlWords) * 100)
    : null;
  const renderedContentMatches = renderedDifferencePercent !== null && renderedDifferencePercent <= 20;
  const renderedContentEvidence = renderedDifferencePercent === null ? null : JSON.stringify({
    scope: "homepage-rendered-comparison",
    pagesCrawled: pages.length,
    pagesChecked: 1,
    pagesPassed: renderedContentMatches ? 1 : 0,
    pagesFailed: renderedContentMatches ? 0 : 1,
    passRate: renderedContentMatches ? 100 : 0,
    affectedPages: renderedContentMatches ? [] : [{ url: page.finalUrl, issueCount: 1 }],
    sampleEvidence: [{
      pageUrl: page.finalUrl,
      rawHtmlWords,
      renderedDomWords,
      differencePercent: renderedDifferencePercent,
      reason: (renderedDomWords ?? 0) > rawHtmlWords
        ? "Key content loads only after JavaScript execution."
        : "The rendered DOM contains substantially less content than the raw response."
    }]
  });
  const indexNowCandidates = indexNowCandidateUrls(origin, robots?.text ?? "", page.html);
  const indexNowPassed = indexNowResponses.some((item) => item.response?.status === 200);
  const slashVariantUrl = url.toString().endsWith("/") ? url.toString().slice(0, -1) : `${url.toString()}/`;
  const slashVariant = await fetchText(slashVariantUrl, {}, 1800).catch(() => null);
  const slashSimilarity = slashVariant ? contentSimilarity(page.html, slashVariant.text) : 0;
  const slashDuplicateFailed = Boolean(
    slashVariant
    && slashVariant.response.status === 200
    && page.status === 200
    && !slashVariant.response.redirected
    && comparableCanonicalUrl(slashVariant.response.url) !== comparableCanonicalUrl(page.finalUrl)
    && slashSimilarity >= 0.9
  );
  const fcp = psi?.fcp;
  const lcp = crux?.lcp ?? psi?.lcp;
  const desktopLcp = desktopPsi?.lcp;
  const inp = crux?.inp ?? psi?.inp;
  const cls = crux?.cls ?? psi?.cls;
  const ttfb = crux?.ttfb ?? psi?.ttfb;
  const observedTtfb = ttfb ?? page.responseTimeMs;
  const desktopScore = desktopPsi?.performanceScore;
  const mobileScore = psi?.performanceScore;
  const performanceSnapshot = pageSpeedSnapshot(page.finalUrl, psi, desktopPsi);
  const psiUnavailableEvidence = JSON.stringify({ reason: "PageSpeed Insights data unavailable." });
  const performanceScoreWarning = (score?: number) => score !== undefined && score >= 70 && score < 90;
  const tapTargetsPass = psi?.tapTargetsPass;
  const firstImgSrc = firstImg.attr("src") ?? firstImg.attr("data-src") ?? "";
  const firstImgUrl = firstImgSrc ? absolute(new URL(page.finalUrl), firstImgSrc) : "";
  const lcpCandidateUrl = psi?.lcpElementUrl ?? firstImgUrl;
  const lcpCandidateSource = psi?.lcpElementUrl
    ? "PageSpeed Insights LCP element"
    : firstImgUrl
      ? "Heuristic: first image in <main>"
      : "Image aggregate fallback";
  const lcpAssetSample = lcpCandidateUrl ? headerAssetSamples.find((asset) => asset.url === lcpCandidateUrl) : undefined;
  const lcpAssetBytes = lcpAssetSample ? contentLengthBytes(lcpAssetSample.headers) : 0;
  const lcpModernFormat = lcpCandidateUrl
    ? isModernLcpImageUrl(lcpCandidateUrl)
    : psi?.modernImagePass ?? imageAggregate.modernRate >= 0.7;
  const lcpPreloaded = somePage((p) => hasImagePreloadHint(p.$));
  const lcpElementFound = psi?.lcpElementFound ?? Boolean(firstImg.length || page.$("main h1,h1,main video,video[poster]").length);
  const lcpPhaseBreakdownAvailable = psi?.lcp !== undefined && [psi.ttfb, psi.fcp].some((value) => value !== undefined);
  const scriptRefs = pages.flatMap((p) => p.$("script[src]").toArray().map((el) => {
    const script = p.$(el);
    const src = absolute(new URL(p.finalUrl), script.attr("src") ?? "");
    return {
      src,
      thirdParty: src ? !sameOrigin(new URL(p.finalUrl), src) : false,
      deferred: script.attr("async") !== undefined || script.attr("defer") !== undefined || (script.attr("type") ?? "").toLowerCase() === "module"
    };
  })).filter((script) => script.src);
  const thirdPartyScripts = scriptRefs.filter((script) => script.thirdParty);
  const deferredThirdPartyCount = thirdPartyScripts.filter((script) => script.deferred).length;
  const deferredThirdPartyPercent = thirdPartyScripts.length ? Math.round((deferredThirdPartyCount / thirdPartyScripts.length) * 100) : 100;
  const longTaskSignal = psi?.tbt !== undefined ? psi.tbt : headBlockingScripts * 120 + thirdPartyScripts.length * 40;
  const taskYieldingSignals = /(requestIdleCallback|scheduler\.postTask|requestAnimationFrame|setTimeout\s*\([^,]+,\s*0|await\s+new\s+Promise)/i.test(scriptAuditText);
  const allImagesDimensionsRate = imageAggregate.dimensionsRate;
  const contentAreaClsStable = cls !== undefined ? cls === 0 : imageAggregate.dimensionsRate >= 0.95 && accordionWords < 100;
  const adLikeElements = pages.flatMap((p) => p.$("[id*='ad'],[class*='ad-'],[class*='ads'],ins.adsbygoogle").toArray().map((el) => ({
    page: p,
    style: (p.$(el).attr("style") ?? "").toLowerCase()
  })));
  const reservedAdSlots = adLikeElements.every((item) => /height|aspect-ratio|min-height/.test(item.style));
  const dynamicInjectionAbove = /(insertBefore|prepend|afterbegin|before\s*\()/i.test(scriptAuditText);
  const intrusiveInterstitials = /(?:interstitial|full[-\s]?screen\s+(?:modal|popup)|age[-\s]?gate|subscribe[-\s]?overlay)/i.test(page.html);
  const jsAssetSamples = headerAssetSamples.filter((asset) => asset.kind === "js");
  const cssAssetSamples = headerAssetSamples.filter((asset) => asset.kind === "css");
  const fontAssetSamples = headerAssetSamples.filter((asset) => asset.kind === "font");
  const totalJsBytes = jsAssetSamples.reduce((sum, asset) => sum + contentLengthBytes(asset.headers), 0);
  const totalCssBytes = cssAssetSamples.reduce((sum, asset) => sum + contentLengthBytes(asset.headers), 0);
  const totalPageWeightBytes = headerAssetSamples.reduce((sum, asset) => sum + contentLengthBytes(asset.headers), Buffer.byteLength(page.html));
  const unusedJsPercent = totalJsBytes && psi?.unusedJsSavingsBytes !== undefined ? Math.round((psi.unusedJsSavingsBytes / totalJsBytes) * 100) : 0;
  const unusedCssPercent = totalCssBytes && psi?.unusedCssSavingsBytes !== undefined ? Math.round((psi.unusedCssSavingsBytes / totalCssBytes) * 100) : 0;
  const optimizedImages = psi?.optimizedImagePass ?? imageAggregate.modernRate >= 0.7;
  const selfHostedFontPercent = fontAssetSamples.length
    ? Math.round((fontAssetSamples.filter((asset) => sameOrigin(new URL(page.finalUrl), asset.url)).length / fontAssetSamples.length) * 100)
    : 100;
  const preconnectCount = pages.reduce((sum, p) => sum + linkElementsByRel(p.$, "preconnect").length, 0);
  const preloadCriticalCount = pages.reduce((sum, p) => sum + linkElementsByRel(p.$, "preload").length, 0);
  const http200Count = pages.filter((p) => p.status === 200).length;
  const http200Rate = pages.length ? http200Count / pages.length : 0;
  const http200Percent = Math.round(http200Rate * 100);
  const http200Severity = http200SeverityForPercent(http200Percent);
  const browserMixedContentAssets = url.protocol === "https:" ? mixedContentAssets(pages) : [];
  const mixedContentAffectedPages = [...new Set(browserMixedContentAssets.map((asset) => asset.pageUrl))];
  const mixedContentDebug = {
    mixedContentAssets: browserMixedContentAssets.map(({ tag, url, pageUrl }) => ({ tag, url, pageUrl }))
  };
  const mixedContentEvidence = JSON.stringify({
    scope: "page-level-site-wide",
    pagesCrawled: pages.length,
    pagesChecked: pages.length,
    pagesPassed: pages.length - mixedContentAffectedPages.length,
    pagesFailed: mixedContentAffectedPages.length,
    passRate: pages.length ? Number((((pages.length - mixedContentAffectedPages.length) / pages.length) * 100).toFixed(1)) : 100,
    affectedPages: mixedContentAffectedPages.slice(0, 10).map((pageUrl) => ({
      url: pageUrl,
      issueCount: browserMixedContentAssets.filter((asset) => asset.pageUrl === pageUrl).length,
      sampleEvidence: browserMixedContentAssets.filter((asset) => asset.pageUrl === pageUrl).slice(0, 3)
    })),
    sampleEvidence: browserMixedContentAssets.slice(0, 10)
  });
  console.debug("Technical audit mixed content", mixedContentDebug);
  const checksById = new Map(CHECKS.map((check) => [check.id, check]));

  const results: TechnicalCheckResult[] = [];
  const add = (id: number, passed: boolean, evidence: string, overrides: Partial<Pick<CheckDefinition, "severity" | "weight" | "name" | "category">> & { warning?: boolean; skipped?: boolean } = {}) => {
    if (DUPLICATE_CHECK_IDS.has(id)) return;
    const def = checksById.get(id);
    if (!def) return;
    const { warning, skipped, ...definitionOverrides } = overrides;
    let structuredEvidence = evidence;
    try {
      const parsed = JSON.parse(evidence) as Record<string, unknown>;
      if (skipped) {
        structuredEvidence = JSON.stringify({ ...parsed, skipped: true });
      } else {
      if (!Number.isFinite(Number(parsed.pagesCrawled))) throw new Error("not aggregate evidence");
      }
    } catch {
      if (skipped) {
        structuredEvidence = JSON.stringify({ skipped: true, reason: evidence });
      } else {
        const domainLevel = checkScope(id) === "domain";
        structuredEvidence = JSON.stringify({
          scope: domainLevel ? "domain-level" : "homepage-only",
          pagesCrawled: pages.length,
          pagesChecked: 1,
          pagesPassed: passed ? 1 : 0,
          pagesFailed: passed ? 0 : 1,
          passRate: passed ? 100 : 0,
          affectedPages: passed ? [] : [{ url: page.finalUrl, issueCount: 1, sampleEvidence: evidence }],
          sampleEvidence: [evidence]
        });
      }
    }
    results.push(pass({ ...def, ...definitionOverrides }, passed, structuredEvidence, warning, skipped));
  };
  const hsts = page.headers.get("strict-transport-security") ?? "";
  const hstsMaxAge = Number(hsts.match(/max-age=(\d+)/i)?.[1] ?? 0);

  const httpStatusRate = pagePassRate((candidate) => candidate.status === 200);
  add(1, httpStatusRate.rate >= 0.9, pageRateEvidence(httpStatusRate, "return HTTP 200", (candidate) => candidate.status === 200));
  add(2, url.protocol === "https:", url.protocol);
  add(3, await sslValid(url), "TLS certificate checked");
  add(4, hstsMaxAge >= 31536000, hsts ? `HSTS max-age=${hstsMaxAge}` : "HSTS header missing");
  const compressionRate = pagePassRate((candidate) => /gzip|br/i.test(candidate.headers.get("content-encoding") ?? ""));
  add(5, compressionRate.rate >= 0.9, pageRateEvidence(compressionRate, "use GZIP or Brotli compression", (candidate) => /gzip|br/i.test(candidate.headers.get("content-encoding") ?? "")));
  const xRobotsRate = pagePassRate((candidate) => !(candidate.headers.get("x-robots-tag") ?? "").toLowerCase().includes("noindex"));
  add(6, xRobotsRate.rate >= 0.9, pageRateEvidence(xRobotsRate, "do not send X-Robots-Tag noindex", (candidate) => !(candidate.headers.get("x-robots-tag") ?? "").toLowerCase().includes("noindex")));
  add(7, await fetchText(`${url.protocol}//www.${url.hostname.replace(/^www\./, "")}`, { method: "GET" }, 1800).then((r) => r.response.redirected || r.response.status === 200).catch(() => true), "www variant checked");
  add(8, browserMixedContentAssets.length === 0, mixedContentEvidence);
  const responseTimeRate = pagePassRate((candidate) => candidate.responseTimeMs < 800);
  add(9, responseTimeRate.rate >= 0.9, pageRateEvidence(responseTimeRate, "respond within 800ms", (candidate) => candidate.responseTimeMs < 800));
  const robotsStatus = robots?.response.status;
  const robotsFailed = !robotsTxtStatusPass(robotsStatus);
  add(10, !robotsFailed, JSON.stringify({
    scope: "domain-level",
    pagesCrawled: pages.length,
    pagesChecked: 1,
    pagesPassed: robotsFailed ? 0 : 1,
    pagesFailed: robotsFailed ? 1 : 0,
    passRate: robotsFailed ? 0 : 100,
    affectedPages: [],
    sampleEvidence: [{
      requestedUrl: `${origin}/robots.txt`,
      observed: robotsObservedStatus,
      expected: "200",
      status: robotsObservedStatus
    }]
  }));
  const sitemapDirectiveReachable = Boolean(reachableSitemapDirective);
  add(11, sitemapDirectiveReachable, JSON.stringify({
    scope: "domain-level",
    pagesCrawled: pages.length,
    pagesChecked: 1,
    pagesPassed: sitemapDirectiveReachable ? 1 : 0,
    pagesFailed: sitemapDirectiveReachable ? 0 : 1,
    passRate: sitemapDirectiveReachable ? 100 : 0,
    affectedPages: [],
    sampleEvidence: [{
      requestedUrl: sitemapDirective ? sitemapUrl : `${origin}/robots.txt`,
      robotsUrl: `${origin}/robots.txt`,
      observed: sitemapDirective || "Sitemap directive missing",
      expected: "200",
      directive: sitemapDirective,
      status: sitemapDirective ? sitemapObservedStatus : "Sitemap directive missing",
      malformed: selectedSitemapDirectiveCheck?.malformed ?? false
    }],
    sitemapDirectives: sitemapDirectiveChecks.map((check) => ({
      directive: check.directive,
      requestedUrl: check.requestedUrl,
      status: check.observedStatus,
      malformed: check.malformed
    }))
  }));
  const sitemapAvailable = sitemap?.response.status === 200 && /xml|text/i.test(sitemap.response.headers.get("content-type") ?? "");
  add(12, sitemapAvailable, JSON.stringify({
    scope: "domain-level",
    pagesCrawled: pages.length,
    pagesChecked: 1,
    pagesPassed: sitemapAvailable ? 1 : 0,
    pagesFailed: sitemapAvailable ? 0 : 1,
    passRate: sitemapAvailable ? 100 : 0,
    affectedPages: [],
    sampleEvidence: [{
      requestedUrl: sitemapUrl,
      robotsUrl: `${origin}/robots.txt`,
      observed: sitemapObservedStatus,
      expected: "200"
    }]
  }));
  add(13, sitemap$ ? sitemap$("url").toArray().every((el) => sitemap$(el).find("lastmod").length > 0) : false, "sitemap lastmod scan");
  add(14, pages.every(robotsContentAllowsIndex), `${pageCountEvidence}${failedPageUrls(robotsContentAllowsIndex).length ? `; sampleUrls: ${failedPageUrls(robotsContentAllowsIndex).join(", ")}` : ""}`);
  add(16, titlePresence.rate >= 0.95, countEvidence(titlePresence.passed, titlePresence.total, titleMissingUrls, "Missing or empty title tag"));
  add(17, titleLengthOutcome.passed, countEvidence(titleLength.passed, titleLength.total, titleLengthIssueUrls, "Title outside the recommended 30-60 character range"), {
    severity: titleLengthOutcome.severity,
    warning: titleLengthOutcome.warning
  });
  add(18, descriptionPresence.rate >= 0.8, countEvidence(descriptionPresence.passed, descriptionPresence.total, descriptionMissingUrls, "Missing or empty meta description"));
  add(19, descriptionLengthOutcome.passed, countEvidence(descriptionLength.passed, descriptionLength.total, descriptionLengthIssueUrls, "Meta description outside the recommended 120-160 character range"), {
    severity: descriptionLengthOutcome.severity,
    warning: descriptionLengthOutcome.warning
  });
  add(20, viewportPresence.rate >= 0.95, `${viewportPresence.passed}/${viewportPresence.total} pages contain valid viewport tag (${viewportPresence.percent}%). ${viewportDebugEvidence}`);
  const noindexMetaRate = pagePassRate((p) => !metaRobots(p).includes("noindex"));
  add(21, noindexMetaRate.rate >= 0.98, pageRateEvidence(noindexMetaRate, "do not contain meta noindex", (p) => !metaRobots(p).includes("noindex")));
  add(22, duplicateTitleRate <= 0.1, countEvidence(pages.length - duplicateTitlePages, pages.length, duplicateTitleUrls, "Duplicate title tag"));
  add(23, duplicateDescriptionRate <= 0.15, countEvidence(availableDescriptions.length - duplicateDescriptionPages, availableDescriptions.length, duplicateDescriptionUrls, "Duplicate meta description"));
  const visibleHeadings = (p: FetchedPage, selector = "h1,h2,h3,h4,h5,h6") => p.$(selector).toArray().filter((el) => {
    const hiddenAncestor = p.$(el).parents().toArray().some((parent) => {
      const style = (p.$(parent).attr("style") ?? "").replace(/\s+/g, "").toLowerCase();
      return p.$(parent).attr("hidden") !== undefined || p.$(parent).attr("aria-hidden") === "true" || style.includes("display:none") || style.includes("visibility:hidden");
    });
    if (hiddenAncestor) return false;

    const style = (p.$(el).attr("style") ?? "").replace(/\s+/g, "").toLowerCase();
    return p.$(el).attr("hidden") === undefined && p.$(el).attr("aria-hidden") !== "true" && !style.includes("display:none") && !style.includes("visibility:hidden");
  });

  const headingStats = pages.map((p) => {
    const h1s = visibleHeadings(p, "h1");
    const h1Text = h1s.length === 1 ? p.$(h1s[0]).text().replace(/\s+/g, " ").trim() : "";
    const headings = visibleHeadings(p);

    const skippedSequences: string[] = [];
    const hierarchyOk = headings.every((el, index, arr) => {
      if (index === 0) return true;

      const current = Number(String(p.$(el).prop("tagName") ?? "").slice(1));
      const previous = Number(String(p.$(arr[index - 1]).prop("tagName") ?? "").slice(1));
      if (current - previous > 1) skippedSequences.push(`H${previous} → H${current}: ${p.$(el).text().replace(/\s+/g, " ").trim().slice(0, 100)}`);
      return current - previous <= 1;
    });

    return {
      url: p.finalUrl,
      hasUsableH1: h1s.length >= 1,
      hasOneH1: h1s.length === 1,
      h1LengthOk: h1Text.length >= 10 && h1Text.length <= 90,
      hierarchyOk,
      skippedSequences
    };
  });

  const headingPassRate = (key: "hasUsableH1" | "hasOneH1" | "h1LengthOk" | "hierarchyOk") => {
    if (!headingStats.length) return 0;
    return headingStats.filter((item) => item[key]).length / headingStats.length;
  };

  const headingEvidence = (key: "hasUsableH1" | "hasOneH1" | "h1LengthOk" | "hierarchyOk", label: string) => {
    const passed = headingStats.filter((item) => item[key]).length;
    const failedUrls = headingStats.filter((item) => !item[key]).map((item) => item.url);
    return countEvidence(passed, headingStats.length, failedUrls, label);
  };

  const usableH1Rate = headingPassRate("hasUsableH1");
  const singleH1Rate = headingPassRate("hasOneH1");
  add(24, usableH1Rate >= 0.7 || singleH1Rate >= 0.6, headingEvidence("hasOneH1", "have exactly one visible H1"));

  const h1LengthFailures = headingStats.filter((item) => !item.h1LengthOk);
  add(25, h1LengthFailures.length === 0, headingEvidence("h1LengthOk", "have H1 length between 10 and 90 characters"), { severity: "ADVISORY", weight: 0, warning: h1LengthFailures.length > 0 });

  const hierarchyFailures = headingStats.filter((item) => !item.hierarchyOk);
  add(26, hierarchyFailures.length === 0, JSON.stringify({
    scope: "page-level-site-wide",
    pagesCrawled: pages.length,
    pagesChecked: pages.length,
    pagesPassed: pages.length - hierarchyFailures.length,
    pagesFailed: hierarchyFailures.length,
    passRate: pages.length ? Number((((pages.length - hierarchyFailures.length) / pages.length) * 100).toFixed(1)) : 100,
    affectedPages: hierarchyFailures.slice(0, 10).map((item) => ({
      url: item.url,
      issueCount: item.skippedSequences.length,
      sampleEvidence: item.skippedSequences.slice(0, 3)
    })),
    sampleEvidence: hierarchyFailures.slice(0, 10).map((item) => ({ url: item.url, skippedSequences: item.skippedSequences.slice(0, 3) }))
  }), { severity: "ADVISORY", weight: 0, warning: hierarchyFailures.length > 0 });
  const h1ByUrl = new Map(pages.map((candidate) => {
    const firstVisibleH1 = visibleHeadings(candidate, "h1")[0];
    const value = firstVisibleH1 ? candidate.$(firstVisibleH1).text().replace(/\s+/g, " ").trim().toLowerCase() : "";
    return [candidate.finalUrl, value] as const;
  }));
  const h1TextCounts = [...h1ByUrl.values()].filter(Boolean).reduce((counts, value) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const duplicateH1Urls = [...h1ByUrl.entries()].filter(([, value]) => value && (h1TextCounts.get(value) ?? 0) > 1).map(([pageUrl]) => pageUrl);
  add(239, duplicateH1Urls.length === 0, countEvidence(pages.length - duplicateH1Urls.length, pages.length, duplicateH1Urls, "Duplicate H1 text"));
  const canonicalPresence = pagePassRate((p) => Boolean(linkHrefByRel(p.$, "canonical")));
  add(27, canonicalPresence.rate >= 0.9, pageRateEvidence(canonicalPresence, "contain a canonical tag", (p) => Boolean(linkHrefByRel(p.$, "canonical"))));
  add(28, canonicalSelfRef.rate >= 0.9, `${canonicalSelfRef.passed}/${canonicalSelfRef.total} pages have self-referencing canonical (${canonicalSelfRef.percent}%)${failedPageUrls((p) => {
    const value = linkHrefByRel(p.$, "canonical");
    const resolved = value ? absolute(new URL(p.finalUrl), value) : "";
    return Boolean(resolved) && comparableCanonicalUrl(resolved) === comparableCanonicalUrl(p.finalUrl);
  }).length ? `; sampleUrls: ${failedPageUrls((p) => {
    const value = linkHrefByRel(p.$, "canonical");
    const resolved = value ? absolute(new URL(p.finalUrl), value) : "";
    return Boolean(resolved) && comparableCanonicalUrl(resolved) === comparableCanonicalUrl(p.finalUrl);
  }).join(", ")}` : ""}`);
  add(29, !canonicalAbs || await fetchPage(canonicalAbs, 1800).then(robotsContentAllowsIndex).catch(() => false), "canonical indexability checked");
  add(30, !/[?&]page=|\/page\//i.test(url.toString()) || page.$("link[rel='next'],link[rel='prev']").length > 0, "pagination signal");
  add(31, !slashDuplicateFailed, JSON.stringify({
    pagesCrawled: pages.length,
    pagesChecked: slashVariant ? 1 : 0,
    pagesPassed: slashDuplicateFailed ? 0 : slashVariant ? 1 : 0,
    pagesFailed: slashDuplicateFailed ? 1 : 0,
    affectedPages: slashDuplicateFailed ? [{ url: page.finalUrl, issueCount: 1 }] : [],
    requestedVariant: slashVariantUrl,
    status: slashVariant?.response.status ?? 0,
    redirected: slashVariant?.response.redirected ?? false,
    finalUrl: slashVariant?.response.url ?? "",
    contentSimilarity: Number(slashSimilarity.toFixed(2))
  }), { skipped: !slashVariant });
  const indexableRate = pagePassRate(robotsContentAllowsIndex);
  const snippetRate = pagePassRate((p) => !metaRobots(p).includes("nosnippet") && !metaRobots(p).includes("max-snippet:0"));
  const rawContentRate = pagePassRate((p) => p.wordCount >= 50);
  add(32, indexableRate.rate >= 0.95, pageRateEvidence(indexableRate, "are indexable", robotsContentAllowsIndex));
  add(33, snippetRate.rate >= 0.95, pageRateEvidence(snippetRate, "allow snippets", (p) => !metaRobots(p).includes("nosnippet") && !metaRobots(p).includes("max-snippet:0")));
  add(34, rawContentRate.rate >= 0.85, pageRateEvidence(rawContentRate, "contain at least 50 body words in raw HTML", (p) => p.wordCount >= 50));
  const brokenInternalEvidenceRaw = brokenInternalLinks.flatMap((broken) => pages.flatMap((sourcePage) =>
    sourcePage.$("a[href]").toArray()
      .filter((el) => comparableCanonicalUrl(broken.url) === comparableCanonicalUrl(absolute(new URL(sourcePage.finalUrl), sourcePage.$(el).attr("href") ?? "")))
      .map((el) => ({
        brokenUrl: broken.url,
        finalUrl: broken.finalUrl,
        finalStatus: broken.finalStatus,
        redirectHops: broken.redirectHops,
        sourcePage: sourcePage.finalUrl,
        location: sourcePage.$(el).closest("footer").length
          ? "shared footer"
          : sourcePage.$(el).closest("nav,header").length
            ? "shared navigation"
            : "page content"
      }))
  ));
  const brokenInternalEvidence = dedupeBrokenLinkEvidence(brokenInternalEvidenceRaw);
  const brokenInternalDestinations = new Map<string, string>();
  brokenInternalLinks.forEach((broken) => {
    const key = comparableCanonicalUrl(broken.url);
    if (!brokenInternalDestinations.has(key)) brokenInternalDestinations.set(key, broken.url);
  });
  const brokenInternalGroups = [...brokenInternalDestinations.entries()].map(([normalizedBrokenUrl, brokenUrl]) => {
    const matches = brokenInternalEvidence.filter((item) => comparableCanonicalUrl(item.brokenUrl) === normalizedBrokenUrl);
    const affected = [...new Set(matches.map((item) => item.sourcePage))];
    const locations = [...new Set(matches.map((item) => item.location))];
    return {
      brokenUrl,
      finalUrl: matches[0]?.finalUrl,
      finalStatus: matches[0]?.finalStatus,
      redirectHops: matches[0]?.redirectHops,
      affectedPages: affected.length,
      locations,
      sampleAffectedPages: affected.slice(0, 10),
      evidence: matches.map((item) => ({
        brokenUrl: item.brokenUrl,
        finalUrl: item.finalUrl,
        finalStatus: item.finalStatus,
        redirectHops: item.redirectHops,
        sourcePage: item.sourcePage
      }))
    };
  });
  const brokenInternalAffectedPages = [...new Set(brokenInternalEvidence.map((item) => item.sourcePage))];
  add(35, brokenInternalLinks.length === 0, JSON.stringify({
    scope: "page-level-site-wide",
    brokenLinks: brokenInternalDestinations.size,
    uniqueBrokenUrls: brokenInternalDestinations.size,
    pagesCrawled: pages.length,
    pagesChecked: pages.length,
    linkTargetsChecked: internalLinkTargets.length,
    pagesPassed: pages.length - brokenInternalAffectedPages.length,
    pagesFailed: brokenInternalAffectedPages.length,
    passRate: pages.length ? Number((((pages.length - brokenInternalAffectedPages.length) / pages.length) * 100).toFixed(1)) : 100,
    affectedPages: brokenInternalAffectedPages.slice(0, 10).map((sourcePage) => ({
      url: sourcePage,
      issueCount: brokenInternalEvidence.filter((item) => item.sourcePage === sourcePage).length,
      sampleEvidence: brokenInternalEvidence.filter((item) => item.sourcePage === sourcePage).slice(0, 3)
    })),
    brokenUrlGroups: brokenInternalGroups.slice(0, 10),
    brokenLinkEvidence: brokenInternalEvidence.map((item) => ({
      brokenUrl: item.brokenUrl,
      finalUrl: item.finalUrl,
      finalStatus: item.finalStatus,
      redirectHops: item.redirectHops,
      sourcePage: item.sourcePage
    })),
    sampleEvidence: brokenInternalGroups.slice(0, 10)
  }));
  const redirectHopRate = pagePassRate((candidate) => candidate.redirectHops <= 1);
  add(36, redirectHopRate.rate >= 0.9, pageRateEvidence(redirectHopRate, "use no more than one redirect hop", (candidate) => candidate.redirectHops <= 1));
  add(37, pages.every((p) => (p as FetchedPage & { depth?: number }).depth === undefined || ((p as FetchedPage & { depth?: number }).depth ?? 0) <= 3), pageCountEvidence);
  add(38, true, "orphan detection requires external indexed URL corpus; crawl graph accepted");
  const hiddenContentRate = pagePassRate((p) => p.$("[style*='display:none'],[hidden]").toArray().reduce((sum, el) => sum + wordCount(p.$(el).text()), 0) < 100);
  const infiniteScrollAudit = infiniteScrollAuditEvidence(pages);
  const cookieWallRate = pagePassRate((p) => p.wordCount > 80 || !/cookie|consent/i.test(p.html));
  const underscoreRate = pagePassRate((p) => !new URL(p.finalUrl).pathname.includes("_"));
  const urlLengthRate = pagePassRate((p) => p.finalUrl.length <= 115);
  const lowercasePathRate = pagePassRate((p) => new URL(p.finalUrl).pathname === new URL(p.finalUrl).pathname.toLowerCase());
  const trailingSlashRedirects = await Promise.all(pages.map((p) => trailingSlashVariantRedirect(p.finalUrl)));
  const slashConsistencyRate = passRate(trailingSlashRedirects, (item) => item.passed);
  const slashConsistencyEvidence = JSON.stringify({
    scope: "page-level-site-wide",
    pagesCrawled: pages.length,
    pagesChecked: slashConsistencyRate.total,
    pagesPassed: slashConsistencyRate.passed,
    pagesFailed: slashConsistencyRate.total - slashConsistencyRate.passed,
    passRate: slashConsistencyRate.percent,
    affectedPages: trailingSlashRedirects
      .filter((item) => !item.passed)
      .slice(0, 10)
      .map((item) => ({ url: item.url, issueCount: 1, sampleEvidence: item.reason })),
    sampleEvidence: trailingSlashRedirects
      .filter((item) => !item.passed)
      .slice(0, 10)
      .map((item) => ({
        url: item.url,
        variantUrl: item.variantUrl,
        status: item.status,
        location: item.location,
        targetUrl: item.targetUrl,
        issue: item.reason
      }))
  });
  add(39, hiddenContentRate.rate >= 0.9, pageRateEvidence(hiddenContentRate, "avoid large hidden-content blocks", (p) => p.$("[style*='display:none'],[hidden]").toArray().reduce((sum, el) => sum + wordCount(p.$(el).text()), 0) < 100));
  if (infiniteScrollAudit.detected) {
    add(40, infiniteScrollAudit.pass, infiniteScrollAudit.evidence, { severity: "ADVISORY", weight: 0, warning: !infiniteScrollAudit.pass });
  }
  add(41, cookieWallRate.rate >= 0.9, pageRateEvidence(cookieWallRate, "avoid consent-wall blocking patterns", (p) => p.wordCount > 80 || !/cookie|consent/i.test(p.html)));
  add(42, underscoreRate.rate >= 0.95, pageRateEvidence(underscoreRate, "avoid underscores in URL paths", (p) => !new URL(p.finalUrl).pathname.includes("_")));
  add(43, urlLengthRate.rate >= 0.9, pageRateEvidence(urlLengthRate, "have URLs <= 115 characters", (p) => p.finalUrl.length <= 115));
  add(44, lowercasePathRate.rate >= 0.95, pageRateEvidence(lowercasePathRate, "use lowercase URL paths", (p) => new URL(p.finalUrl).pathname === new URL(p.finalUrl).pathname.toLowerCase()));
  add(45, slashConsistencyRate.rate >= 0.9, slashConsistencyEvidence);
  add(46, lcp !== undefined && lcp <= 2500, lcp !== undefined ? JSON.stringify({ metric: "LCP", measuredValue: Math.round(lcp), unit: "ms", threshold: 2500, source: crux?.lcp !== undefined ? "CrUX" : "PageSpeed Insights" }) : psiUnavailableEvidence, { skipped: lcp === undefined });
  add(47, inp !== undefined && inp <= 200, inp !== undefined ? JSON.stringify({ metric: "INP", measuredValue: Math.round(inp), unit: "ms", threshold: 200, source: crux?.inp !== undefined ? "CrUX" : "PageSpeed Insights" }) : psiUnavailableEvidence, { skipped: inp === undefined });
  add(48, cls !== undefined && cls <= 0.1, cls !== undefined ? JSON.stringify({ metric: "CLS", measuredValue: cls, threshold: 0.1, source: crux?.cls !== undefined ? "CrUX" : "PageSpeed Insights" }) : psiUnavailableEvidence, { skipped: cls === undefined });
  add(49, ttfb !== undefined && ttfb <= 800, ttfb !== undefined ? JSON.stringify({ metric: "TTFB", measuredValue: Math.round(ttfb), unit: "ms", threshold: 800, source: crux?.ttfb !== undefined ? "CrUX" : "PageSpeed Insights" }) : psiUnavailableEvidence, { skipped: ttfb === undefined });
  add(50, pageImages.every((item) => item.missingDimensions === 0), imageEvidence(`${pageImages.reduce((sum, item) => sum + item.missingDimensions, 0)} images missing dimensions`, missingDimensionImageSamples));
  add(51, !firstImgLazy, "first image loading attribute");
  add(52, !/@font-face/i.test(page.html) || /font-display\s*:\s*swap/i.test(page.html), "font-face CSS scanned");
  add(53, everyPage((p) => p.$("head script[src]:not([async]):not([defer]):not([type='module'])").length === 0), pageCountEvidence);
  add(54, everyPage((p) => p.$("head style").text().trim().length > 0), pageCountEvidence);
  add(55, somePage((p) => hasImagePreloadHint(p.$)), pageCountEvidence);
  add(56, mobileScore !== undefined && mobileScore >= 90, mobileScore !== undefined ? `${mobileScore} via PageSpeed Insights` : psiUnavailableEvidence, { skipped: mobileScore === undefined, warning: performanceScoreWarning(mobileScore) });
  add(57, tapTargetsPass !== undefined ? tapTargetsPass : viewport.includes("width=device-width"), tapTargetsPass !== undefined ? `PageSpeed tap-targets ${tapTargetsPass ? "passed" : "failed"}` : "Local tap-target fallback");
  add(58, viewportDebug.passed, viewportDebugEvidence);
  add(59, mobileScore !== undefined && mobileScore >= 90, mobileScore !== undefined ? `${mobileScore} via PageSpeed Insights` : psiUnavailableEvidence, { skipped: mobileScore === undefined, warning: performanceScoreWarning(mobileScore) });
  add(60, tapTargetsPass !== undefined ? tapTargetsPass : viewport.includes("width=device-width"), tapTargetsPass !== undefined ? `PageSpeed tap-targets ${tapTargetsPass ? "passed" : "failed"}` : "Local tap-target fallback");
  add(61, imageAggregate.altRate >= 0.9, imageEvidence(`${imageAggregate.altPresent}/${imageAggregate.nonDecorativeCount} non-decorative images have alt text (${Math.round(imageAggregate.altRate * 100)}%)`, missingAltImageSamples));
  add(62, imageAggregate.chartDetailedRate >= 0.3, imageAggregate.chartCount ? `${imageAggregate.chartDetailedAlt}/${imageAggregate.chartCount} chart/data images have descriptive alt text (${Math.round(imageAggregate.chartDetailedRate * 100)}%)` : "No chart/data/infographic images detected");
  add(63, imageAggregate.dimensionsRate >= 0.9, imageEvidence(`${imageAggregate.dimensionsPresent}/${imageAggregate.count} images have width and height (${Math.round(imageAggregate.dimensionsRate * 100)}%)`, missingDimensionImageSamples));
  add(64, imageAggregate.belowFoldLazyRate >= 0.8, imageAggregate.belowFoldCount ? imageEvidence(`${imageAggregate.belowFoldLazy}/${imageAggregate.belowFoldCount} below-fold images lazy-loaded (${Math.round(imageAggregate.belowFoldLazyRate * 100)}%)`, nonLazyBelowFoldImageSamples) : "No below-fold images detected");
  add(65, imageAggregate.modernRate >= 0.4, imageEvidence(`${imageAggregate.modern}/${imageAggregate.count} images use WebP or AVIF (${Math.round(imageAggregate.modernRate * 100)}%)`, nonModernImageSamples));
  add(66, imageAggregate.genericRate < 0.5, imageEvidence(`${imageAggregate.generic}/${imageAggregate.count} images use obviously generic filenames (${Math.round(imageAggregate.genericRate * 100)}%)`, genericImageSamples));
  add(67, Boolean(footerPrivacy), JSON.stringify({
    pagesCrawled: pages.length,
    pagesChecked: 1,
    pagesPassed: footerPrivacy ? 1 : 0,
    pagesFailed: footerPrivacy ? 0 : 1,
    affectedPages: footerPrivacy ? [] : [{ url: page.finalUrl, issueCount: 1 }],
    footerLinkDetected: Boolean(footerPrivacy)
  }));
  add(68, Boolean(footerTerms), JSON.stringify({
    pagesCrawled: pages.length,
    pagesChecked: 1,
    pagesPassed: footerTerms ? 1 : 0,
    pagesFailed: footerTerms ? 0 : 1,
    affectedPages: footerTerms ? [] : [{ url: page.finalUrl, issueCount: 1 }],
    footerLinkDetected: Boolean(footerTerms)
  }));
  add(69, /\+?\d[\d\s().-]{7,}/.test(contactText) && /\b(street|road|avenue|lane|floor|city|india|usa|uk)\b/i.test(contactText), "contact NAP scan");
  add(70, aboutWords >= 200, `${aboutWords} about-page words`, { severity: "ADVISORY", weight: 0, warning: aboutWords < 200 });
  add(71, /cookie/i.test(page.html), "cookie consent hint");
  add(72, /gzip|br/i.test(page.headers.get("content-encoding") ?? ""), page.headers.get("content-encoding") ?? "missing");
  add(73, everyPage((p) => p.$("head script[src]:not([async]):not([defer]):not([type='module'])").length === 0), pageCountEvidence);
  add(74, everyPage((p) => p.$("head style").text().trim().length > 0), pageCountEvidence);
  add(75, somePage((p) => hasImagePreloadHint(p.$)), pageCountEvidence);
  const modernImagePageRate = passRate(pageImages, (item) => item.modernRatio >= 0.7);
  const jsonLdPageRate = passRate(pageLd, (item) => item.blocks.length > 0);
  const jsonLdFailures = pageLd.filter((item) => item.errors.length > 0);
  add(76, modernImagePageRate.rate >= 0.75, `${modernImagePageRate.passed}/${modernImagePageRate.total} pages have at least 70% WebP/AVIF images (${modernImagePageRate.percent}%)`);
  add(77, jsonLdPageRate.rate >= 0.5 || ld.blocks.length > 0, `${jsonLdPageRate.passed}/${jsonLdPageRate.total} pages contain JSON-LD blocks (${jsonLdPageRate.percent}%)`);
  add(78, jsonLdFailures.length === 0, JSON.stringify({
    pagesCrawled: pages.length,
    pagesChecked: pageLd.length,
    pagesPassed: pageLd.length - jsonLdFailures.length,
    pagesFailed: jsonLdFailures.length,
    affectedPages: jsonLdFailures.slice(0, 10).map((item) => ({
      url: item.page.finalUrl,
      issueCount: item.errors.length,
      sampleEvidence: item.errors.slice(0, 3)
    })),
    parseErrors: jsonLdFailures.slice(0, 10).flatMap((item) => item.errors.map((error) => ({ url: item.page.finalUrl, error })))
  }));
  add(79, allLdBlocks.every((block) => {
    const context = (block as Record<string, unknown>)?.["@context"];
    return typeof context === "string" ? context.includes("schema.org") : true;
  }), "JSON-LD contexts checked");
  add(80, hasSchemaType(ld.blocks, /Organization/), ldTypes.join(", ") || "none");
  const organizationPages = pages.filter((candidate) => hasSchemaType(jsonLd(candidate).blocks, /Organization|Corporation|LocalBusiness/));
  const organizationSameAsPages = organizationPages.filter((candidate) => /"sameAs"\s*:\s*(?:\[|")/.test(candidate.html));
  const organizationSameAsMissing = organizationPages.filter((candidate) => !organizationSameAsPages.includes(candidate));
  add(81, organizationPages.length === 0 || organizationSameAsMissing.length === 0, JSON.stringify({
    scope: "page-level-site-wide",
    pagesCrawled: pages.length,
    pagesChecked: organizationPages.length,
    pagesPassed: organizationSameAsPages.length,
    pagesFailed: organizationSameAsMissing.length,
    passRate: organizationPages.length ? Number(((organizationSameAsPages.length / organizationPages.length) * 100).toFixed(1)) : 100,
    affectedPages: organizationSameAsMissing.slice(0, 10).map((candidate) => ({ url: candidate.finalUrl, issueCount: 1 })),
    sampleEvidence: organizationSameAsMissing.slice(0, 10).map((candidate) => ({
      url: candidate.finalUrl,
      issue: "Organization schema has no verified sameAs links. This property is optional."
    }))
  }), {
    severity: "ADVISORY",
    weight: 0,
    warning: organizationSameAsMissing.length > 0
  });
  add(82, hasSchemaType(allLdBlocks, /WebSite/) && pages.some((p) => /SearchAction/.test(p.html)), "WebSite/SearchAction schema");
  add(83, !samplePages.length || samplePages.every((p) => hasSchemaType(jsonLd(p).blocks, /BreadcrumbList/)), `${samplePages.length} interior pages crawled`);
  const articleApplicablePages = pages.filter((p) => /blog|article/i.test(new URL(p.finalUrl).pathname));
  const faqSignalsByUrl = new Map(pages.map((candidate) => [candidate.finalUrl, visibleFaqSignals(candidate)]));
  const faqApplicablePages = pages.filter((p) => faqSignalsByUrl.get(p.finalUrl)?.applicable);
  const howToApplicablePages = pages.filter((p) => /how-to|how to/i.test(`${new URL(p.finalUrl).pathname} ${p.$("h1").first().text().trim()}`));
  const localServiceApplicablePages = pages.filter((p) => {
    const visible = `${new URL(p.finalUrl).pathname} ${p.$("h1").first().text()} ${p.$("body").text()}`;
    const localSignals = [
      /\b(location|directions|visit us|near me|local)\b/i.test(visible),
      /\b(opening hours|business hours|address)\b/i.test(visible),
      p.$("address,iframe[src*='google.com/maps'],a[href^='tel:']").length > 0
    ].filter(Boolean).length;
    return localSignals >= 2;
  });
  const pageTypeSchemaEvidence = (
    applicablePages: FetchedPage[],
    schemaPattern: RegExp,
    issue: string
  ) => {
    const failed = applicablePages.filter((candidate) => !hasSchemaType(jsonLd(candidate).blocks, schemaPattern));
    return JSON.stringify({
      scope: "page-level-site-wide",
      pagesCrawled: pages.length,
      pagesChecked: applicablePages.length,
      pagesPassed: applicablePages.length - failed.length,
      pagesFailed: failed.length,
      passRate: applicablePages.length ? Number((((applicablePages.length - failed.length) / applicablePages.length) * 100).toFixed(1)) : 100,
      affectedPages: failed.slice(0, 10).map((candidate) => ({
        url: candidate.finalUrl,
        issueCount: 1,
        sampleEvidence: issue
      })),
      sampleEvidence: failed.slice(0, 10).map((candidate) => ({ url: candidate.finalUrl, issue }))
    });
  };
  const faqPageSchemaEvidence = () => {
    const failed = faqApplicablePages.filter((candidate) => !hasSchemaType(jsonLd(candidate).blocks, /FAQPage/));
    return JSON.stringify({
      scope: "page-level-site-wide",
      pagesCrawled: pages.length,
      pagesChecked: faqApplicablePages.length,
      pagesPassed: faqApplicablePages.length - failed.length,
      pagesFailed: failed.length,
      passRate: faqApplicablePages.length ? Number((((faqApplicablePages.length - failed.length) / faqApplicablePages.length) * 100).toFixed(1)) : 100,
      affectedPages: failed.slice(0, 10).map((candidate) => {
        const signals = faqSignalsByUrl.get(candidate.finalUrl);
        return {
          url: candidate.finalUrl,
          issueCount: 1,
          sampleEvidence: {
            issue: "FAQPage schema is missing where visible FAQ content exists",
            visibleFaqHeading: signals?.hasFaqHeading ?? false,
            visibleFaqQuestions: signals?.questions ?? 0,
            visibleFaqContainers: signals?.containers ?? 0
          }
        };
      }),
      sampleEvidence: failed.slice(0, 10).map((candidate) => {
        const signals = faqSignalsByUrl.get(candidate.finalUrl);
        return {
          url: candidate.finalUrl,
          issue: "FAQPage schema is missing where visible FAQ content exists",
          visibleFaqHeading: signals?.hasFaqHeading ?? false,
          visibleFaqQuestions: signals?.questions ?? 0,
          visibleFaqContainers: signals?.containers ?? 0
        };
      })
    });
  };
  const personSchemaRate = pagePassRate((p) => !/author|team/i.test(new URL(p.finalUrl).pathname) || hasSchemaType(jsonLd(p).blocks, /Person/));
  const productSchemaRate = pagePassRate((p) => {
    const visible = `${new URL(p.finalUrl).pathname} ${p.$("h1").first().text()} ${p.$("body").text()}`;
    const productPage = /\/(products?|shop|store|p)\//i.test(new URL(p.finalUrl).pathname)
      || p.$("[itemprop='price'],[data-product-id],button[name='add'],form[action*='cart']").length > 0
      || /\b(add to cart|buy now|sku|in stock|out of stock)\b/i.test(visible);
    return !productPage || hasSchemaType(jsonLd(p).blocks, /Product/);
  });
  const priceParityRate = pagePassRate((p) => !/"price"\s*:/.test(p.html) || /\$|₹|€|£|\bprice\b/i.test(p.$("body").text()));
  add(84, articleApplicablePages.every((candidate) => hasSchemaType(jsonLd(candidate).blocks, /Article|BlogPosting/)), pageTypeSchemaEvidence(articleApplicablePages, /Article|BlogPosting/, "Article schema is missing on a detected article/blog page"), { skipped: articleApplicablePages.length === 0 });
  add(85, faqApplicablePages.every((candidate) => hasSchemaType(jsonLd(candidate).blocks, /FAQPage/)), faqPageSchemaEvidence(), { skipped: faqApplicablePages.length === 0 });
  add(86, howToApplicablePages.every((candidate) => hasSchemaType(jsonLd(candidate).blocks, /HowTo/)), pageTypeSchemaEvidence(howToApplicablePages, /HowTo/, "HowTo schema is missing on a detected step-by-step page"), { skipped: howToApplicablePages.length === 0 });
  add(87, localServiceApplicablePages.every((candidate) => hasSchemaType(jsonLd(candidate).blocks, /LocalBusiness|ProfessionalService|MedicalBusiness|MedicalClinic|Physician|Dentist/)), pageTypeSchemaEvidence(localServiceApplicablePages, /LocalBusiness|ProfessionalService|MedicalBusiness|MedicalClinic|Physician|Dentist/, "LocalBusiness schema is missing on a page with clear local-business signals"), { skipped: localServiceApplicablePages.length === 0 });
  add(88, personSchemaRate.rate >= 0.8, pageRateEvidence(personSchemaRate, "have Person schema when they look like author/team pages"));
  add(89, productSchemaRate.rate >= 0.8, pageRateEvidence(productSchemaRate, "have Product schema when they look like product/pricing pages"));
  add(90, priceParityRate.rate >= 0.95, pageRateEvidence(priceParityRate, "keep schema price visible in DOM"));
  add(91, jsonLdFailures.length === 0, JSON.stringify({
    pagesCrawled: pages.length,
    pagesChecked: pageLd.length,
    pagesPassed: pageLd.length - jsonLdFailures.length,
    pagesFailed: jsonLdFailures.length,
    affectedPages: jsonLdFailures.slice(0, 10).map((item) => ({
      url: item.page.finalUrl,
      issueCount: item.errors.length,
      sampleEvidence: item.errors.slice(0, 3)
    })),
    validationFailures: jsonLdFailures.slice(0, 10).flatMap((item) => item.errors.map((error) => ({ url: item.page.finalUrl, error }))),
    validationSource: "Local JSON-LD parser; external Rich Results API not connected"
  }));
  const ogTitleRate = pagePassRate((p) => Boolean(p.$("meta[property='og:title']").attr("content")?.trim()));
  const ogDescriptionRate = pagePassRate((p) => Boolean(p.$("meta[property='og:description']").attr("content")?.trim()));
  add(92, ogTitleRate.rate >= 0.8, pageRateEvidence(ogTitleRate, "contain og:title"));
  add(93, ogDescriptionRate.rate >= 0.8, pageRateEvidence(ogDescriptionRate, "contain og:description"));
  const ogImageChecks = await mapWithConcurrency(pages, 12, async (candidate) => {
    const imageUrl = absolute(new URL(candidate.finalUrl), candidate.$("meta[property='og:image']").attr("content") ?? "");
    return { page: candidate, imageUrl, passed: Boolean(imageUrl) && await fetchImageHeadOk(imageUrl) };
  });
  const ogImagePassed = ogImageChecks.filter((item) => item.passed).length;
  add(94, ogImagePassed / Math.max(ogImageChecks.length, 1) >= 0.9, countEvidence(ogImagePassed, ogImageChecks.length, ogImageChecks.filter((item) => !item.passed).map((item) => item.page.finalUrl), "Missing or invalid og:image"));
  const twitterMetadataPassed = ["twitter:card", "twitter:title", "twitter:description"].every((name) => metaContentByName(page.$, name));
  add(95, twitterMetadataPassed, "Twitter card tags", { severity: "ADVISORY", weight: 0, warning: !twitterMetadataPassed });
  const internalLinkDepthRate = pagePassRate((p) => internalLinks(p, new URL(p.finalUrl)).length >= 3);
  add(96, internalLinkDepthRate.rate >= 0.75, pageRateEvidence(internalLinkDepthRate, "have at least 3 internal links"));
  add(97, allInternalLinks.every((link) => !GENERIC_ANCHORS.has(link.text)), "anchor text scanned");
  add(98, true, "orphan detection requires external indexed URL corpus; crawl graph accepted");
  add(99, pages.every((p) => (p as FetchedPage & { depth?: number }).depth === undefined || ((p as FetchedPage & { depth?: number }).depth ?? 0) <= 3), pageCountEvidence);
  const semanticHtmlRate = pagePassRate((p) => p.$("article,section,main,aside,header,footer").length >= 3);
  const tableCaptionRate = pagePassRate((p) => p.$("table").toArray().every((el) => p.$(el).find("caption").length > 0));
  const timeDatetimeRate = pagePassRate((p) => p.$("time").toArray().every((el) => Boolean(p.$(el).attr("datetime"))));
  add(100, semanticHtmlRate.rate === 1, pageRateEvidence(semanticHtmlRate, "use at least 3 semantic HTML5 elements", (p) => p.$("article,section,main,aside,header,footer").length >= 3), { severity: "ADVISORY", weight: 0, warning: semanticHtmlRate.rate < 1 });
  add(101, tableCaptionRate.rate === 1, pageRateEvidence(tableCaptionRate, "give tables captions when tables exist", (p) => p.$("table").toArray().every((el) => p.$(el).find("caption").length > 0)), { severity: "ADVISORY", weight: 0, warning: tableCaptionRate.rate < 1 });
  add(102, timeDatetimeRate.rate >= 0.9, pageRateEvidence(timeDatetimeRate, "use datetime on time elements"));
  add(103, imageAggregate.altRate >= 0.9, imageEvidence(`${imageAggregate.altPresent}/${imageAggregate.nonDecorativeCount} non-decorative images have alt text (${Math.round(imageAggregate.altRate * 100)}%)`, missingAltImageSamples));
  add(104, interactiveLabelRate >= 0.8, `${interactiveAggregate.labelled}/${interactiveAggregate.total} label-required interactive elements labelled (${Math.round(interactiveLabelRate * 100)}%)`);
  const htmlLangRate = pagePassRate((p) => Boolean(p.$("html").attr("lang")));
  add(105, htmlLangRate.rate >= 0.95, pageRateEvidence(htmlLangRate, "set html lang"));
  add(106, !hasLanguageAlternates || hreflangs > 0, `${hreflangs} hreflang tags`);
  const wordCountRate = pagePassRate((p) => p.wordCount >= (/blog|article/i.test(new URL(p.finalUrl).pathname) ? 500 : 180));
  const publishedDateRate = pagePassRate((p) => p.$("time[datetime]").length > 0 || /datePublished/.test(p.html) || !/blog|article/i.test(new URL(p.finalUrl).pathname));
  const modifiedDateRate = pagePassRate((p) => /dateModified|last-modified/i.test(p.html) || p.headers.has("last-modified") || !/blog|article/i.test(new URL(p.finalUrl).pathname));
  const authorBylineRate = pagePassRate((p) => /author|byline|rel=.author.|itemprop=.author./i.test(p.html) || !/blog|article/i.test(new URL(p.finalUrl).pathname));
  add(107, wordCountRate.rate >= 0.75, pageRateEvidence(wordCountRate, "meet practical word-count depth thresholds"));
  add(108, publishedDateRate.rate >= 0.8, pageRateEvidence(publishedDateRate, "show published dates on article-like pages"));
  add(109, modifiedDateRate.rate >= 0.8, pageRateEvidence(modifiedDateRate, "show modified dates on article-like pages"));
  add(110, authorBylineRate.rate >= 0.8, pageRateEvidence(authorBylineRate, "show author signals on article-like pages"));
  add(111, somePage((p) => p.$("a[href*='/author/'],a[href*='/team/']").length > 0), pageCountEvidence);
  const outboundLinkRate = pagePassRate((p) => p.$("a[href]").toArray().filter((el) => {
    const href = p.$(el).attr("href") ?? "";
    return href.startsWith("http") && !sameOrigin(new URL(p.finalUrl), href);
  }).length >= 2);
  add(112, outboundLinkRate.rate >= 0.5, pageRateEvidence(outboundLinkRate, "include at least 2 outbound citation links"));
  add(113, pages.some((p) => p.$("[class*='review'],[class*='testimonial'],[id*='review'],[id*='testimonial']").length > 0 || ((p.$("body").text().match(/\b(review|reviews|testimonial|testimonials|rating|ratings|stars?|customer stories)\b/gi) ?? []).length >= 2)), pageCountEvidence);
  add(114, llms?.response.status === 200 && /text|plain|markdown/i.test(llmsContentType) && llmsWordStats.words >= 100 && llmsWordStats.sections >= 2, `Status ${llms?.response.status ?? "missing"}, ${llmsWordStats.words} words, ${llmsWordStats.sections} sections${llmsWordStats.words >= 200 && llmsWordStats.strongSignals > 0 ? ", strong content signals" : ""}`);
  add(115, compressedTextAssets.length === 0 || compressionPercent >= 80, compressedTextAssets.length === 0 ? "0/0 text assets compressed (not detected)" : `${compressedCount}/${compressedTextAssets.length} text assets compressed (${compressionPercent}%)${compressionPercent >= 60 && compressionPercent < 80 ? " - partial coverage" : ""}`);
  add(116, headerAssetSamples.length === 0 || cachePercent >= 80, `${cacheOkCount}/${headerAssetSamples.length} assets have appropriate Cache-Control`);
  add(117, validatorHeaders.length > 0 || assetValidatorCount > 0, validatorHeaders.length ? validatorHeaders.join(", ") : assetValidatorCount > 0 ? `${assetValidatorCount}/${headerAssetSamples.length} sampled assets have ETag or Last-Modified` : "missing");
  add(118, Boolean(cdnEvidence), cdnEvidence || "No CDN/cache header signal detected");
  add(119, headerAssetSamples.length === 0 || contentTypeOkCount === headerAssetSamples.length, `${contentTypeOkCount}/${headerAssetSamples.length} sampled assets have correct Content-Type`);
  add(120, brokenExternalLinks.length === 0, externalLinkEvidence);
  add(121, trackingInternalLinks.length === 0, `${trackingInternalLinks.length} tracking-param internal links`);
  add(122, robotsBlocksInternalSearch(robots?.text ?? "") || searchLinks.length === 0, robotsBlocksInternalSearch(robots?.text ?? "") ? "Search URLs blocked in robots.txt" : searchLinks.length ? `${searchLinks.length} internal search URLs found` : "Search URLs not found");
  add(123, soft404Status === 404 || soft404Status === 410, `Fake URL returned status ${soft404Status || "missing"}${soft404Status === 200 && /\b(not found|page not found|no results|error)\b/i.test(soft404Body) ? " with soft error language" : ""}`);
  const rssFullTextPassed = Boolean(foundFeed) && avgFeedWords >= 120;
  add(125, rssFullTextPassed, foundFeed ? `Feed found at ${foundFeed.url}, avg item words ${avgFeedWords}` : "No feed found at /feed, /rss, or /atom.xml", { severity: "ADVISORY", weight: 0, warning: !rssFullTextPassed });
  add(126, true, historyMatch
    ? "History API code was detected, but no confirmed Back-button interference was observed."
    : "No suspicious history manipulation found");
  add(127, !exitIntentMatch, exitIntentMatch ? `Matched pattern: ${exitIntentMatch}` : "No exit-intent redirects found");
  add(128, apiUrls.length === 0 || corsValues.length > 0, apiUrls.length === 0 ? "No public API found" : corsValues.length ? `CORS header: ${corsValues[0]}` : `${apiUrls.length} public API endpoints found without CORS header`);
  add(129, subdomainSslResults.every((item) => item.valid), subdomainSslResults.length ? `${subdomainSslResults.filter((item) => item.valid).length}/${subdomainSslResults.length} discovered subdomains have valid SSL` : "No linked subdomains discovered");
  add(130, ssrPassCount / Math.max(pages.length, 1) >= 0.7, `${ssrPassCount}/${pages.length} pages have primary content in raw HTML`);
  add(131, emptyShells.length === 0, emptyShells.length ? `${emptyShells.length} empty-shell SPA pages found` : "No empty-shell SPA detected");
  add(132, collapsedPrimaryPages.length === 0, JSON.stringify({
    scope: "page-level-site-wide",
    pagesCrawled: pages.length,
    pagesChecked: pages.length,
    pagesPassed: pages.length - collapsedPrimaryPages.length,
    pagesFailed: collapsedPrimaryPages.length,
    passRate: pages.length ? Number((((pages.length - collapsedPrimaryPages.length) / pages.length) * 100).toFixed(1)) : 100,
    affectedPages: collapsedPrimaryPages.slice(0, 10).map((item) => ({
      url: item.pageUrl,
      issueCount: 1,
      sampleEvidence: { hiddenContentSample: item.hiddenSample, hiddenWords: item.hiddenWords, visibleWords: item.visibleWords }
    })),
    sampleEvidence: collapsedPrimaryPages.slice(0, 10)
  }));
  add(133, maxDomNodes < 1500, `${maxDomNodes} DOM nodes on largest sampled page`);
  add(134, hiddenKeywordCount === 0, `${hiddenKeywordCount} CSS-hidden keyword text blocks`);
  add(135, schemaInjection.passed, schemaInjection.evidence);
  add(137, canonicalChain.hops <= 1 && !canonicalChain.loop, `${canonicalChain.hops} canonical hops${canonicalChain.loop ? ", loop detected" : ""}`);
  add(138, medianTtfb < 200, `${Math.round(medianTtfb)}ms median TTFB`);
  add(139, aiCrawlerOk, aiCrawlerEvidence);
  if (renderedContentEvidence) add(140, renderedContentMatches, renderedContentEvidence);
  add(141, indexNowPassed, indexNowCandidates.length ? `${indexNowResponses.filter((item) => item.response?.status === 200).length}/${indexNowCandidates.length} IndexNow key files reachable` : "No IndexNow key location found", { severity: "ADVISORY", weight: 0, warning: !indexNowPassed });
  add(142, slashRedirectStatus === 0 || slashRedirectStatus === 301 || slashRedirectStatus === 308 || caseVariantStatus === 0 || caseVariantStatus === 301 || caseVariantStatus === 308 || caseVariantStatus === 404, `Slash variant status ${slashRedirectStatus || "missing"}, case variant status ${caseVariantStatus || "missing"}`);
  add(143, lcp !== undefined && lcp <= 2500, lcp !== undefined ? JSON.stringify({ metric: "LCP mobile", measuredValue: Math.round(lcp), unit: "ms", threshold: 2500 }) : psiUnavailableEvidence, { skipped: lcp === undefined, weight: 0, severity: "MAJOR" });
  add(144, lcp === undefined ? false : lcp <= 2500 ? lcp <= 1800 : true, lcp !== undefined ? JSON.stringify({ metric: "LCP competitive", measuredValue: Math.round(lcp), unit: "ms", threshold: 1800 }) : psiUnavailableEvidence, { skipped: lcp === undefined, severity: "ADVISORY", weight: 0, warning: lcp !== undefined && lcp > 1800 && lcp <= 2500 });
  add(145, desktopLcp !== undefined && desktopLcp <= 2500, desktopLcp !== undefined ? JSON.stringify({ metric: "LCP desktop", measuredValue: Math.round(desktopLcp), unit: "ms", threshold: 2500 }) : psiUnavailableEvidence, { skipped: desktopLcp === undefined });
  add(146, lcpElementFound, psi?.lcpElementFound !== undefined ? "PageSpeed LCP element audit available" : firstImgUrl || h1 || "No clear LCP candidate found");
  add(147, lcpPreloaded, lcpPreloaded ? "LCP/image preload hint detected" : "No matching image preload hint detected");
  add(148, psi?.lcpLazyLoadedPass ?? !firstImgLazy, psi?.lcpLazyLoadedPass !== undefined ? `PageSpeed lcp-lazy-loaded ${psi.lcpLazyLoadedPass ? "passed" : "failed"}` : "First image loading attribute checked");
  add(149, lcpModernFormat, JSON.stringify({
    metric: "LCP image format",
    lcpCandidate: lcpCandidateUrl || undefined,
    modernRatePercent: Math.round(imageAggregate.modernRate * 100),
    source: lcpCandidateSource
  }));
  add(150, lcpAssetBytes > 0 && lcpAssetBytes < 200000, lcpAssetBytes ? `${Math.round(lcpAssetBytes / 1024)}KB LCP candidate` : "LCP asset size unavailable", { skipped: lcpAssetBytes === 0 });
  add(151, lcpPhaseBreakdownAvailable, lcpPhaseBreakdownAvailable ? "PageSpeed LCP phase metrics available" : psiUnavailableEvidence, { skipped: !lcpPhaseBreakdownAvailable });
  add(152, inp !== undefined && inp <= 200, inp !== undefined ? JSON.stringify({ metric: "INP p75", measuredValue: Math.round(inp), unit: "ms", threshold: 200 }) : psiUnavailableEvidence, { skipped: inp === undefined });
  add(153, inp !== undefined && inp < 150, inp !== undefined ? JSON.stringify({ metric: "INP competitive", measuredValue: Math.round(inp), unit: "ms", threshold: 150 }) : JSON.stringify({ reason: "INP measurement unavailable" }), { skipped: inp === undefined });
  add(154, psi?.tbt !== undefined && psi.tbt < 200, psi?.tbt !== undefined ? `${Math.round(psi.tbt)}ms total blocking time` : "Long-task measurement unavailable", { skipped: psi?.tbt === undefined });
  add(155, taskYieldingSignals || (psi?.tbt !== undefined && psi.tbt < 200), taskYieldingSignals ? "Task yielding pattern detected" : psi?.tbt !== undefined ? `${Math.round(psi.tbt)}ms total blocking time` : "Task-yielding runtime evidence unavailable", { skipped: psi?.tbt === undefined && !taskYieldingSignals });
  add(156, thirdPartyScripts.length === 0 || deferredThirdPartyPercent >= 80, `${deferredThirdPartyCount}/${thirdPartyScripts.length} third-party scripts deferred (${deferredThirdPartyPercent}%)`);
  add(157, cls !== undefined && cls <= 0.1, cls !== undefined ? JSON.stringify({ metric: "CLS p75", measuredValue: cls, threshold: 0.1 }) : psiUnavailableEvidence, { skipped: cls === undefined });
  add(158, cls !== undefined && contentAreaClsStable, cls !== undefined ? `${cls} via API` : "Content-area CLS measurement unavailable", { skipped: cls === undefined });
  add(159, allImagesDimensionsRate >= 0.9, imageEvidence(`${imageAggregate.dimensionsPresent}/${imageAggregate.count} images have width and height (${Math.round(allImagesDimensionsRate * 100)}%)`, missingDimensionImageSamples));
  add(160, reservedAdSlots, adLikeElements.length ? `${adLikeElements.length} ad-like slots checked` : "No ad-like slots detected");
  add(161, !dynamicInjectionAbove, dynamicInjectionAbove ? "Dynamic insertion pattern detected" : "No above-content injection pattern detected");
  add(162, !/@font-face/i.test(page.html) || /font-display\s*:\s*swap/i.test(page.html), "font-face CSS scanned");
  add(163, fcp !== undefined && fcp < 1800, fcp !== undefined ? JSON.stringify({ metric: "FCP mobile", measuredValue: Math.round(fcp), unit: "ms", threshold: 1800 }) : JSON.stringify({ reason: "FCP measurement unavailable" }), { skipped: fcp === undefined });
  add(164, everyPage((p) => p.$("head script[src]:not([async]):not([defer]):not([type='module'])").length === 0), pageCountEvidence);
  add(165, everyPage((p) => p.$("head style").text().trim().length > 0), pageCountEvidence);
  add(166, ttfb !== undefined && ttfb <= 800, ttfb !== undefined ? JSON.stringify({ metric: "TTFB", measuredValue: Math.round(ttfb), unit: "ms", threshold: 800, source: crux?.ttfb !== undefined ? "CrUX" : "PageSpeed Insights" }) : psiUnavailableEvidence, { skipped: ttfb === undefined });
  add(167, Math.max(...ttfbSamples) - Math.min(...ttfbSamples) < 300, `${Math.round(Math.max(...ttfbSamples) - Math.min(...ttfbSamples))}ms TTFB variance`);
  add(168, Boolean(cdnEvidence), cdnEvidence || "No CDN/cache header signal detected");
  add(169, mobileScore !== undefined && mobileScore >= 90, mobileScore !== undefined ? `${mobileScore} via PageSpeed Insights` : psiUnavailableEvidence, { skipped: mobileScore === undefined, warning: performanceScoreWarning(mobileScore) });
  add(170, desktopScore !== undefined && desktopScore >= 90, desktopScore !== undefined ? `${desktopScore} via PageSpeed Insights` : psiUnavailableEvidence, { skipped: desktopScore === undefined, warning: performanceScoreWarning(desktopScore) });
  add(171, tapTargetsPass !== undefined ? tapTargetsPass : viewport.includes("width=device-width"), tapTargetsPass !== undefined ? `PageSpeed tap-targets ${tapTargetsPass ? "passed" : "failed"}` : "Local tap-target fallback");
  add(172, !intrusiveInterstitials, intrusiveInterstitials ? "Interstitial/overlay pattern detected" : "No intrusive interstitial pattern detected");
  add(173, psi?.unusedJsSavingsBytes !== undefined && totalJsBytes > 0 ? unusedJsPercent < 20 : totalJsBytes < 500000, psi?.unusedJsSavingsBytes !== undefined && totalJsBytes > 0 ? `${unusedJsPercent}% JS savings estimated` : `${Math.round(totalJsBytes / 1024)}KB sampled JS`);
  add(174, psi?.unusedCssSavingsBytes !== undefined && totalCssBytes > 0 ? unusedCssPercent < 40 : true, psi?.unusedCssSavingsBytes !== undefined && totalCssBytes > 0 ? `${unusedCssPercent}% CSS savings estimated` : "Unused CSS API data unavailable");
  add(175, imageAggregate.modernRate >= 0.7, imageEvidence(`${imageAggregate.modern}/${imageAggregate.count} images use WebP or AVIF (${Math.round(imageAggregate.modernRate * 100)}%)`, nonModernImageSamples));
  add(176, totalJsBytes === 0 || totalJsBytes < 500000, `${Math.round(totalJsBytes / 1024)}KB sampled JS`);
  add(177, optimizedImages, psi?.optimizedImagePass !== undefined ? `PageSpeed image optimization ${psi.optimizedImagePass ? "passed" : "failed"}` : `${Math.round(imageAggregate.modernRate * 100)}% modern image fallback`);
  add(178, compressedTextAssets.length === 0 || compressionPercent >= 80, compressedTextAssets.length === 0 ? "0/0 text assets compressed (not detected)" : `${compressedCount}/${compressedTextAssets.length} text assets compressed (${compressionPercent}%)`);
  add(179, psi?.thirdPartyBlockingTime !== undefined && psi.thirdPartyBlockingTime < 500, psi?.thirdPartyBlockingTime !== undefined ? `${Math.round(psi.thirdPartyBlockingTime)}ms third-party blocking time` : "Third-party blocking-time measurement unavailable", { skipped: psi?.thirdPartyBlockingTime === undefined });
  add(180, fcp !== undefined && fcp < 400, fcp !== undefined ? JSON.stringify({ metric: "FCP optimal", measuredValue: Math.round(fcp), unit: "ms", threshold: 400 }) : JSON.stringify({ reason: "FCP measurement unavailable" }), { skipped: fcp === undefined, severity: "ADVISORY", weight: 0, warning: fcp !== undefined && fcp >= 400 });
  add(181, !/@font-face/i.test(page.html) || /font-display\s*:\s*swap/i.test(page.html), "font-face CSS scanned");
  add(182, selfHostedFontPercent >= 80, `${selfHostedFontPercent}% sampled fonts self-hosted`);
  add(183, preconnectCount > 0 || thirdPartyScripts.length === 0, preconnectCount ? `${preconnectCount} preconnect hints found` : `${thirdPartyScripts.length} third-party scripts detected`);
  add(184, medianTtfb < 200, `${Math.round(medianTtfb)}ms median TTFB`);
  add(185, imageAggregate.belowFoldLazyRate >= 0.8, imageAggregate.belowFoldCount ? imageEvidence(`${imageAggregate.belowFoldLazy}/${imageAggregate.belowFoldCount} below-fold images lazy-loaded (${Math.round(imageAggregate.belowFoldLazyRate * 100)}%)`, nonLazyBelowFoldImageSamples) : "No below-fold images detected");
  add(186, preloadCriticalCount > 0, `${preloadCriticalCount} preload hints found`);
  add(187, totalPageWeightBytes < 3000000, `${Math.round(totalPageWeightBytes / 1024)}KB sampled page weight`);
  add(188, psi?.tti !== undefined && psi.tti < 3800, psi?.tti !== undefined ? `${Math.round(psi.tti)}ms via PageSpeed` : "TTI measurement unavailable", { skipped: psi?.tti === undefined });
  add(189, psi?.speedIndex !== undefined && psi.speedIndex < 3400, psi?.speedIndex !== undefined ? `${Math.round(psi.speedIndex)}ms via PageSpeed` : "Speed Index measurement unavailable", { skipped: psi?.speedIndex === undefined });
  add(190, psi?.tbt !== undefined && psi.tbt < 200, psi?.tbt !== undefined ? `${Math.round(psi.tbt)}ms via PageSpeed` : "Total Blocking Time measurement unavailable", { skipped: psi?.tbt === undefined });
  add(191, http200Percent === 100, `${http200Count}/${pages.length} target pages returned HTTP 200 (${http200Percent}%)`, { severity: http200Severity });
  add(192, url.protocol === "https:" && await sslValid(url), `${url.protocol} TLS certificate checked`);
  add(193, hstsMaxAge > 0, hsts ? `HSTS max-age=${hstsMaxAge}` : "HSTS header missing");
  add(194, subdomainSslResults.every((item) => item.valid), subdomainSslResults.length ? `${subdomainSslResults.filter((item) => item.valid).length}/${subdomainSslResults.length} discovered subdomains have valid SSL` : "No linked subdomains discovered");
  add(195, compressedTextAssets.length === 0 || compressionPercent >= 80, compressedTextAssets.length === 0 ? "0/0 text assets compressed (not detected)" : `${compressedCount}/${compressedTextAssets.length} text assets compressed (${compressionPercent}%)`);
  add(196, headerAssetSamples.length === 0 || cachePercent >= 80, `${cacheOkCount}/${headerAssetSamples.length} assets have appropriate Cache-Control`);
  if (infiniteScrollAudit.detected) {
    add(197, infiniteScrollAudit.pass, infiniteScrollAudit.evidence, { warning: !infiniteScrollAudit.pass });
  }
  add(198, psi?.lcpLazyLoadedPass ?? !firstImgLazy, psi?.lcpLazyLoadedPass !== undefined ? `PageSpeed lcp-lazy-loaded ${psi.lcpLazyLoadedPass ? "passed" : "failed"}` : "First image loading attribute checked");
  const indexableCanonicalRate = pagePassRate((p) => metaRobots(p).includes("noindex") || Boolean(linkHrefByRel(p.$, "canonical")));
  const indexableSelfRefRate = pagePassRate((p) => {
    if (metaRobots(p).includes("noindex")) return true;
    const value = linkHrefByRel(p.$, "canonical");
    const resolved = value ? absolute(new URL(p.finalUrl), value) : "";
    return Boolean(resolved) && comparableCanonicalUrl(resolved) === comparableCanonicalUrl(p.finalUrl);
  });
  add(200, indexableCanonicalRate.rate >= 0.9, pageRateEvidence(indexableCanonicalRate, "are indexable and have canonical tags", (p) => metaRobots(p).includes("noindex") || Boolean(linkHrefByRel(p.$, "canonical"))));
  add(201, indexableSelfRefRate.rate >= 0.9, `${indexableSelfRefRate.passed}/${indexableSelfRefRate.total} pages have self-referencing canonical (${indexableSelfRefRate.percent}%)${failedPageUrls((p) => {
    if (metaRobots(p).includes("noindex")) return true;
    const value = linkHrefByRel(p.$, "canonical");
    const resolved = value ? absolute(new URL(p.finalUrl), value) : "";
    return Boolean(resolved) && comparableCanonicalUrl(resolved) === comparableCanonicalUrl(p.finalUrl);
  }).length ? `; sampleUrls: ${failedPageUrls((p) => {
    if (metaRobots(p).includes("noindex")) return true;
    const value = linkHrefByRel(p.$, "canonical");
    const resolved = value ? absolute(new URL(p.finalUrl), value) : "";
    return Boolean(resolved) && comparableCanonicalUrl(resolved) === comparableCanonicalUrl(p.finalUrl);
  }).join(", ")}` : ""}`);
  add(202, Boolean(canonicalAbs) && await fetchPage(canonicalAbs, 1800).then((canonicalPage) => canonicalPage.status === 200).catch(() => false), canonicalAbs ? `Canonical target ${canonicalAbs}` : "Canonical missing");
  add(203, Boolean(canonicalAbs) && /^https:\/\//i.test(canonicalAbs), canonicalAbs || "Canonical missing");
  add(204, true, historyMatch
    ? "History API code was detected, but no confirmed Back-button interference was observed."
    : "No suspicious history manipulation found");
  add(205, !exitIntentMatch, exitIntentMatch ? `Matched pattern: ${exitIntentMatch}` : "No exit-intent redirects found");
  add(206, indexableRate.rate >= 0.98, pageRateEvidence(indexableRate, "are not noindex sitemap targets", robotsContentAllowsIndex));
  add(207, soft404Status === 404 || soft404Status === 410, `Fake URL returned status ${soft404Status || "missing"}${soft404Status === 200 && /\b(not found|page not found|no results|error)\b/i.test(soft404Body) ? " with soft error language" : ""}`);
  add(208, slashRedirectStatus === 0 || slashRedirectStatus === 301 || slashRedirectStatus === 308 || caseVariantStatus === 0 || caseVariantStatus === 301 || caseVariantStatus === 308 || caseVariantStatus === 404, `Slash variant status ${slashRedirectStatus || "missing"}, case variant status ${caseVariantStatus || "missing"}`);
  add(209, lowercasePathRate.rate >= 0.95, pageRateEvidence(lowercasePathRate, "use lowercase URL paths", (p) => new URL(p.finalUrl).pathname === new URL(p.finalUrl).pathname.toLowerCase()));
  add(210, brokenExternalLinks.length === 0, externalLinkEvidence);
  add(211, browserMixedContentAssets.length === 0, mixedContentEvidence);
  add(212, /gzip|br|deflate/i.test(htmlCompression), htmlCompression || "missing");
  add(213, Boolean(cdnEvidence), cdnEvidence || "No CDN/cache header signal detected");
  add(214, validatorHeaders.length > 0 || assetValidatorCount > 0, validatorHeaders.length ? validatorHeaders.join(", ") : assetValidatorCount > 0 ? `${assetValidatorCount}/${headerAssetSamples.length} sampled assets have ETag or Last-Modified` : "missing");
  add(215, ssrPassCount / Math.max(pages.length, 1) >= 0.7, `${ssrPassCount}/${pages.length} pages have primary content in raw HTML`);
  add(216, emptyShells.length === 0, emptyShells.length ? `${emptyShells.length} empty-shell SPA pages found` : "No empty-shell SPA detected");
  add(217, collapsedPrimaryPages.length === 0, JSON.stringify({
    scope: "page-level-site-wide",
    pagesCrawled: pages.length,
    pagesChecked: pages.length,
    pagesPassed: pages.length - collapsedPrimaryPages.length,
    pagesFailed: collapsedPrimaryPages.length,
    passRate: pages.length ? Number((((pages.length - collapsedPrimaryPages.length) / pages.length) * 100).toFixed(1)) : 100,
    affectedPages: collapsedPrimaryPages.slice(0, 10).map((item) => ({
      url: item.pageUrl,
      issueCount: 1,
      sampleEvidence: { hiddenContentSample: item.hiddenSample, hiddenWords: item.hiddenWords, visibleWords: item.visibleWords }
    })),
    sampleEvidence: collapsedPrimaryPages.slice(0, 10)
  }));
  add(218, cookieWallRate.rate >= 0.9, pageRateEvidence(cookieWallRate, "avoid consent-wall blocking patterns", (p) => p.wordCount > 80 || !/cookie|consent/i.test(p.html)));
  add(219, maxDomNodes < 1500, `${maxDomNodes} DOM nodes on largest sampled page`);
  add(220, hiddenWords < 100, `${hiddenWords} words hidden on primary page`);
  add(221, hiddenKeywordCount === 0, `${hiddenKeywordCount} CSS-hidden keyword text blocks`);
  const nonBlockingScriptRate = pagePassRate((p) => p.$("head script[src]:not([async]):not([defer]):not([type='module'])").length === 0);
  const criticalCssRate = pagePassRate((p) => p.$("head style").text().trim().length > 0);
  add(222, nonBlockingScriptRate.rate >= 0.8, pageRateEvidence(nonBlockingScriptRate, "avoid render-blocking scripts in head", (p) => p.$("head script[src]:not([async]):not([defer]):not([type='module'])").length === 0));
  add(223, criticalCssRate.rate >= 0.5, pageRateEvidence(criticalCssRate, "include inline critical CSS", (p) => p.$("head style").text().trim().length > 0));
  add(224, imageAggregate.dimensionsRate >= 0.9, imageEvidence(`${imageAggregate.dimensionsPresent}/${imageAggregate.count} images have width and height (${Math.round(imageAggregate.dimensionsRate * 100)}%)`, missingDimensionImageSamples));
  add(225, imageAggregate.belowFoldLazyRate >= 0.8, imageAggregate.belowFoldCount ? imageEvidence(`${imageAggregate.belowFoldLazy}/${imageAggregate.belowFoldCount} below-fold images lazy-loaded (${Math.round(imageAggregate.belowFoldLazyRate * 100)}%)`, nonLazyBelowFoldImageSamples) : "No below-fold images detected");
  add(226, !/@font-face/i.test(page.html) || /font-display\s*:\s*swap/i.test(page.html), "font-face CSS scanned");
  add(227, schemaInjection.passed, schemaInjection.evidence);
  add(228, rssFullTextPassed, foundFeed ? `Feed found at ${foundFeed.url}, avg item words ${avgFeedWords}` : "No feed found at /feed, /rss, or /atom.xml", { severity: "ADVISORY", weight: 0, warning: !rssFullTextPassed });
  const llmsPassed = llms?.response.status === 200 && /text|plain|markdown/i.test(llmsContentType) && llmsWordStats.words >= 100 && llmsWordStats.sections >= 2;
  const aiTxtPassed = aiTxt?.response.status === 200;
  add(229, aiTxtPassed || llmsPassed, llmsPassed && !aiTxtPassed ? "ai.txt is optional because llms.txt passed" : `Status ${aiTxt?.response.status ?? "missing"}`, { severity: "ADVISORY", weight: 0, warning: !aiTxtPassed && !llmsPassed });
  add(230, llmsPassed, `Status ${llms?.response.status ?? "missing"}, ${llmsWordStats.words} words, ${llmsWordStats.sections} sections`);
  add(231, apiUrls.length === 0 || corsValues.length > 0, apiUrls.length === 0 ? "No public API found" : corsValues.length ? `CORS header: ${corsValues[0]}` : `${apiUrls.length} public API endpoints found without CORS header`);
  add(232, observedTtfb <= 800, `${Math.round(observedTtfb)}ms TTFB${observedTtfb < 200 ? " (competitive)" : ""}`);
  add(233, aiCrawlerOk, aiCrawlerEvidence);
  if (renderedContentEvidence) add(234, renderedContentMatches, renderedContentEvidence);
  add(235, indexNowPassed, indexNowCandidates.length ? `${indexNowResponses.filter((item) => item.response?.status === 200).length}/${indexNowCandidates.length} IndexNow key files reachable` : "No IndexNow key location found", { severity: "ADVISORY", weight: 0, warning: !indexNowPassed });
  add(236, robotsBlocksInternalSearch(robots?.text ?? "") || searchLinks.length === 0, robotsBlocksInternalSearch(robots?.text ?? "") ? "Search URLs blocked in robots.txt" : searchLinks.length ? `${searchLinks.length} internal search URLs found` : "Search URLs not found");
  add(237, trackingInternalLinks.length === 0, `${trackingInternalLinks.length} tracking-param internal links`);
  add(238, headerAssetSamples.length === 0 || contentTypeOkCount === headerAssetSamples.length, `${contentTypeOkCount}/${headerAssetSamples.length} sampled assets have correct Content-Type`);

  results.forEach((check) => {
    if (check.skipped) {
      check.passed = true;
      check.warning = undefined;
      check.severity = "PASS";
      return;
    }
    if (check.severity === "ADVISORY" || check.weight === 0) {
      check.warning = check.passed ? undefined : true;
      check.severity = check.passed ? "PASS" : "ADVISORY";
      return;
    }
    try {
      const evidence = JSON.parse(check.evidence) as Record<string, unknown>;
      const pagesChecked = Number(evidence.pagesChecked);
      const pagesFailed = Number(evidence.pagesFailed);
      if (Number.isFinite(pagesChecked) && Number.isFinite(pagesFailed)) {
        check.passed = pagesChecked === 0 || pagesFailed === 0;
        check.warning = undefined;
        const affectedPages = Array.isArray(evidence.affectedPages) ? evidence.affectedPages : [];
        const hasAffectedUrl = affectedPages.some((item) =>
          item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string"
        );
        if (!check.passed && !hasAffectedUrl) {
          check.passed = true;
          check.skipped = true;
          check.evidence = JSON.stringify({
            skipped: true,
            reason: "Insufficient evidence: no affected URL was available for this failed check.",
            originalEvidence: evidence
          });
        }
      }
    } catch {
      // Non-JSON or unrelated evidence shape. Severity is normalized below.
    }
    if (check.skipped) {
      check.severity = "PASS";
    } else {
      check.severity = check.passed ? "PASS" : check.severity;
    }
  });

  return scoreChecks(results, performanceSnapshot);
}

function scoreChecks(checks: TechnicalCheckResult[], pageSpeed?: PageSpeedSnapshot): TechnicalAuditResult {
  const outcomeScore = (scope: TechnicalScope) => {
    const scoped = checks.filter((check) => check.scope === scope && !check.skipped && check.severity !== "ADVISORY" && check.weight > 0);
    return scoreParameterOutcomes(scoped, 0);
  };
  const pageScore = outcomeScore("page");
  const domainScore = outcomeScore("domain");
  const scorableChecks = checks.filter((check) => !check.skipped && check.severity !== "ADVISORY" && check.weight > 0);
  const rawScore = scoreParameterOutcomes(scorableChecks, 0);
  const blockerFailed = false;
  const score = rawScore;
  const groupedChecks = checks.reduce<Map<string, TechnicalCheckResult[]>>((groups, check) => {
    const current = groups.get(check.category) ?? [];
    current.push(check);
    groups.set(check.category, current);
    return groups;
  }, new Map());
  const categoryDebug = [...groupedChecks.entries()].map(([category, categoryChecks]) => {
    const failed = categoryChecks.filter((check) => !check.passed && !check.warning && !check.skipped && check.severity !== "ADVISORY");
    return {
      category,
      totalChecks: categoryChecks.length,
      passedChecks: categoryChecks.filter((check) => check.passed && !check.warning).length,
      failedChecks: failed.length,
      failedCheckDetails: failed.map((check) => ({
        id: check.id,
        name: check.name,
        evidence: check.evidence
      }))
    };
  });
  return {
    score,
    rawScore,
    pageScore,
    domainScore,
    grade: gradeForScore(score),
    blockerFailed,
    checkedAt: new Date().toISOString(),
    pageSpeed,
    checks,
    categoryDebug
  };
}

function gradeForScore(score: number): TechnicalGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}
