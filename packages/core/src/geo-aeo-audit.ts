import * as cheerio from "cheerio";
import { scoreParameterOutcomes } from "./audit-outcome.js";
import { CHATGPT_CITATION_RECOMMENDATIONS, isChatgptCitationCategory } from "./chatgpt-citation-audit.js";
import { GEMINI_CITATION_RECOMMENDATIONS, isGeminiCitationCategory } from "./gemini-citation-audit.js";
import { crawlSite, fetchSitemapUrls } from "./site-crawler.js";

export type GeoAeoSeverity = "BLOCKER" | "MAJOR" | "MINOR" | "ADVISORY";
export type GeoAeoScope = "page" | "domain";
export type GeoAeoGrade = "A" | "B" | "C" | "D" | "F";
export type GeoAeoStatus = "Passed" | "Minor Attention" | "Needs Attention" | "Skipped";

export interface GeoAeoCheckDefinition {
  id: number;
  category: string;
  name: string;
  severity: GeoAeoSeverity;
  scope: GeoAeoScope;
}

export interface GeoAeoCheckResult extends GeoAeoCheckDefinition {
  passed: boolean;
  evidence: string;
  skipped?: boolean;
  notApplicable?: boolean;
  warning?: boolean;
  informational?: boolean;
  opportunity?: string;
  priorityScore?: number;
  recommendation?: string;
}

export interface GeoAeoCategorySummary {
  categoryName: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningChecks: number;
  skippedChecks: number;
  score: number;
  status: GeoAeoStatus;
  failedCheckDetails?: GeoAeoFailedCheckDetail[];
  skippedCheckDetails?: GeoAeoSkippedCheckDetail[];
}

export interface GeoAeoFailedCheckDetail {
  id: number;
  name: string;
  severity: GeoAeoSeverity;
  evidence: string;
  recommendation: string;
  affectedPages: number;
  sampleUrls: string[];
}

export interface GeoAeoSkippedCheckDetail {
  id: number;
  name: string;
  reason: string;
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

const CHECKS: GeoAeoCheckDefinition[] = [
  { id: 1, category: "AI Bot Access", name: "GPTBot allowed", severity: "BLOCKER", scope: "domain" },
  { id: 4, category: "AI Bot Access", name: "Google-Extended allowed", severity: "BLOCKER", scope: "domain" },
  { id: 5, category: "AI Bot Access", name: "OAI-SearchBot allowed", severity: "BLOCKER", scope: "domain" },
  { id: 8, category: "AI Discovery Files", name: "llms.txt Exists", severity: "MAJOR", scope: "domain" },
  { id: 9, category: "AI Discovery Files", name: "llms.txt Plain Markdown", severity: "MAJOR", scope: "domain" },
  { id: 10, category: "AI Readiness", name: "llms.txt word count", severity: "MAJOR", scope: "domain" },
  { id: 11, category: "AI Readiness", name: "llms.txt content completeness", severity: "MAJOR", scope: "domain" },
  { id: 12, category: "Entity & Trust Signals", name: "Organization sameAs reinforcement", severity: "ADVISORY", scope: "domain" },
  { id: 13, category: "Entity & Trust Signals", name: "Verified LinkedIn sameAs", severity: "ADVISORY", scope: "domain" },
  { id: 14, category: "Entity & Trust Signals", name: "Verified authority-profile sameAs", severity: "ADVISORY", scope: "domain" },
  { id: 15, category: "Entity & Trust Signals", name: "NAP schema-DOM match", severity: "BLOCKER", scope: "domain" },
  { id: 16, category: "Entity & Trust Signals", name: "Schema-DOM consistency", severity: "BLOCKER", scope: "page" },
  { id: 17, category: "FAQ & Answer Optimization", name: "FAQ section exists", severity: "MAJOR", scope: "page" },
  { id: 18, category: "FAQ & Answer Optimization", name: "FAQPage schema exists", severity: "MAJOR", scope: "page" },
  { id: 19, category: "FAQ & Answer Optimization", name: "FAQ schema completeness", severity: "MAJOR", scope: "page" },
  { id: 20, category: "FAQ & Answer Optimization", name: "BLUF detection", severity: "ADVISORY", scope: "page" },
  { id: 21, category: "FAQ & Answer Optimization", name: "Question-based content structure", severity: "ADVISORY", scope: "page" },
  { id: 22, category: "Content Authority", name: "Author byline quality", severity: "MINOR", scope: "page" },
  { id: 23, category: "Content Authority", name: "Author bio quality", severity: "MINOR", scope: "page" },
  { id: 24, category: "Content Authority", name: "Credentials/certifications", severity: "MINOR", scope: "page" },
  { id: 25, category: "Content Authority", name: "First-hand experience language", severity: "ADVISORY", scope: "page" },
  { id: 26, category: "Content Authority", name: "Last updated visible", severity: "MINOR", scope: "page" },
  { id: 27, category: "Content Authority", name: "Outbound authority links", severity: "MINOR", scope: "page" },
  { id: 28, category: "Local GEO Signals", name: "Local entity schema", severity: "MAJOR", scope: "domain" },
  { id: 29, category: "Local GEO Signals", name: "geo.latitude", severity: "MINOR", scope: "domain" },
  { id: 30, category: "Local GEO Signals", name: "geo.longitude", severity: "MINOR", scope: "domain" },
  { id: 31, category: "Local GEO Signals", name: "areaServed", severity: "MINOR", scope: "domain" },
  { id: 32, category: "AI Crawlability", name: "JS-rendered content available in raw HTML", severity: "BLOCKER", scope: "page" },
  { id: 33, category: "AI Crawlability", name: "Hidden content under threshold", severity: "MAJOR", scope: "page" },
  { id: 34, category: "AI Crawlability", name: "Data point density", severity: "ADVISORY", scope: "page" },
  { id: 35, category: "Structured Data Integrity", name: "FAQ schema-DOM match", severity: "BLOCKER", scope: "page" },
  { id: 36, category: "Structured Data Integrity", name: "Product schema-DOM match", severity: "BLOCKER", scope: "page" },
  { id: 37, category: "Structured Data Integrity", name: "Schema consistency validation", severity: "BLOCKER", scope: "page" },
  { id: 38, category: "Crawlability", name: "OAI-SearchBot allowed", severity: "BLOCKER", scope: "domain" },
  { id: 39, category: "Crawlability", name: "ChatGPT-User allowed", severity: "BLOCKER", scope: "domain" },
  { id: 40, category: "Crawlability", name: "GPTBot rules do not block OAI agents", severity: "MAJOR", scope: "domain" },
  { id: 41, category: "Crawlability", name: "WAF not challenging OAI agents", severity: "BLOCKER", scope: "domain" },
  { id: 42, category: "Technical Access", name: "No paywall on citable content", severity: "MAJOR", scope: "page" },
  { id: 49, category: "Content Opportunities", name: "Alternatives and comparison pages", severity: "ADVISORY", scope: "domain" },
  { id: 50, category: "Content Opportunities", name: "Use-case and industry pages", severity: "ADVISORY", scope: "domain" },
  { id: 52, category: "Content Quality", name: "Product schema completeness", severity: "MAJOR", scope: "page" },
  { id: 54, category: "Content Quality", name: "Review diversity check", severity: "MINOR", scope: "domain" },
  { id: 55, category: "Content Quality", name: "Merchant trust pages", severity: "MAJOR", scope: "domain" },
  { id: 65, category: "Technical Access", name: "No nosnippet restrictions", severity: "BLOCKER", scope: "page" },
  { id: 66, category: "Crawlability", name: "SSR for OAI-SearchBot", severity: "BLOCKER", scope: "page" },
  { id: 67, category: "Gemini Crawlability", name: "Google-Extended allowed", severity: "BLOCKER", scope: "domain" },
  { id: 68, category: "Gemini Crawlability", name: "WAF not blocking Google-Extended", severity: "BLOCKER", scope: "domain" },
  { id: 69, category: "Gemini Crawlability", name: "IP range accessible", severity: "BLOCKER", scope: "domain" },
  { id: 70, category: "Local & E-Commerce", name: "NAP matches GBP consistently", severity: "BLOCKER", scope: "domain" },
  { id: 71, category: "Gemini Crawlability", name: "Cookie consent not blocking DOM", severity: "BLOCKER", scope: "page" },
  { id: 72, category: "Schema & Technical", name: "Server-side schema injection", severity: "BLOCKER", scope: "page" },
  { id: 73, category: "Robots & Bot Access", name: "GoogleOther allowed", severity: "MAJOR", scope: "domain" },
  { id: 74, category: "Schema & Technical", name: "Speakable schema presence", severity: "MINOR", scope: "page" },
  { id: 75, category: "Media & Visuals", name: "Stock photo detection", severity: "MINOR", scope: "page" },
  { id: 76, category: "Media & Visuals", name: "OCR legibility", severity: "MINOR", scope: "page" },
  { id: 77, category: "Schema & Technical", name: "VideoObject schema", severity: "MINOR", scope: "page" },
  { id: 78, category: "Media & Visuals", name: "Transcript-HTML alignment", severity: "MAJOR", scope: "page" }
];

const CATEGORY_ORDER = [
  "AI Bot Access",
  "AI Readiness",
  "Entity & Trust Signals",
  "FAQ & Answer Optimization",
  "Content Authority",
  "Local GEO Signals",
  "AI Crawlability",
  "Structured Data Integrity",
  "Crawlability",
  "Technical Access",
  "Content Structure",
  "Content Quality",
  "Content Opportunities",
  "Gemini Crawlability",
  "Local & E-Commerce",
  "Schema & Technical",
  "Media & Visuals",
  "Robots & Bot Access",
  "AI Discovery Files"
];

const CATEGORY_WEIGHTS: Record<string, number> = {
  "AI Bot Access": 20,
  "AI Readiness": 5,
  "Entity & Trust Signals": 20,
  "FAQ & Answer Optimization": 15,
  "Content Authority": 10,
  "Local GEO Signals": 15,
  "AI Crawlability": 5,
  "Structured Data Integrity": 5,
  "Crawlability": 7,
  "Technical Access": 3,
  "Content Structure": 2,
  "Content Quality": 3,
  "Gemini Crawlability": 6,
  "Local & E-Commerce": 2,
  "Schema & Technical": 3,
  "Media & Visuals": 2,
  "Robots & Bot Access": 2,
  "AI Discovery Files": 5
};

const SCORE_CAP_BLOCKER_IDS = new Set([
  32, // raw HTML does not expose meaningful content
  38, // OAI-SearchBot blocked
  39, // ChatGPT-User blocked
  41, // OAI agents challenged by WAF
  65, // extraction snippets disabled
  66 // OAI-SearchBot does not receive rendered content
]);

const FETCH_TEXT_LIMIT_BYTES = 2 * 1024 * 1024;

const CITATION_RECOMMENDATIONS: Record<number, string> = {
  ...CHATGPT_CITATION_RECOMMENDATIONS,
  ...GEMINI_CITATION_RECOMMENDATIONS,
  79: "Remove noindex directives from meta robots, X-Robots-Tag, and canonical targets for pages meant to rank.",
  80: "Use a self-referencing canonical on the indexable page.",
  81: "Use an absolute https canonical URL.",
  82: "Point canonical URLs directly to pages that return HTTP 200.",
  83: "Avoid canonical chains; point directly to the final canonical target.",
  84: "Keep HTTP Link canonical and HTML canonical consistent, or remove the header canonical.",
  85: "Do not canonicalize indexable pages to a noindexed target.",
  86: "Remove nosnippet directives from pages that should be eligible for rich extraction.",
  87: "Avoid max-snippet:0 or very low max-snippet values on key pages.",
  88: "Remove data-nosnippet from substantial key content.",
  89: "Allow image previews with max-image-preview:large or no restrictive directive.",
  90: "Redirect HTTP requests to HTTPS with a permanent redirect.",
  91: "Choose one canonical host variant and redirect the other consistently.",
  92: "Expose substantial content without login or paywall gates.",
  93: "Keep hidden text below spam-risk thresholds.",
  94: "Ensure cookie consent does not block crawlable page content.",
  95: "Remove scripts that manipulate browser history in ways that trap users.",
  96: "Provide crawlable pagination when using infinite-scroll style interfaces.",
  97: "Add valid hreflang alternates with x-default and self-reference for multilingual pages.",
  98: "Handle paginated pages with clear pagination links and canonicals.",
  99: "Return a real 404/410 for missing pages instead of a soft-404 200 response.",
  100: "Canonicalize parameter URLs to clean equivalents.",
  101: "Verify Google index coverage in Google Search Console.",
  102: "Verify Bing index coverage in Bing Webmaster Tools.",
  103: "Remove noindexed URLs from XML sitemaps."
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function statusFor(failedChecks: number): GeoAeoStatus {
  if (failedChecks === 0) return "Passed";
  if (failedChecks <= 2) return "Minor Attention";
  return "Needs Attention";
}

function gradeFor(score: number): { grade: GeoAeoGrade; description: string } {
  if (score >= 85) return { grade: "A", description: "High AI citation probability" };
  if (score >= 70) return { grade: "B", description: "Good AI visibility" };
  if (score >= 55) return { grade: "C", description: "Needs improvement" };
  if (score >= 40) return { grade: "D", description: "Poor AI visibility" };
  return { grade: "F", description: "Critical GEO issues" };
}

async function limitedResponseText(response: Response, maxBytes = FETCH_TEXT_LIMIT_BYTES) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) return "";

  const reader = response.body?.getReader();
  if (!reader) return response.text().catch(() => "");

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    total += value.byteLength;
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder("utf-8").decode(bytes);
}

async function resolveWithin<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timeout = setTimeout(() => resolve(fallback), timeoutMs);
    });
    return await Promise.race([
      promise.catch(() => fallback),
      timeoutPromise
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fetchText(url: string, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "AIVisibilityAnalyzer/1.0", accept: "text/plain,text/markdown,text/html,*/*" }
    });
    const text = await limitedResponseText(response).catch(() => "");
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithUserAgent(url: string, userAgent: string, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": userAgent, accept: "text/html,text/plain,*/*" }
    });
    const text = await limitedResponseText(response).catch(() => "");
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
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

interface LocalPageHtml {
  source: string;
  html: string;
  url?: string;
}

async function fetchLikelyLocalPageEntries(origin: string): Promise<LocalPageHtml[]> {
  const pages = [
    ["/", "homepage"],
    ["/contact/", "contact page"],
    ["/contact-us/", "contact page"],
    ["/about/", "about page"],
    ["/about-us/", "about page"],
    ["/locations/", "location page"]
  ] satisfies Array<[string, string]>;

  const fetched = await Promise.all(pages.map(async ([path, source]): Promise<LocalPageHtml | null> => {
    try {
      const { response, text } = await fetchText(`${origin}${path}`, 1400);
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !/html|text/i.test(contentType) || !text.trim()) return null;
      return { source, html: text, url: `${origin}${path}` } satisfies LocalPageHtml;
    } catch {
      return null;
    }
  }));

  return fetched.filter((page): page is LocalPageHtml => page !== null);
}

export async function fetchLikelyLocalPages(origin: string): Promise<string[]> {
  return (await fetchLikelyLocalPageEntries(origin)).map((page) => page.html);
}

function parseJsonLd($: cheerio.CheerioAPI) {
  const blocks: unknown[] = [];
  const errors: string[] = [];

  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) blocks.push(value);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Invalid JSON-LD");
    }
  });

  return { blocks, errors };
}

function flattenSchemaTypes(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const graph = Array.isArray(record["@graph"]) ? record["@graph"] : [];
  const ownType = record["@type"];
  const ownTypes = Array.isArray(ownType) ? ownType : ownType ? [ownType] : [];
  return [
    ...ownTypes.filter((item): item is string => typeof item === "string"),
    ...graph.flatMap(flattenSchemaTypes)
  ];
}

function findObjects(value: unknown, predicate: (record: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => findObjects(item, predicate));

  const record = value as Record<string, unknown>;
  return [
    ...(predicate(record) ? [record] : []),
    ...Object.values(record).flatMap((item) => findObjects(item, predicate))
  ];
}

function hasSchemaType(blocks: unknown[], pattern: RegExp) {
  return blocks.some((block) => flattenSchemaTypes(block).some((type) => pattern.test(type)));
}

function isLocalEntityType(type: string) {
  return /LocalBusiness|MedicalBusiness|ProfessionalService|HealthAndBeautyBusiness|BeautySalon|MedicalClinic|Dermatology|Dentist|Physician/i.test(type);
}

function localEntityObjectsFromJsonLd(blocks: unknown[]) {
  return findObjects(blocks, (record) => flattenSchemaTypes(record).some(isLocalEntityType));
}

function organizationObjectsFromJsonLd(blocks: unknown[]) {
  return findObjects(blocks, (record) => flattenSchemaTypes(record).some((type) => /Organization/i.test(type)));
}

function sameAsUrls(blocks: unknown[]) {
  return findObjects(blocks, (record) => flattenSchemaTypes(record).some((type) => /Organization/i.test(type) || isLocalEntityType(type)))
    .flatMap((record) => {
      const sameAs = record.sameAs;
      if (Array.isArray(sameAs)) return sameAs.filter((item): item is string => typeof item === "string");
      return typeof sameAs === "string" ? [sameAs] : [];
    });
}

function microdataRdfaLocalSignals($: cheerio.CheerioAPI) {
  const localTypes = [
    "LocalBusiness",
    "MedicalBusiness",
    "HealthAndBeautyBusiness",
    "BeautySalon",
    "MedicalClinic",
    "ProfessionalService",
    "Dermatology",
    "Dentist",
    "Physician"
  ];
  const selectors = localTypes.flatMap((type) => [
    `[itemscope][itemtype*='schema.org/${type}']`,
    `[typeof~='${type}']`
  ]);
  const localNodes = $(selectors.join(","));

  const propertyExists = (name: string) =>
    localNodes.filter((_, node) =>
      $(node).find(`[itemprop='${name}'],[property='${name}'],[property='schema:${name}']`).length > 0 ||
      Boolean($(node).attr("itemprop") === name || $(node).attr("property") === name || $(node).attr("property") === `schema:${name}`)
    ).length > 0;

  const textFor = (name: string) =>
    localNodes.find(`[itemprop='${name}'],[property='${name}'],[property='schema:${name}']`).map((_, node) => $(node).attr("content") ?? $(node).text()).get().join(" ");

  return {
    hasLocalEntity: localNodes.length > 0,
    hasAddress: propertyExists("address") || propertyExists("streetAddress"),
    hasPhone: propertyExists("telephone") || propertyExists("phone"),
    hasLatitude: propertyExists("latitude"),
    hasLongitude: propertyExists("longitude"),
    hasAreaServed: propertyExists("areaServed") || propertyExists("serviceArea"),
    name: textFor("name"),
    phone: textFor("telephone") || textFor("phone")
  };
}

function mapsCoordinateSignals($: cheerio.CheerioAPI, html: string) {
  const mapSources = $("iframe[src*='maps.google'],iframe[src*='google.com/maps'],a[href*='maps.google'],a[href*='google.com/maps']")
    .map((_, node) => $(node).attr("src") ?? $(node).attr("href") ?? "")
    .get()
    .join(" ");
  const haystack = `${mapSources} ${html}`;
  const hasMapsEmbed = /maps\.google|google\.com\/maps/i.test(mapSources);
  const decimalPair = /(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/.exec(haystack);
  const googleEmbedPair = /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(haystack);
  const namedLatitude = /\b(latitude|lat)\b["'\s:=]+(-?\d{1,2}\.\d+)/i.test(haystack);
  const namedLongitude = /\b(longitude|lng|lon)\b["'\s:=]+(-?\d{1,3}\.\d+)/i.test(haystack);

  return {
    hasMapsEmbed,
    hasLatitude: Boolean(decimalPair || googleEmbedPair || namedLatitude || hasMapsEmbed),
    hasLongitude: Boolean(decimalPair || googleEmbedPair || namedLongitude || hasMapsEmbed)
  };
}

function visibleAreaServedSignal(text: string) {
  return /\b(serving|serves|areas served|service area|locations served|available in|serving clients in|located in)\b.{0,100}\b[A-Z][A-Za-z]+/i.test(text);
}

function visiblePhoneSignal(text: string) {
  return /\+?\d[\d\s().-]{7,}/.test(text);
}

function visibleAddressSignal(text: string) {
  return /\b(address|visit us|find us|located at|clinic|office|suite|floor|street|st\.|road|rd\.|avenue|ave\.|lane|sector|block|near|opp\.|opposite|bangalore|bengaluru|delhi|mumbai|pune|hyderabad|chennai|kolkata|ncr)\b/i.test(text);
}

function visibleNapSignal(text: string) {
  return visiblePhoneSignal(text) && visibleAddressSignal(text);
}

function schemaHasAddressAndPhone(records: Record<string, unknown>[]) {
  return records.some((record) => {
    const hasPhone = typeof record.telephone === "string" || typeof record.phone === "string" || typeof record.contactPoint === "object";
    const hasAddress = typeof record.address === "object" || typeof record.address === "string";
    return hasPhone && hasAddress;
  });
}

function schemaHasLocation(records: Record<string, unknown>[]) {
  return records.some((record) => Boolean(record.address || record.addressLocality || record.addressRegion || record.areaServed || record.serviceArea));
}

function jsonLdHasProperty(records: Record<string, unknown>[], property: string) {
  return findObjects(records, (record) => {
    if (Object.prototype.hasOwnProperty.call(record, property)) return true;

    if (record.geo && typeof record.geo === "object") {
      return Object.prototype.hasOwnProperty.call(record.geo, property);
    }

    if (record.address && typeof record.address === "object") {
      return Object.prototype.hasOwnProperty.call(record.address, property);
    }

    return false;
  }).length > 0;
}

function localGeoEvidence(pages: LocalPageHtml[]) {
  const pageSignals = pages.map((page) => {
    const page$ = cheerio.load(page.html);
    const pageText = page$("body").text().replace(/\s+/g, " ").trim();
    const pageJsonLd = parseJsonLd(page$);
    const pageLocalObjects = localEntityObjectsFromJsonLd(pageJsonLd.blocks);
    const pageOrganizationObjects = organizationObjectsFromJsonLd(pageJsonLd.blocks);
    const pageMicrodataRdfa = microdataRdfaLocalSignals(page$);
    const pageMaps = mapsCoordinateSignals(page$, page.html);
    const hasVisibleNap = visibleNapSignal(pageText);
    const hasContactNap = /contact/i.test(page.source) && hasVisibleNap;

    return {
      source: page.source,
      hasLocalEntity:
        pageLocalObjects.length > 0 ||
        pageMicrodataRdfa.hasLocalEntity ||
        schemaHasAddressAndPhone(pageOrganizationObjects) ||
        hasVisibleNap ||
        hasContactNap ||
        pageMaps.hasMapsEmbed,
      hasLatitude: jsonLdHasProperty(pageLocalObjects, "latitude") || pageMicrodataRdfa.hasLatitude || pageMaps.hasLatitude,
      hasLongitude: jsonLdHasProperty(pageLocalObjects, "longitude") || pageMicrodataRdfa.hasLongitude || pageMaps.hasLongitude,
      hasAreaServed:
        jsonLdHasProperty(pageLocalObjects, "areaServed") ||
        jsonLdHasProperty(pageLocalObjects, "serviceArea") ||
        jsonLdHasProperty(pageLocalObjects, "addressLocality") ||
        jsonLdHasProperty(pageLocalObjects, "addressRegion") ||
        schemaHasLocation(pageOrganizationObjects) ||
        pageMicrodataRdfa.hasAreaServed ||
        visibleAreaServedSignal(pageText),
      hasMapsEmbed: pageMaps.hasMapsEmbed
    };
  });

  const sourceFor = (key: keyof Omit<(typeof pageSignals)[number], "source">) =>
    pageSignals.find((page) => page[key])?.source;

  return {
    schemaSource: sourceFor("hasLocalEntity"),
    latitudeSource: sourceFor("hasLatitude"),
    longitudeSource: sourceFor("hasLongitude"),
    areaServedSource: sourceFor("hasAreaServed"),
    mapsSource: sourceFor("hasMapsEmbed")
  };
}

function robotGroupAllows(robotsText: string, bot: string) {
  if (!robotsText.trim()) return true;

  const groups = robotsText
    .split(/\n(?=user-agent\s*:)/i)
    .map((group) => group.trim())
    .filter(Boolean);
  const matchingGroups = groups.filter((group) => {
    const agents = [...group.matchAll(/^user-agent\s*:\s*(.+)$/gim)].map((match) => match[1].trim().toLowerCase());
    return agents.includes("*") || agents.includes(bot.toLowerCase());
  });

  if (!matchingGroups.length) return true;
  return matchingGroups.every((group) => {
    const disallows = [...group.matchAll(/^disallow\s*:\s*(.*)$/gim)].map((match) => match[1].trim());
    return !disallows.includes("/");
  });
}

function robotGroupFor(robotsText: string, bot: string) {
  return robotsText
    .split(/\n(?=user-agent\s*:)/i)
    .map((group) => group.trim())
    .find((group) => [...group.matchAll(/^user-agent\s*:\s*(.+)$/gim)].some((match) => match[1].trim().toLowerCase() === bot.toLowerCase())) ?? "";
}

function challengeDetected(status: number, text: string) {
  if (status === 401 || status === 403) return true;
  if (status !== 200) return false;
  return /\b(captcha|challenge page|access denied|bot (?:block|blocked)|cloudflare challenge|attention required|checking your browser|verify you are human|just a moment)\b/i.test(text);
}

function htmlContentExists(text: string) {
  return /<html[\s>]|<!doctype html|<body[\s>]|<main[\s>]|<article[\s>]/i.test(text) || cheerio.load(text)("body").text().trim().length > 0;
}

function visibleBodyText(text: string) {
  return cheerio.load(text.replace(/></g, "> <"))("body").text().replace(/\s+/g, " ").trim();
}

function paywallDetected(text: string) {
  const visibleText = visibleBodyText(text);
  return /\b(?:login|log in|sign in) (?:is )?required\b|\b(?:log in|sign in) to (?:continue|read|view|access)\b|\bsubscription (?:is )?required\b|\bsubscribe to (?:continue|read|view|access)\b|\bmembers? only\b|\bregistration (?:is )?required\b|\bregister to (?:continue|read|view|access)\b|\bcontent (?:is )?(?:hidden|locked)\b/i.test(visibleText);
}

function h2Texts($: cheerio.CheerioAPI) {
  return $("h2").toArray().map((el) => $(el).text().trim()).filter(Boolean);
}

function headingUrlSignals(pages: LocalPageHtml[], url: URL, pattern: RegExp) {
  const pageSignals = pages.filter((page) => {
    const page$ = cheerio.load(page.html);
    const headings = page$("h1,h2").toArray().map((el) => page$(el).text()).join(" ");
    return pattern.test(`${page.source} ${headings}`);
  }).length;
  return pattern.test(url.pathname) || pageSignals > 0;
}

function pageSearchText(page: LocalPageHtml) {
  const page$ = cheerio.load(page.html);
  return `${page.url ?? ""} ${page$("title").first().text()} ${page$("h1,h2").text()}`.replace(/\s+/g, " ").trim();
}

function urlPathSearchText(href: string) {
  try {
    const parsed = new URL(href);
    return decodeURIComponent(parsed.pathname).replace(/[-_]+/g, " ");
  } catch {
    return href.replace(/[-_]+/g, " ");
  }
}

function compactSignals(signals: string[], limit = 10) {
  return [...new Set(signals.filter(Boolean))].slice(0, limit);
}

function pageUrlSignals(pages: LocalPageHtml[], urls: string[], pattern: RegExp) {
  const urlMatches = urls.filter((href) => pattern.test(`${href} ${urlPathSearchText(href)}`)).length;
  const headingMatches = pages.filter((page) => pattern.test(pageSearchText(page))).length;
  return { urlMatches, headingMatches, total: urlMatches + headingMatches };
}

function alternativesPageDetection(pages: LocalPageHtml[], urls: string[]) {
  const strongUrlPattern = /\/(?:alternatives?|alternative-to|vs|compare|comparison)(?:\/|$)|\/[^/?#]+-(?:alternative|alternatives)(?:\/|$)|\/[^/?#]+-vs-[^/?#]+(?:\/|$)|\/best-[^/?#]+(?:\/|$)|\/[^/?#]+-alternatives?(?:\/|$)/i;
  const textPattern = /\b(vs|versus|alternative|alternatives|compare|comparison|instead of|switch from)\b/i;
  const blogPartialPattern = /\/(?:blog|articles?|resources?|posts?)\/[^?#]*(?:\bvs\b|compare)/i;

  const strongSignals = [
    ...urls.filter((href) => strongUrlPattern.test(href) || textPattern.test(urlPathSearchText(href))),
    ...pages
      .filter((page) => textPattern.test(pageSearchText(page)))
      .map((page) => page.url ?? pageSearchText(page))
  ];
  const partialSignals = urls.filter((href) => blogPartialPattern.test(href));
  const signals = compactSignals(strongSignals.length ? strongSignals : partialSignals);
  const score = strongSignals.length ? 10 : partialSignals.length ? 5 : 0;

  return { found: score > 0, signals, score };
}

function useCasePageDetection(pages: LocalPageHtml[], urls: string[]) {
  const urlPattern = /\/(?:for-[^/?#]+|use-cases?|solutions?)(?:\/|$)|\/personal-loan-for-[^/?#]+|\/(?:salaried|freelancers?|self-employed|medical|travel|home-renovation|education|wedding|business|professionals?)(?:\/|$)/i;
  const textPattern = /\b(personal loan for (?:medical expenses?|travel|home renovation|education|wedding|business)|loans? for (?:freelancers?|salaried professionals?|self-employed|medical|travel|home renovation|education|wedding|business)|for (?:medical expenses?|travel|home renovation|freelancers?|salaried professionals?|self-employed))\b/i;
  const signals = compactSignals([
    ...urls.filter((href) => urlPattern.test(href) || textPattern.test(urlPathSearchText(href))),
    ...pages
      .filter((page) => urlPattern.test(page.url ?? "") || textPattern.test(pageSearchText(page)))
      .map((page) => page.url ?? pageSearchText(page))
  ]);
  const score = signals.length >= 3 ? 10 : signals.length >= 1 ? 5 : 0;

  return { score, signalCount: signals.length, signals };
}

interface TrustPageCandidate {
  url: string;
  anchorText: string;
}

function footerTrustUrls(pageHtml: string, root: URL): TrustPageCandidate[] {
  const footerStart = Math.floor(pageHtml.length * 0.8);
  const footerHtml = pageHtml.slice(footerStart);
  const footer$ = cheerio.load(footerHtml);
  return footer$("a[href]").toArray()
    .map((el) => {
      try {
        return {
          url: new URL(footer$(el).attr("href") ?? "", root).toString(),
          anchorText: footer$(el).text().replace(/\s+/g, " ").trim()
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is TrustPageCandidate => item !== null);
}

function trustCandidateText(candidate: TrustPageCandidate, title = "", h1 = "") {
  let path = candidate.url;
  try {
    const parsed = new URL(candidate.url);
    path = decodeURIComponent(`${parsed.pathname} ${parsed.search}`);
  } catch {
    path = candidate.url;
  }

  return `${path} ${candidate.anchorText} ${title} ${h1}`.replace(/[_-]+/g, " ");
}

async function merchantTrustEvidence(candidates: TrustPageCandidate[]) {
  const trustTypes = [
    { type: "Privacy/Terms", pattern: /\b(policies privacy policy|policies terms of service|policies legal|privacy|privacy policy|terms|terms of service|terms and conditions|tnc|t and c|legal|disclaimer|cookie policy)\b/i },
    { type: "Refund/Returns", pattern: /\b(policies refund policy|policies return policy|policies cancellation policy|refund|refund policy|cancellation|cancellation policy|return|returns|return policy|money back)\b/i },
    { type: "Shipping/Delivery", pattern: /\b(policies shipping policy|policies delivery policy|shipping|shipping policy|delivery|delivery policy|fulfillment)\b/i },
    { type: "Contact/Support", pattern: /\b(pages contact|contact|contact us|support|help|helpdesk|grievance|reach us|get in touch)\b/i }
  ];

  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()];
  const found = new Map<string, Set<string>>();
  const markFound = (type: string, href: string) => {
    if (!found.has(type)) found.set(type, new Set());
    found.get(type)?.add(href);
  };

  for (const candidate of uniqueCandidates) {
    const text = trustCandidateText(candidate);
    trustTypes.forEach((item) => {
      if (item.pattern.test(text)) markFound(item.type, candidate.url);
    });
  }

  const broadTrustPattern = /\b(privacy|terms?|tnc|legal|disclaimer|cookie|refund|returns?|cancellation|money back|shipping|delivery|fulfillment|contact|support|helpdesk|grievance|reach|get in touch)\b/i;
  const titleCandidates = uniqueCandidates
    .filter((candidate) => broadTrustPattern.test(trustCandidateText(candidate)))
    .slice(0, 20);

  await Promise.all(titleCandidates.map(async (candidate) => {
    try {
      const { response, text } = await fetchText(candidate.url, 1600);
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !/html|text/i.test(contentType) || !text.trim()) return;
      const page$ = cheerio.load(text);
      const pageText = trustCandidateText(candidate, page$("title").first().text(), page$("h1").first().text());
      trustTypes.forEach((item) => {
        if (item.pattern.test(pageText)) markFound(item.type, candidate.url);
      });
    } catch {
      // Trust page discovery should keep going when an individual candidate times out.
    }
  }));

  const foundList = trustTypes
    .filter((item) => found.has(item.type))
    .map((item) => ({ type: item.type, urls: [...(found.get(item.type) ?? [])].slice(0, 3) }));
  const missing = trustTypes.filter((item) => !found.has(item.type)).map((item) => item.type);
  const score = foundList.length === 4 ? 10 : foundList.length >= 2 ? 6 : 0;
  return { score, found: foundList, missing };
}

async function directTrustPageCandidates(origin: string): Promise<TrustPageCandidate[]> {
  const paths = [
    "/policies/privacy-policy",
    "/policies/refund-policy",
    "/policies/shipping-policy",
    "/policies/terms-of-service",
    "/contact-us",
    "/privacy-policy",
    "/terms-of-service"
  ];

  const fetched = await Promise.all(paths.map(async (path): Promise<TrustPageCandidate | null> => {
    const href = `${origin}${path}`;
    try {
      const { response } = await fetchText(href, 1400);
      return response.status === 200 ? { url: href, anchorText: path.replace(/[-/]/g, " ") } : null;
    } catch {
      return null;
    }
  }));

  return fetched.filter((item): item is TrustPageCandidate => item !== null);
}

function productSchemaFieldScore(records: Record<string, unknown>[]) {
  const required = ["name", "brand", "offers", "aggregateRating"];
  const present = new Set<string>();
  records.forEach((record) => {
    required.forEach((field) => {
      if (record[field]) present.add(field);
    });
  });
  const percent = records.length ? Math.round((present.size / required.length) * 100) : 100;
  const score = percent >= 80 ? 10 : percent >= 60 ? 6 : 0;
  return { present: present.size, total: required.length, percent, score };
}

function reviewDiversity(records: Record<string, unknown>[]) {
  const ratings = findObjects(records, (record) => Boolean(record.ratingValue || record.reviewRating || record.aggregateRating));
  const aggregate = findObjects(records, (record) => Boolean(record.ratingValue && record.reviewCount)).at(0);
  const ratingValue = Number(aggregate?.ratingValue ?? 0);
  const reviewCount = Number(aggregate?.reviewCount ?? 0);
  const suspiciousPerfect = ratingValue === 5 && reviewCount >= 20;
  return { ratings: ratings.length, ratingValue, reviewCount, suspiciousPerfect };
}

function schemaScriptCount(html: string) {
  return cheerio.load(html)("script[type='application/ld+json']").length;
}

async function renderedWordCount(url: string, timeoutMs = 8000) {
  if (process.env.AIVA_ENABLE_RENDERED_AUDIT !== "true") {
    return { words: null, schemaCount: null, error: "Rendered browser audit disabled" };
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
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
        const html = await page.content();
        return {
          words: wordCount(cheerio.load(html)("body").text()),
          schemaCount: schemaScriptCount(html)
        };
      } finally {
        await Promise.race([
          browser.close(),
          new Promise((resolve) => setTimeout(resolve, 1000))
        ]);
      }
    })();

    return await Promise.race([work, timeoutPromise]);
  } catch (error) {
    return { words: null, schemaCount: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function geminiWafEvidence(page: { response: Response; text: string } | null) {
  const status = page?.response.status ?? 0;
  const htmlLength = page?.text.length ?? 0;
  const text = page?.text ?? "";
  const challenge = challengeDetected(status, text);
  const explicitlyBlocked = status === 403 || challenge;
  const accessible = Boolean(page && status === 200 && htmlContentExists(text) && !challenge);
  return {
    pass: accessible,
    conclusive: explicitlyBlocked || accessible,
    explicitlyBlocked,
    status,
    htmlLength,
    challengeDetected: challenge
  };
}

function schemaTextValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      const nestedValue: string = schemaTextValue(nested, ["streetAddress", "addressLocality", "addressRegion", "postalCode"]);
      if (nestedValue) return nestedValue;
    }
  }
  return "";
}

function extractNapFromHtml(html: string, source = "page") {
  const page$ = cheerio.load(html);
  const parsed = parseJsonLd(page$);
  const businessRecords = findObjects(parsed.blocks, (record) =>
    flattenSchemaTypes(record).some((type) => /LocalBusiness|Organization|Store|Corporation/i.test(type))
  );
  const schemaRecord = businessRecords.at(0);
  const metaText = page$("meta[name],meta[property]").toArray().map((el) => page$(el).attr("content") ?? "").join(" ");
  const visibleText = page$("body").text().replace(/\s+/g, " ").trim();
  const footerText = page$("body").text().slice(Math.floor(page$("body").text().length * 0.7)).replace(/\s+/g, " ").trim();
  const contactText = page$("[class*='contact'],[class*='address'],[class*='phone'],[class*='email'],[class*='location'],[class*='office']")
    .text()
    .replace(/\s+/g, " ")
    .trim();
  const napText = `${contactText} ${footerText} ${visibleText}`;
  const phonePattern = /(\+91[\s-]?)?[6-9]\d{9}|1800[\s-]?\d{3}[\s-]?\d{4}/i;
  const addressPattern = /\b(?:street|road|nagar|mumbai|delhi|bangalore|bengaluru|floor|building|plot|sector|phase)\b.{0,140}/i;
  const phone = schemaRecord ? schemaTextValue(schemaRecord, ["telephone", "phone"]) : "";
  const addressValue = schemaRecord?.address;
  const address = typeof addressValue === "string"
    ? addressValue
    : addressValue && typeof addressValue === "object"
      ? ["streetAddress", "addressLocality", "addressRegion", "postalCode"].map((key) => (addressValue as Record<string, unknown>)[key]).filter(Boolean).join(", ")
      : "";

  const name = schemaRecord ? schemaTextValue(schemaRecord, ["name", "legalName"]) : page$("meta[property='og:site_name']").attr("content") ?? page$("title").first().text().trim();
  const foundAddress = address || (napText.match(addressPattern)?.[0] ?? "");
  const foundPhone = phone || (napText.match(phonePattern)?.[0] ?? metaText.match(phonePattern)?.[0] ?? "");
  const sources = [
    ...(schemaRecord ? [`${source}: schema`] : []),
    ...(page$("meta[property='og:site_name']").attr("content") ? [`${source}: meta`] : []),
    ...(footerText.match(phonePattern) || footerText.match(addressPattern) ? [`${source}: footer`] : []),
    ...(contactText.match(phonePattern) || contactText.match(addressPattern) ? [`${source}: contact html`] : [])
  ];

  return { name, address: foundAddress, phone: foundPhone, sources };
}

function normalizeNap(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function napConsistency(pages: LocalPageHtml[]) {
  const checked = pages.slice(0, 10).map((page) => ({ url: page.url ?? page.source, nap: extractNapFromHtml(page.html, page.source) }));
  const found = checked.filter((page) => page.nap.name || page.nap.address || page.nap.phone);
  const first = found.at(0)?.nap;
  const consistent = first ? found.every((page) =>
    (!first.name || !page.nap.name || normalizeNap(first.name) === normalizeNap(page.nap.name)) &&
    (!first.address || !page.nap.address || normalizeNap(first.address) === normalizeNap(page.nap.address)) &&
    (!first.phone || !page.nap.phone || normalizeNap(first.phone).slice(-8) === normalizeNap(page.nap.phone).slice(-8))
  ) : false;
  const pass = found.length === 1 || (found.length > 1 && consistent);

  return {
    pass,
    napFound: found.length > 0,
    name: first?.name ?? "",
    address: first?.address ?? "",
    phone: first?.phone ?? "",
    consistent,
    pages_checked: checked.length,
    sources: [...new Set(found.flatMap((page) => page.nap.sources))],
    ...(found.length === 1 ? { note: "NAP found on one page only - verify across all pages manually" } : {}),
    ...(!found.length ? { reason: "No NAP data found in schema, footer, or contact page - add LocalBusiness schema" } : {})
  };
}

function cookieConsentEvidence(html: string) {
  const page$ = cheerio.load(html);
  const rawWordCount = wordCount(page$("body").text());
  const consentPatternFound = /cookie consent|accept cookies|gdpr|before you continue/i.test(html);
  const consentWallDetected = consentPatternFound && rawWordCount < 200;
  return { pass: !consentWallDetected, rawWordCount, consentPatternFound, consentWallDetected };
}

function speakableEvidence(blocks: unknown[], pageText = "") {
  const isNewsOrPublisher =
    /\b(news|publisher|magazine|journal|article|editorial)\b/i.test(pageText);

  const found = findObjects(blocks, (record) =>
    flattenSchemaTypes(record).some((type) => /SpeakableSpecification/i.test(type)) ||
    Object.prototype.hasOwnProperty.call(record, "speakable")
  ).length > 0;

  if (!isNewsOrPublisher && !found) {
    return { skipped: true, pass: true, found, reason: "Not applicable for non-news/media websites" };
  }

  return { pass: found, found };
}

function imageSources($: cheerio.CheerioAPI) {
  return $("img").toArray().map((el) => ({
    src: $(el).attr("src") ?? $(el).attr("data-src") ?? "",
    alt: $(el).attr("alt") ?? ""
  })).filter((image) => image.src);
}

function stockPhotoEvidence(images: ReturnType<typeof imageSources>) {
  const stockPattern = /shutterstock\.com|gettyimages\.com|istockphoto\.com|unsplash\.com|pexels\.com|freepik\.com|depositphotos\.com|stock\.adobe\.com|dreamstime\.com|123rf\.com/i;
  const stockImages = images.map((image) => image.src).filter((src) => stockPattern.test(src)).slice(0, 10);
  const score = stockImages.length === 0 ? 10 : stockImages.length <= 2 ? 5 : 0;
  return { score, stockCount: stockImages.length, stockImages, totalImages: images.length };
}

function ocrLegibilityEvidence(images: ReturnType<typeof imageSources>) {
  const withAlt = images.filter((image) => image.alt.trim().length > 10).length;
  const withoutAlt = images.length - withAlt;
  const score = images.length ? Math.round((withAlt / images.length) * 10) : 10;
  return { score, totalImages: images.length, withAlt, withoutAlt, advisory: withoutAlt > 0 };
}

function videoSchemaEvidence($: cheerio.CheerioAPI, blocks: unknown[]) {
  const videosFound = $("video,iframe[src*='youtube'],iframe[src*='youtu.be'],iframe[src*='vimeo']").length;
  const schemasFound = findObjects(blocks, (record) => flattenSchemaTypes(record).some((type) => /VideoObject/i.test(type))).length;
  const ratio = videosFound ? schemasFound / videosFound : 1;
  const score = !videosFound ? 10 : ratio >= 0.7 ? 10 : ratio >= 0.3 ? 5 : 0;
  return { score, videosFound, schemasFound, ratio: Number(ratio.toFixed(2)) };
}

function entitySet(text: string) {
  return new Set((text.match(/\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|\d+(?:\.\d+)?%?|\d{4})\b/g) ?? []).map((item) => item.toLowerCase()));
}

function transcriptAlignmentEvidence($: cheerio.CheerioAPI, body: string) {
  const videoCount = $("video,iframe[src*='youtube'],iframe[src*='youtu.be'],iframe[src*='vimeo']").length;
  const transcriptText = $("[class*='transcript'],[id*='transcript'],section:contains('Transcript'),track").text().replace(/\s+/g, " ").trim();
  if (!videoCount) return { skipped: true, reason: "No video content detected" };
  if (!transcriptText) return { skipped: true, reason: "Videos found but no transcript detected - add transcript to enable this check" };
  const transcriptEntities = entitySet(transcriptText);
  const contentEntities = entitySet(body);
  const overlap = [...transcriptEntities].filter((entity) => contentEntities.has(entity)).length;
  const overlapPct = transcriptEntities.size ? Math.round((overlap / transcriptEntities.size) * 100) : 0;
  const score = overlapPct >= 70 ? 10 : overlapPct >= 40 ? 5 : 0;
  return { score, entitiesInTranscript: transcriptEntities.size, entitiesInContent: contentEntities.size, overlapPct };
}

function headerCanonical(response?: Response | null) {
  const link = response?.headers.get("link") ?? "";
  return link.match(/<([^>]+)>\s*;\s*rel=["']?canonical["']?/i)?.[1] ?? "";
}

function rawHtmlCanonicalHref(html: string) {
  const page$ = cheerio.load(html);
  let href = "";
  page$("link").each((_, el) => {
    if (href) return;
    const rel = page$(el).attr("rel") ?? "";
    if (/(^|\s)canonical(\s|$)/i.test(rel)) href = (page$(el).attr("href") ?? "").trim();
  });
  return href;
}

function canonicalHref(html: string, baseUrl: string, response?: Response | null) {
  const page$ = cheerio.load(html);
  let href = "";
  page$("link").each((_, el) => {
    if (href) return;
    const rel = page$(el).attr("rel") ?? "";
    if (/(^|\s)canonical(\s|$)/i.test(rel)) href = (page$(el).attr("href") ?? "").trim();
  });
  href ||= headerCanonical(response).trim();
  if (!href) return "";
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function normalizeComparableUrl(value: string) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

function safeAbsoluteUrl(value: string, baseUrl: string) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function robotsDirectives(html: string, response?: Response | null) {
  const page$ = cheerio.load(html);
  const meta = page$("meta[name='robots' i],meta[name='googlebot' i]").toArray().map((el) => page$(el).attr("content") ?? "").join(",");
  const header = response?.headers.get("x-robots-tag") ?? "";
  return `${meta},${header}`;
}

function noindexFoundIn(html: string, response?: Response | null) {
  const directives = robotsDirectives(html, response);
  return /(^|,|\s)noindex(,|\s|$)/i.test(directives);
}

function nosnippetFound(html: string, response?: Response | null) {
  return /nosnippet/i.test(robotsDirectives(html, response));
}

function maxSnippetValue(html: string, response?: Response | null) {
  const directives = robotsDirectives(html, response);
  const match = directives.match(/max-snippet\s*:\s*(-?\d+)/i);
  return match ? Number(match[1]) : null;
}

function maxImagePreviewValue(html: string, response?: Response | null) {
  return robotsDirectives(html, response).match(/max-image-preview\s*:\s*([a-z]+)/i)?.[1]?.toLowerCase() ?? "";
}

async function fetchNoRedirect(url: string, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "AIVisibilityAnalyzer/1.0", accept: "text/html,*/*" }
    });
    const text = await limitedResponseText(response).catch(() => "");
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function httpToHttpsEvidence(currentUrl: URL) {
  const httpUrl = new URL(currentUrl.toString());
  httpUrl.protocol = "http:";
  const fetched = await fetchNoRedirect(httpUrl.toString()).catch(() => null);
  const location = fetched?.response.headers.get("location") ?? "";
  const redirectTarget = safeAbsoluteUrl(location || currentUrl.toString(), httpUrl.toString());
  const redirectsToHttps = [301, 308].includes(fetched?.response.status ?? 0) && /^https:\/\//i.test(redirectTarget);
  return { pass: redirectsToHttps, httpStatus: fetched?.response.status ?? 0, redirectsToHttps };
}

async function wwwVariantEvidence(currentUrl: URL) {
  const host = currentUrl.hostname;
  const wwwHost = host.startsWith("www.") ? host : `www.${host}`;
  const nonWwwHost = host.replace(/^www\./, "");
  const wwwUrl = new URL(currentUrl.toString());
  wwwUrl.hostname = wwwHost;
  const nonWwwUrl = new URL(currentUrl.toString());
  nonWwwUrl.hostname = nonWwwHost;
  const [www, nonWww] = await Promise.all([
    fetchNoRedirect(wwwUrl.toString()).catch(() => null),
    fetchNoRedirect(nonWwwUrl.toString()).catch(() => null)
  ]);
  const wwwStatus = www?.response.status ?? 0;
  const nonWwwStatus = nonWww?.response.status ?? 0;
  const wwwLocation = www?.response.headers.get("location") ?? "";
  const nonWwwLocation = nonWww?.response.headers.get("location") ?? "";
  const wwwRedirectsToNon = [301, 308].includes(wwwStatus) && wwwLocation.includes(nonWwwHost);
  const nonRedirectsToWww = [301, 308].includes(nonWwwStatus) && nonWwwLocation.includes(wwwHost);
  const pass = wwwRedirectsToNon || nonRedirectsToWww || wwwHost === nonWwwHost;
  return { pass, wwwStatus, nonWwwStatus, canonicalVariant: wwwRedirectsToNon ? nonWwwHost : nonRedirectsToWww ? wwwHost : "" };
}

function hiddenContentEvidence($: cheerio.CheerioAPI) {
  const hiddenClassPattern = /\b(d-none|hidden|invisible|sr-only|visually-hidden|hide|collapsed)\b/i;
  const responsiveClassPattern = /(?:^|\s)(elementor-hidden-(?:desktop|tablet|mobile|phone)|e-con-inner|vc_hidden-(?:xs|sm|md|lg)|et_pb_hidden|et-hide-(?:mobile|tablet)|d(?:-(?:sm|md|lg|xl))?-none|hidden-(?:xs|sm|md|lg)|(?:sm|md|lg|xl):hidden|oxy-hide-on-(?:mobile|tablet)|hide-(?:mobile|tablet|desktop)|(?:mobile|tablet|desktop)-hidden|show-(?:mobile|desktop))(?:\s|$)/i;
  const hiddenTriggerFor = (style: string, classes: string, hasHiddenAttribute: boolean) => {
    if (/display\s*:\s*none/i.test(style)) return "style:display:none";
    if (/visibility\s*:\s*hidden/i.test(style)) return "style:visibility:hidden";
    if (/opacity\s*:\s*0/i.test(style)) return "style:opacity:0";
    if (hasHiddenAttribute) return "hidden attribute";
    const classTrigger = classes.split(/\s+/).find((className) => hiddenClassPattern.test(className) || responsiveClassPattern.test(` ${className} `));
    return classTrigger ? `class:${classTrigger}` : "unknown hidden selector";
  };
  const hiddenElements = $("*").toArray().filter((el) => {
    const node = $(el);
    const style = node.attr("style") ?? "";
    const classes = node.attr("class") ?? "";
    return /display\s*:\s*none/i.test(style) ||
      /visibility\s*:\s*hidden/i.test(style) ||
      /opacity\s*:\s*0/i.test(style) ||
      node.attr("hidden") !== undefined ||
      hiddenClassPattern.test(classes);
  });
  const semanticClassPattern = /\b(modal|menu|nav|sidebar|overlay|drawer|offcanvas|dropdown|tooltip|popup|burger|hamburger|flyout|panel|skip|screen-reader|sr-only|visually-hidden|showBottomAction|hover|show-on-hover|reveal|product-action|card-action|quick-action)\b/i;
  const autoExemptCategoryPattern: Record<string, RegExp> = {
    accordion: /\b(accordion|collapse|collapsible|faq)\b/i,
    tab: /\b(tab-pane|tab-content)\b/i,
    offscreen: /\b(offscreen|off-screen|visually-hidden|sr-only)\b/i,
    animation: /\b(animate|aos|fade|slide)\b/i
  };
  const uiActionPattern = /^(?:wishlist|add to bag|add to cart|preview|preview shades|quick view|buy now)(?:\s+(?:wishlist|add to bag|add to cart|preview|preview shades|quick view|buy now))*$/i;
  const visibleText = $("body").clone().find("[style*='display:none'],[style*='visibility:hidden'],[style*='opacity:0'],[hidden],script,style").remove().end().text().replace(/\s+/g, " ").trim().toLowerCase();
  const categories = { accordion: 0, tab: 0, offscreen: 0, animation: 0, duplicate: 0, unknown: 0 };
  let hiddenWordCount = 0;
  let excludedWordCount = 0;
  let responsiveExcludedWordCount = 0;
  let unknownElementCount = 0;
  const excludedClasses = new Set<string>();
  const hiddenSamples: Array<{ tag: string; classNames: string; text: string; hiddenBy: string; category: string }> = [];

  hiddenElements.forEach((el) => {
    const node = $(el);
    const tag = String(node.prop("tagName") ?? "").toLowerCase();
    const text = node.clone().find("script,style").remove().end().text().replace(/\s+/g, " ").trim();
    const words = wordCount(text);
    const style = node.attr("style") ?? "";
    const classes = node.attr("class") ?? "";
    const role = node.attr("role") ?? "";
    const hasResponsiveClass = responsiveClassPattern.test(` ${classes} `);
    const semanticExcluded =
      hasResponsiveClass ||
      ["nav", "header", "footer", "aside", "script", "style"].includes(tag) ||
      /dialog|modal|navigation/i.test(role) ||
      node.attr("aria-hidden") === "true" ||
      semanticClassPattern.test(classes) ||
      node.parents("nav,header,footer").length > 0;
    const autoCategory = Object.entries(autoExemptCategoryPattern).find(([, pattern]) => pattern.test(classes))?.[0] as keyof typeof categories | undefined;
    const isDuplicate = text.length >= 30 && visibleText.includes(text.toLowerCase().slice(0, 120));
    const isShortUiText = words < 10 || uiActionPattern.test(text);
    const category = semanticExcluded
      ? "semantic"
      : isShortUiText
        ? "ui-action"
        : autoCategory ?? (isDuplicate ? "duplicate" : "unknown");

    if (category in categories) categories[category as keyof typeof categories] += words;

    if (semanticExcluded || category !== "unknown") {
      excludedWordCount += words;
      if (hasResponsiveClass) responsiveExcludedWordCount += words;
      classes.split(/\s+/).filter(Boolean).forEach((className) => {
        if (
          semanticClassPattern.test(className) ||
          hiddenClassPattern.test(className) ||
          responsiveClassPattern.test(` ${className} `) ||
          Object.values(autoExemptCategoryPattern).some((pattern) => pattern.test(className))
        ) excludedClasses.add(className);
      });
    } else {
      hiddenWordCount += words;
      unknownElementCount += 1;
      if (hiddenSamples.length < 10 && words > 0) {
        hiddenSamples.push({
          tag,
          classNames: classes,
          text: text.slice(0, 100),
          hiddenBy: hiddenTriggerFor(style, classes, node.attr("hidden") !== undefined),
          category
        });
      }
    }
  });

  const totalHidden = hiddenWordCount + excludedWordCount;
  const isResponsiveOnly = totalHidden > 0 && hiddenWordCount === 0 && responsiveExcludedWordCount === totalHidden;
  const averageUnknownWords = unknownElementCount ? hiddenWordCount / unknownElementCount : 0;
  const isUiActionOnly = unknownElementCount > 0 && averageUnknownWords < 5;
  return {
    pass: isResponsiveOnly || isUiActionOnly || hiddenWordCount < 100 || averageUnknownWords <= 20,
    hiddenWordCount,
    excludedWordCount,
    totalHidden,
    categories,
    hiddenSamples,
    averageUnknownWords: Number(averageUnknownWords.toFixed(1)),
    excludedClasses: [...excludedClasses].slice(0, 25),
    isResponsiveOnly,
    ...(isResponsiveOnly ? { note: "Hidden content is responsive layout only, not spam" } : {}),
    ...(isUiActionOnly ? { note: "Hidden content is short UI action labels, not spam" } : {})
  };
}

function dataNosnippetEvidence($: cheerio.CheerioAPI) {
  const affectedElements = $("[data-nosnippet]").toArray()
    .map((el) => ({ tag: el.tagName?.toLowerCase() ?? "element", words: wordCount($(el).text()) }))
    .filter((item) => item.words > 50);
  return { pass: affectedElements.length === 0, count: $("[data-nosnippet]").length, affectedElements };
}

function backButtonHijackEvidence(html: string) {
  const scriptsFound = (html.match(/history\.(?:pushState|replaceState)|onpopstate/gi) ?? []);
  return { pass: scriptsFound.length === 0, scriptsFound: [...new Set(scriptsFound)] };
}

function infiniteScrollEvidence(html: string, $: cheerio.CheerioAPI) {
  const paginationFound = $("a[href*='page='],a[href*='?p='],a[href*='/page/2'],link[rel='next'],link[rel='prev']").length > 0;
  const infiniteScrollSignals = [
    ...new Set((html.match(/IntersectionObserver|addEventListener\(['"]scroll|onscroll/gi) ?? []))
  ];
  return { pass: paginationFound || infiniteScrollSignals.length === 0, paginationFound, infiniteScrollSignals };
}

function hreflangEvidence($: cheerio.CheerioAPI, currentUrl: string) {
  const hreflangTags = $("link[rel='alternate'][hreflang]").toArray().map((el) => ({
    hreflang: $(el).attr("hreflang") ?? "",
    href: $(el).attr("href") ?? ""
  }));
  if (!hreflangTags.length) return { pass: true, reason: "Not multilingual", hreflangTags, issues: [] as string[] };
  const issues: string[] = [];
  if (!hreflangTags.some((tag) => tag.hreflang.toLowerCase() === "x-default")) issues.push("x-default missing");
  hreflangTags.forEach((tag) => {
    if (tag.hreflang.toLowerCase() !== "x-default" && !/^[a-z]{2}(?:-[a-z]{2})?$/i.test(tag.hreflang)) issues.push(`Invalid hreflang ${tag.hreflang}`);
  });
  if (!hreflangTags.some((tag) => {
    const href = safeAbsoluteUrl(tag.href, currentUrl);
    return href && normalizeComparableUrl(href) === normalizeComparableUrl(currentUrl);
  })) issues.push("Self-referencing hreflang missing");
  return { pass: issues.length === 0, hreflangTags, issues };
}

function paginationEvidence($: cheerio.CheerioAPI, currentUrl: string, canonicalUrl: string) {
  const relNextPrev = $("link[rel='next'],link[rel='prev']").length;
  const paginationLinks = $("a[href*='page='],a[href*='?p='],a[href*='/page/']").length;
  const hasPagination = relNextPrev > 0 || paginationLinks > 0 || /(?:[?&]page=|\/page\/\d+)/i.test(currentUrl);
  const canonicalToPageOne = hasPagination && canonicalUrl ? !/[?&]page=\d+|\/page\/\d+/i.test(canonicalUrl) : false;
  const handledCorrectly = !hasPagination || relNextPrev > 0 || !canonicalToPageOne;
  const score = !hasPagination ? 10 : handledCorrectly ? 10 : relNextPrev > 0 ? 5 : 0;
  return { score, hasPagination, handledCorrectly };
}

function soft404Evidence(response: Response | null | undefined, body: string, currentUrl: string, title = "", h1 = "") {
  const status = response?.status ?? 0;
  const words = wordCount(body);
  let reason = "";
  let isHomepage = false;
  try {
    const parsed = new URL(currentUrl);
    isHomepage = parsed.pathname === "/" || /\/index\.(?:html?|php)$/i.test(parsed.pathname);
  } catch {
    isHomepage = false;
  }

  const titleSuggestsMissing = /\b(not found|404|error)\b/i.test(title);
  const h1SuggestsMissing = /\b(not found|page not found|doesn't exist)\b/i.test(h1);
  const softFourOhFourDetected = !isHomepage && status === 200 && words < 300 && (titleSuggestsMissing || h1SuggestsMissing);

  if (isHomepage) reason = "Homepage skipped for soft-404 detection";
  else if (words > 500) reason = "Page has more than 500 words, not a soft-404";
  else if (softFourOhFourDetected) reason = "Thin 200 page with not-found title or H1";
  else reason = "No soft-404 signals";

  return { pass: !softFourOhFourDetected, status, softFourOhFourDetected, wordCount: words, reason };
}

function parameterUrlEvidence(currentUrl: URL, canonicalUrl: string) {
  const hasParameters = Boolean(currentUrl.search);
  const canonicalTarget = canonicalUrl ? safeAbsoluteUrl(canonicalUrl, currentUrl.toString()) : "";
  const canonicalClean = !hasParameters || (canonicalTarget ? !new URL(canonicalTarget).search : false);
  return { pass: !hasParameters || canonicalClean, hasParameters, canonicalClean };
}

async function searchIndexEvidence(searchUrl: string, domain: string, note: string) {
  if (process.env.AIVA_ENABLE_LIVE_SERP_AUDIT !== "true") {
    return { pass: true, indexed: null, skipped: true, note: `${note}; live SERP fetch disabled` };
  }
  const result = await fetchText(searchUrl, 3500).catch(() => null);
  const indexed = Boolean(result?.response.ok && result.text.toLowerCase().includes(domain.toLowerCase()));
  return { pass: indexed, indexed, note };
}

async function sitemapNoindexEvidence(urls: string[]) {
  const sample = urls.slice(0, 5);
  const checked = await Promise.all(sample.map(async (href) => {
    const page = await fetchText(href, 1400).catch(() => null);
    return page && noindexFoundIn(page.text, page.response) ? href : "";
  }));
  const noindexedUrls = checked.filter(Boolean);
  return { pass: noindexedUrls.length === 0, checkedUrls: sample.length, noindexedUrls: noindexedUrls.slice(0, 10) };
}

function fleschReadingEase(text: string) {
  const sentences = Math.max((text.match(/[.!?]+/g) ?? []).length, 1);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const syllables = words.reduce((sum, word) => {
    const clean = word.toLowerCase().replace(/[^a-z]/g, "");
    const groups = clean.match(/[aeiouy]+/g)?.length ?? 1;
    return sum + Math.max(1, groups - (clean.endsWith("e") ? 1 : 0));
  }, 0);
  return 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / Math.max(words.length, 1));
}

function standaloneH2Sections($: cheerio.CheerioAPI) {
  const headings = $("h2").toArray();
  return headings.map((heading) => {
    const title = $(heading).text().trim();
    let text = "";
    let node = $(heading).next();
    while (node.length && node.get(0)?.tagName?.toLowerCase() !== "h2") {
      text += ` ${node.text()}`;
      node = node.next();
    }
    const words = wordCount(text);
    return { title, words, answerLike: words >= 40 && /\b(is|are|means|includes|helps|use|should|can|will|because|for example)\b/i.test(text) };
  });
}

function productSchemaComplete(records: Record<string, unknown>[]) {
  return records.some((record) => Boolean(record.name && (record.offers || record.aggregateRating || record.review)));
}

function addCheck(
  results: GeoAeoCheckResult[],
  id: number,
  passed: boolean,
  evidence: string,
  options: {
    warning?: boolean;
    priorityScore?: number;
    recommendation?: string;
    severity?: GeoAeoSeverity;
  } = {}
) {
  const def = CHECKS.find((check) => check.id === id);
  if (!def) return;
  results.push({
    ...def,
    severity: options.severity ?? def.severity,
    passed,
    evidence,
    ...(options.warning && !passed ? { warning: true } : {}),
    ...(options.priorityScore !== undefined ? { priorityScore: options.priorityScore } : {}),
    ...(options.recommendation ? { recommendation: options.recommendation } : {})
  });
}

function addSkippedCheck(results: GeoAeoCheckResult[], id: number, evidence: string) {
  const def = CHECKS.find((check) => check.id === id);
  if (!def) return;
  results.push({ ...def, passed: true, evidence, skipped: true });
}

function addNotApplicableCheck(results: GeoAeoCheckResult[], id: number, evidence: string) {
  const def = CHECKS.find((check) => check.id === id);
  if (!def) return;
  results.push({ ...def, passed: true, evidence, skipped: true, notApplicable: true });
}

function addInformationalCheck(
  results: GeoAeoCheckResult[],
  id: number,
  evidence: string,
  opportunity: string
) {
  const def = CHECKS.find((check) => check.id === id);
  if (!def) return;
  results.push({
    ...def,
    passed: true,
    evidence,
    informational: true,
    opportunity,
    priorityScore: 0,
    recommendation: opportunity
  });
}

function categorySummaries(checks: GeoAeoCheckResult[], failedDetails: GeoAeoFailedCheckDetail[] = [], skippedDetails: GeoAeoSkippedCheckDetail[] = []): GeoAeoCategorySummary[] {
  return CATEGORY_ORDER.filter((categoryName) => checks.some((check) => check.category === categoryName)).map((categoryName) => {
    const categoryChecks = checks.filter((check) => check.category === categoryName);
    const scorableChecks = categoryChecks.filter((check) => !check.skipped);
    const failedChecks = scorableChecks.filter((check) => !check.passed && !check.warning).length;
    const warningChecks = scorableChecks.filter((check) => check.warning).length;
    const categoryFailedDetails = failedDetails.filter((detail) => categoryChecks.some((check) => check.id === detail.id));
    const categorySkippedDetails = skippedDetails.filter((detail) => categoryChecks.some((check) => check.id === detail.id));
    const skippedChecks = categoryChecks.filter((check) => check.skipped).length;

    return {
      categoryName,
      totalChecks: categoryChecks.length,
      passedChecks: scorableChecks.filter((check) => check.passed).length,
      failedChecks,
      warningChecks,
      skippedChecks,
      score: scorableChecks.length
  ? clamp((scorableChecks.filter((check) => check.passed || check.warning).length / scorableChecks.length) * 100)
  : 100,
      status: scorableChecks.length === 0 ? "Skipped" : warningChecks > 0 && failedChecks === 0 ? "Minor Attention" : statusFor(failedChecks),
      ...(categoryFailedDetails.length ? { failedCheckDetails: categoryFailedDetails } : {}),
      ...(categorySkippedDetails.length ? { skippedCheckDetails: categorySkippedDetails } : {})
    };
  });
}

function scoreByScope(checks: GeoAeoCheckResult[], scope: GeoAeoScope) {
  const scoped = checks.filter((check) => check.scope === scope && !check.skipped && check.severity !== "ADVISORY");
  if (!scoped.length) return 100;
  return clamp((scoped.filter((check) => check.passed).length / scoped.length) * 100);
}

function opportunityCounts(checks: GeoAeoCheckResult[]): GeoAeoOpportunityCounts {
  const failed = checks.filter((check) => !check.passed && !check.skipped);
  return {
    high: failed.filter((check) => !check.warning && check.scope === "domain").length,
    medium: failed.filter((check) => !check.warning && check.scope === "page").length,
    low: failed.filter((check) => check.warning || check.severity === "ADVISORY").length
  };
}

function geoPageEvidence(
  pagesCrawled: number,
  applicablePages: LocalPageHtml[],
  failingPages: LocalPageHtml[],
  issue: string
) {
  const urls = failingPages.map((page, index) => page.url ?? `unknown-page-${index + 1}`);
  return JSON.stringify({
    scope: "page-level-site-wide",
    pagesCrawled,
    pagesChecked: applicablePages.length,
    pagesPassed: Math.max(0, applicablePages.length - failingPages.length),
    pagesFailed: failingPages.length,
    passRate: applicablePages.length
      ? Number((((applicablePages.length - failingPages.length) / applicablePages.length) * 100).toFixed(1))
      : 100,
    affectedPages: urls.map((url) => ({ url, issueCount: 1, sampleEvidence: issue })),
    sampleEvidence: urls.map((url) => ({ url, issue }))
  });
}

function pageClassification(page: LocalPageHtml) {
  const page$ = cheerio.load(page.html);
  const title = page$("title").first().text();
  const h1 = page$("h1").first().text();
  const text = page$("body").text().replace(/\s+/g, " ").trim();
  const url = page.url ?? "";
  const headingContext = `${url} ${title} ${h1}`;
  const article = page$("article").length > 0
    || /\/(?:blog|articles?|news|insights?|guides?)\//i.test(url)
    || /\b(?:blog|article|guide|news|insight)\b/i.test(headingContext)
      && /\b(?:author|published|updated|reading time)\b/i.test(text);
  const faq = page$("details,.faq,[id*='faq' i],[class*='faq' i]").length > 0
    || /\b(?:frequently asked questions|faq|questions and answers)\b/i.test(headingContext);
  const help = /\/(?:help|support|knowledge-base|docs?)\//i.test(url)
    || /\b(?:help|support|documentation|knowledge base)\b/i.test(headingContext);
  const research = /\b(?:research|study|report|analysis|survey|data|methodology|statistics)\b/i.test(headingContext);
  const informational = article || faq || help || research;
  const ymyl = /\b(?:loan|credit|finance|financial|investment|insurance|medical|health|doctor|clinic|legal|law|tax|mortgage)\b/i.test(`${headingContext} ${text.slice(0, 2000)}`);
  return { page$, title, h1, text, url, article, faq, help, research, informational, ymyl };
}

function hiddenPrimaryContentEvidence(page: LocalPageHtml) {
  const page$ = cheerio.load(page.html);
  const primary = page$("main,article,[role='main']").first();
  if (!primary.length) {
    return { url: page.url ?? "", primaryContainerFound: false, hiddenWords: 0, hiddenRatio: 0, samples: [] as string[] };
  }

  const hiddenElements = primary
    .find("[hidden],[aria-hidden='true'],[style*='display:none' i],[style*='display: none' i],[style*='visibility:hidden' i],[style*='visibility: hidden' i]")
    .toArray()
    .filter((element) => {
      const node = page$(element);
      const excludedContainer = node.closest("nav,header,footer,details,dialog,[role='dialog'],[role='menu'],[role='navigation']").length > 0;
      const uiContext = `${node.attr("class") ?? ""} ${node.attr("id") ?? ""}`;
      return !excludedContainer && !/\b(?:modal|menu|nav|accordion|carousel|slider|tab-panel|tooltip|cookie|consent)\b/i.test(uiContext);
    });
  const uniqueTopLevel = hiddenElements.filter((element) =>
    !hiddenElements.some((candidate) => candidate !== element && page$(element).parents().toArray().includes(candidate))
  );
  const hiddenText = uniqueTopLevel.map((element) => page$(element).text().replace(/\s+/g, " ").trim()).filter(Boolean);
  const hiddenWords = hiddenText.reduce((sum, text) => sum + wordCount(text), 0);
  const primaryWords = wordCount(primary.text());
  return {
    url: page.url ?? "",
    primaryContainerFound: true,
    hiddenWords,
    hiddenRatio: primaryWords ? Number((hiddenWords / primaryWords).toFixed(2)) : 0,
    samples: hiddenText.slice(0, 3).map((text) => text.slice(0, 180))
  };
}

function scoreGeoChecks(checks: GeoAeoCheckResult[]) {
  const scorable = checks.filter((check) => !check.skipped && check.severity !== "ADVISORY");
  return scoreParameterOutcomes(scorable, 100);
}

export async function runGeoAeoAudit(inputUrl: string, html?: string): Promise<GeoAeoAuditResult> {
  const normalizedUrl = normalizeUrl(inputUrl);
  const url = new URL(normalizedUrl);
  const origin = `${url.protocol}//${url.host}`;
  const pageHtml = html ?? await fetchText(normalizedUrl, 3000).then((result) => result.text).catch(() => "");
  const emptyCrawl = {
    origin,
    sitemapUrls: [],
    crawlStats: {
      targetUrls: 0,
      attemptedUrls: 0,
      htmlPages: 0,
      failedOrNonHtmlUrls: 0,
      cappedByMaxPages: false
    },
    pages: []
  };
  const [
    robots,
    llms,
    localPages,
    crawled,
    oaiPage,
    gptBotPage,
    chatgptUserPage,
    googleExtendedPage,
    serverPage,
    browserPage,
    extraSitemapResult,
    directTrustCandidates
  ] = await Promise.all([
    fetchText(`${origin}/robots.txt`, 1800).catch(() => null),
    fetchText(`${origin}/llms.txt`, 1400).catch(() => null),
    resolveWithin(fetchLikelyLocalPageEntries(origin), 4200, []),
    resolveWithin(crawlSite(normalizedUrl, { maxPages: 4, maxDepth: 1, timeoutMs: 1200, concurrency: 4, maxSitemapFiles: 1 }), 6500, emptyCrawl),
    fetchTextWithUserAgent(normalizedUrl, "OAI-SearchBot/1.0", 1800).catch(() => null),
    fetchTextWithUserAgent(normalizedUrl, "GPTBot/1.0", 1800).catch(() => null),
    fetchTextWithUserAgent(normalizedUrl, "ChatGPT-User/1.0", 1800).catch(() => null),
    fetchTextWithUserAgent(normalizedUrl, "Google-Extended", 1800).catch(() => null),
    fetchText(normalizedUrl, 1800).catch(() => null),
    fetchTextWithUserAgent(normalizedUrl, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36", 1800).catch(() => null),
    fetchSitemapUrls(origin, 1600, 1).catch(() => null),
    resolveWithin(directTrustPageCandidates(origin), 3200, [])
  ]);
  const extraSitemapUrls = extraSitemapResult?.urls ?? [];
  const crawledPages: LocalPageHtml[] = crawled.pages.map((page) => ({
    source: page.source === "homepage" ? "homepage" : page.source === "sitemap" ? "sitemap page" : "internal page",
    html: page.html,
    url: page.finalUrl
  }));
  const sitePages = crawledPages.length ? crawledPages : [{ source: "homepage", html: pageHtml, url: normalizedUrl }];
  const measurablePageContent = sitePages.some((page) => wordCount(cheerio.load(page.html)("body").text()) > 0);
  const classifiedPages = sitePages.map((page) => ({ page, ...pageClassification(page) }));
  const articlePages = classifiedPages.filter((item) => item.article);
  const informationalPages = classifiedPages.filter((item) => item.informational);
  const blufPages = classifiedPages.filter((item) => item.article || item.help || item.research);
  const faqIntentPages = classifiedPages.filter((item) => item.faq);
  const ymylExpertPages = classifiedPages.filter((item) => item.article && item.ymyl);
  const researchPages = classifiedPages.filter((item) => item.informational || item.research);
  const siteHtml = sitePages.map((page) => page.html).join("\n");
  const localGeoPages: LocalPageHtml[] = [...sitePages, ...localPages];
  const localGeoHtml = localGeoPages.map((page) => page.html).join("\n");
  const $ = cheerio.load(siteHtml);
  const localGeo$ = cheerio.load(localGeoHtml);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const lowerBody = bodyText.toLowerCase();
  const localGeoBodyText = localGeo$("body").text().replace(/\s+/g, " ").trim();
  const localGeoLowerBody = localGeoBodyText.toLowerCase();
  const jsonLd = parseJsonLd($);
  const localGeoJsonLd = parseJsonLd(localGeo$);
  const schemaTypes = jsonLd.blocks.flatMap(flattenSchemaTypes);
  const localGeoSchemaTypes = localGeoJsonLd.blocks.flatMap(flattenSchemaTypes);
  const sameAs = sameAsUrls(jsonLd.blocks);
  const visibleOfficialProfiles = [...new Set(
    $("a[href]").toArray()
      .map((element) => String($(element).attr("href") ?? ""))
      .filter((href) => /^https?:\/\//i.test(href))
      .filter((href) => /linkedin\.com|facebook\.com|instagram\.com|youtube\.com|x\.com|twitter\.com|crunchbase\.com|wikidata\.org/i.test(href))
  )];
  const faqDomCount = $("details, .faq, [class*='faq'], [id*='faq']").length;
  const questionCount = (bodyText.match(/\?/g) ?? []).length + $("h2,h3").toArray().filter((el) => /\?|\b(what|how|why|when|where|who|can|does|is|are)\b/i.test($(el).text())).length;
  const links = $("a[href]").toArray().map((el) => String($(el).attr("href") ?? "")).filter((href) => /^https?:/i.test(href) && !sameOrigin(url, href));
  const hiddenPrimaryEvidence = sitePages.map(hiddenPrimaryContentEvidence);
  const hiddenPrimaryFailures = hiddenPrimaryEvidence.filter((item) => item.hiddenWords >= 100 && item.hiddenRatio >= 0.2);
  const dataPointCount = (bodyText.match(/\b\d+(?:\.\d+)?%|\b\d{4}\b|\b\d+(?:,\d{3})+\b/g) ?? []).length;
  const localBusinessObjects = localEntityObjectsFromJsonLd(localGeoJsonLd.blocks);
  const localOrganizationObjects = organizationObjectsFromJsonLd(localGeoJsonLd.blocks);
  const localMicrodataRdfa = microdataRdfaLocalSignals(localGeo$);
  const localMapSignals = mapsCoordinateSignals(localGeo$, localGeoHtml);
  const localEvidence = localGeoEvidence(localGeoPages);
  const localTargetPages = localGeoPages.filter((page) => {
    const page$ = cheerio.load(page.html);
    const text = page$("body").text().replace(/\s+/g, " ").trim();
    const pageUrl = page.url ?? "";
    const titleAndHeading = `${page$("title").first().text()} ${page$("h1").first().text()}`;
    const localSeoTarget = /\/(?:locations?|branches?|stores?|clinics?|offices?|near-me)(?:\/|$)/i.test(pageUrl)
      || /\b(?:near me|our (?:location|branch|office|clinic|store)|(?:branch|office|clinic|store|services?) in [A-Z][A-Za-z]+|serving [A-Z][A-Za-z]+|local service area)\b/.test(`${titleAndHeading} ${text.slice(0, 1200)}`);
    const conversionLocation = page$("address,a[href^='tel:'],iframe[src*='google.com/maps'],iframe[src*='maps.google']").length > 0
      || visibleNapSignal(text);
    return localSeoTarget && conversionLocation;
  });
  const localGeoApplicable = localBusinessObjects.length > 0
    && localTargetPages.length > 0
    && visibleAddressSignal(localGeoBodyText);
  const productObjects = findObjects(jsonLd.blocks, (record) => flattenSchemaTypes(record).some((type) => /Product/i.test(type)));
  const faqObjects = findObjects(jsonLd.blocks, (record) => flattenSchemaTypes(record).some((type) => /FAQPage/i.test(type)));
  const robotsText = robots?.text ?? "";
  const h2s = h2Texts($);
  const h2Progression = ["what", "why", "how", "benefit", "comparison|compare|vs", "faq|question", "next|action"].filter((pattern) => h2s.some((text) => new RegExp(pattern, "i").test(text)));
  const followUpSections = ["pricing", "comparison|compare|vs", "alternatives?", "setup", "implementation", "faq|questions"].filter((pattern) => new RegExp(pattern, "i").test(`${bodyText} ${h2s.join(" ")}`));
  const readability = fleschReadingEase(bodyText);
  const sectionScores = standaloneH2Sections($);
  const extractableSections = sectionScores.filter((section) => section.answerLike).length;
  const factCount = (bodyText.match(/\b\d+(?:\.\d+)?%|\b\d{4}\b|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) ?? []).length;
  const factDensity = wordCount(bodyText) ? (factCount / wordCount(bodyText)) * 100 : 0;
  const evidenceSignals = $("a[href^='http'], cite, blockquote").length + (bodyText.match(/\b(source|reference|according to|study|report|research)\b/gi) ?? []).length;
  const reviewSignals = (bodyText.match(/\b(review|reviews|rating|ratings|testimonial|testimonials)\b/gi) ?? []).length;
  const freshReviewSignals = (bodyText.match(/\b(2024|2025|2026|recent|latest|verified)\b/gi) ?? []).length;
  const reviewSourceSignals = ["google", "trustpilot", "g2", "capterra", "facebook", "yelp"].filter((source) => lowerBody.includes(source)).length;
  const nosnippet = /nosnippet|max-snippet:0/i.test(`${pageHtml} ${oaiPage?.response.headers.get("x-robots-tag") ?? ""}`) || $("[data-nosnippet]").length > 0;
  const oaiWords = wordCount(cheerio.load(oaiPage?.text ?? "")("body").text());
  const browserWords = wordCount(cheerio.load(browserPage?.text ?? pageHtml)("body").text());
  const rawWords = wordCount(bodyText);
  const renderedResult = await renderedWordCount(normalizedUrl);
  const renderedWords = renderedResult.words;
  const renderedSchemaCount = renderedResult.schemaCount;
  const oaiAgents = [
    { name: "GPTBot", page: gptBotPage },
    { name: "OAI-SearchBot", page: oaiPage },
    { name: "ChatGPT-User", page: chatgptUserPage }
  ];
  const oaiAgentResults = oaiAgents.map(({ name, page }) => ({
    name,
    status: page?.response.status ?? 0,
    htmlLength: page?.text.length ?? 0,
    challengeDetected: page ? challengeDetected(page.response.status, page.text) : false,
    accessible: Boolean(page && page.response.status === 200 && htmlContentExists(page.text) && !challengeDetected(page.response.status, page.text))
  }));
  const conclusiveOaiAgentResults = oaiAgentResults.filter((agent) => agent.status > 0);
  const blockedOaiAgentResults = conclusiveOaiAgentResults.filter((agent) =>
    agent.status === 401 || agent.status === 403 || agent.challengeDetected
  );
  const inconclusiveOaiAgentResults = oaiAgentResults.filter((agent) =>
    agent.status === 0 || (!agent.accessible && agent.status !== 401 && agent.status !== 403 && !agent.challengeDetected)
  );
  const oaiWafDebug = {
    pass: conclusiveOaiAgentResults.length === oaiAgentResults.length
      && blockedOaiAgentResults.length === 0
      && conclusiveOaiAgentResults.every((agent) => agent.accessible),
    agents: oaiAgentResults,
    robotsAllowed: {
      GPTBot: robotGroupAllows(robotsText, "GPTBot"),
      OAI_SearchBot: robotGroupAllows(robotsText, "OAI-SearchBot"),
      ChatGPT_User: robotGroupAllows(robotsText, "ChatGPT-User")
    }
  };
  const oaiNotChallenged = oaiWafDebug.pass;
  const paywallRatio = browserWords ? oaiWords / browserWords : 0;
  const browserPaywallDetected = paywallDetected(browserPage?.text ?? pageHtml);
  const oaiPaywallDetected = paywallDetected(oaiPage?.text ?? "");
  const explicitPaywallDetected = browserPaywallDetected || oaiPaywallDetected;
  const sitemapAndPageUrls = [...new Set([...crawled.sitemapUrls, ...extraSitemapUrls, ...sitePages.map((page) => page.url ?? "").filter(Boolean)])];
  const alternativesSignals = alternativesPageDetection(sitePages, sitemapAndPageUrls);
  const useCaseSignals = useCasePageDetection(sitePages, sitemapAndPageUrls);
  const productFieldScore = productSchemaFieldScore(productObjects);
  const reviewDiversitySignal = reviewDiversity(productObjects);
  const merchantTrust = await merchantTrustEvidence([
    ...sitemapAndPageUrls.map((href) => ({ url: href, anchorText: "" })),
    ...footerTrustUrls(pageHtml, url),
    ...directTrustCandidates
  ]);
  const geminiWaf = geminiWafEvidence(googleExtendedPage);
  const ipRangeEvidence = {
    skipped: true,
    googleIpVerified: false,
    ipBasedTestPerformed: false,
    reason: "Unable to verify Google IP access from current crawl environment."
  };
  const napEvidence = napConsistency(localGeoPages);
  const googleBusinessProfileUrls = localGeo$("a[href]").toArray()
    .map((element) => String(localGeo$(element).attr("href") ?? ""))
    .filter((href) => /google\.(?:com|co\.[a-z]{2})\/maps|maps\.app\.goo\.gl|g\.page\//i.test(href));
  const physicalLocationExists = visibleAddressSignal(localGeoBodyText);
  const gbpVerificationAvailable = false;
  const napGbpApplicable = localBusinessObjects.length > 0
    && physicalLocationExists
    && localTargetPages.length > 0
    && googleBusinessProfileUrls.length > 0
    && gbpVerificationAvailable;
  const consentEvidence = cookieConsentEvidence(pageHtml);
  const rawSchemaCount = schemaScriptCount(pageHtml);
  const schemaInjectionEvidence = renderedSchemaCount === null
    ? { skipped: true, reason: renderedResult.error ?? "Puppeteer unavailable" }
    : { pass: rawSchemaCount >= renderedSchemaCount, rawSchemaCount, renderedSchemaCount, jsInjected: rawSchemaCount < renderedSchemaCount };
  const speakable = speakableEvidence(jsonLd.blocks);
  const images = imageSources($);
  const stockPhoto = stockPhotoEvidence(images);
  const ocrLegibility = ocrLegibilityEvidence(images);
  const videoSchema = videoSchemaEvidence($, jsonLd.blocks);
  const transcriptAlignment = transcriptAlignmentEvidence($, bodyText);
  const rawCanonicalUrl = rawHtmlCanonicalHref(pageHtml);
  const responseHeaderCanonical = headerCanonical(serverPage?.response);
  const canonicalUrl = canonicalHref(pageHtml, normalizedUrl, serverPage?.response);
  const [canonicalTarget, canonicalTargetNoRedirect] = await Promise.all([
    canonicalUrl ? fetchText(canonicalUrl, 1800).catch(() => null) : Promise.resolve(null),
    canonicalUrl ? fetchNoRedirect(canonicalUrl, 1800).catch(() => null) : Promise.resolve(null)
  ]);
  const secondCanonicalUrl = canonicalTarget ? canonicalHref(canonicalTarget.text, canonicalUrl, canonicalTarget.response) : "";
  const noindexFound = [
    ...(noindexFoundIn(pageHtml, serverPage?.response) ? ["page"] : []),
    ...(canonicalTarget && noindexFoundIn(canonicalTarget.text, canonicalTarget.response) ? ["canonicalTarget"] : [])
  ];
  const htmlCanonical = rawCanonicalUrl ? safeAbsoluteUrl(rawCanonicalUrl, normalizedUrl) : "";
  const maxSnippet = maxSnippetValue(pageHtml, serverPage?.response);
  const maxImagePreview = maxImagePreviewValue(pageHtml, serverPage?.response);
  const hiddenEvidence = hiddenContentEvidence($);
  const dataNosnippet = dataNosnippetEvidence($);
  const [httpHttps, wwwVariant] = await Promise.all([
    httpToHttpsEvidence(url),
    wwwVariantEvidence(url)
  ]);
  const anonymousWordCount = wordCount(cheerio.load(serverPage?.text ?? pageHtml)("body").text());
  const backButtonHijack = backButtonHijackEvidence(pageHtml);
  const infiniteScroll = infiniteScrollEvidence(pageHtml, $);
  const hreflang = hreflangEvidence($, normalizedUrl);
  const pagination = paginationEvidence($, normalizedUrl, canonicalUrl);
  const soft404 = soft404Evidence(serverPage?.response, bodyText, normalizedUrl, $("title").first().text(), $("h1").first().text());
  const parameterUrl = parameterUrlEvidence(url, canonicalUrl);
  const [googleIndex, bingIndex, sitemapNoindex] = await Promise.all([
    searchIndexEvidence(`https://www.google.com/search?q=site:${encodeURIComponent(url.hostname)}`, url.hostname, "Advisory only - verify in GSC"),
    searchIndexEvidence(`https://www.bing.com/search?q=site:${encodeURIComponent(url.hostname)}`, url.hostname, "Advisory only - verify in Bing WMT"),
    sitemapNoindexEvidence(sitemapAndPageUrls)
  ]);
  const ssrRatio = renderedWords ? oaiWords / renderedWords : null;
  const pageUrl = (page: LocalPageHtml, index: number) => page.url ?? `${origin}/#sample-${index + 1}`;
  const pageText = (page: LocalPageHtml) => cheerio.load(page.html)("body").text().replace(/\s+/g, " ").trim();
  const failingPages = (predicate: (page: LocalPageHtml) => boolean) => sitePages.filter(predicate);
  const affectedPagesFor = (check: GeoAeoCheckResult) => {
    try {
      const parsed = JSON.parse(check.evidence) as Record<string, unknown>;
      const affectedPages = Array.isArray(parsed.affectedPages) ? parsed.affectedPages : [];
      const urls = affectedPages.flatMap((item) => {
        if (typeof item === "string") return item ? [item] : [];
        if (!item || typeof item !== "object") return [];
        const href = String((item as Record<string, unknown>).url ?? "").trim();
        return href ? [href] : [];
      });
      if (urls.length) return { affectedPages: urls.length, sampleUrls: urls.slice(0, 3) };
    } catch {
      // Legacy evidence is normalized below before report output.
    }
    const domain = () => check.passed ? [] : sitePages;
    const pageFailures = (() => {
      switch (check.id) {
        case 42:
        case 66:
          return check.passed ? [] : sitePages;
        case 65:
          return failingPages((page) => /nosnippet|max-snippet:0/i.test(page.html) || cheerio.load(page.html)("[data-nosnippet]").length > 0);
        default:
          return check.scope === "domain" ? domain() : check.passed ? [] : sitePages;
      }
    })();
    const urls = pageFailures.map(pageUrl).filter(Boolean);
    return {
      affectedPages: urls.length,
      sampleUrls: urls.slice(0, 3)
    };
  };
  const result: GeoAeoCheckResult[] = [];

  [
    ["GPTBot", 1],
    ["Google-Extended", 4],
    ["OAI-SearchBot", 5]
  ].forEach(([bot, id]) => {
    addCheck(result, Number(id), robotGroupAllows(robots?.text ?? "", String(bot)), robots?.response.status ? `robots.txt ${robots.response.status}` : "robots.txt unavailable");
  });

  addCheck(result, 8, llms?.response.ok === true, `Status ${llms?.response.status ?? "missing"}`);
  addCheck(result, 9, llms?.response.ok === true && /^#|\n[-*]\s|\[[^\]]+\]\([^)]+\)/m.test(llms.text), "llms.txt markdown scan");
  addCheck(result, 10, llms?.response.ok === true && wordCount(llms.text) >= 200, `${wordCount(llms?.text ?? "")} words`);
  addCheck(result, 11, llms?.response.ok === true && ["about", "service", "contact", "policy"].filter((term) => llms.text.toLowerCase().includes(term)).length >= 2, "llms.txt completeness scan");
  const verifiedProfilesMissingFromSchema = visibleOfficialProfiles.filter((href) => !sameAs.includes(href));
  if (!sameAs.length && !visibleOfficialProfiles.length) {
    addSkippedCheck(result, 12, "sameAs is optional and no verified official profiles were detected");
  } else {
    addCheck(
      result,
      12,
      sameAs.length > 0,
      JSON.stringify({
        scope: "domain-level",
        pagesCrawled: sitePages.length,
        pagesChecked: 1,
        pagesPassed: sameAs.length > 0 ? 1 : 0,
        pagesFailed: sameAs.length > 0 ? 0 : 1,
        passRate: sameAs.length > 0 ? 100 : 0,
        affectedPages: sameAs.length > 0 ? [] : [{ url: normalizedUrl, issueCount: 1 }],
        sameAsUrls: sameAs,
        verifiedOfficialProfiles: visibleOfficialProfiles,
        missingVerifiedProfiles: verifiedProfilesMissingFromSchema
      }),
      {
        warning: true,
        priorityScore: 20,
        recommendation: "Optional entity reinforcement: add only verified official profile URLs to Organization sameAs."
      }
    );
  }
  if (sameAs.some((href) => /linkedin\.com/i.test(href))) {
    addCheck(result, 13, true, JSON.stringify({ pagesCrawled: sitePages.length, pagesChecked: 1, pagesFailed: 0, linkedinFound: true }));
  } else {
    addSkippedCheck(result, 13, "LinkedIn is optional; no verified official LinkedIn profile was detected in Organization sameAs");
  }
  if (sameAs.some((href) => /crunchbase\.com|wikidata\.org/i.test(href))) {
    addCheck(result, 14, true, JSON.stringify({ pagesCrawled: sitePages.length, pagesChecked: 1, pagesFailed: 0, authorityProfileFound: true }));
  } else {
    addSkippedCheck(result, 14, "Crunchbase and Wikidata are optional; no verified profile was detected and no profile should be created only for this check");
  }
  addCheck(result, 15, (
    !localBusinessObjects.length &&
    !localOrganizationObjects.length &&
    !localMicrodataRdfa.hasLocalEntity &&
    !visibleNapSignal(localGeoBodyText)
  ) || localBusinessObjects.some((record) => {
    const phone = typeof record.telephone === "string" ? record.telephone.replace(/\D/g, "") : "";
    const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
    return (!phone || localGeoBodyText.replace(/\D/g, "").includes(phone.slice(-7))) && (!name || localGeoLowerBody.includes(name));
  }) || localOrganizationObjects.some((record) => {
    const phone = typeof record.telephone === "string" ? record.telephone.replace(/\D/g, "") : "";
    const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
    return (!phone || localGeoBodyText.replace(/\D/g, "").includes(phone.slice(-7))) && (!name || localGeoLowerBody.includes(name));
  }) || (
    localMicrodataRdfa.hasLocalEntity &&
    (!localMicrodataRdfa.phone || localGeoBodyText.replace(/\D/g, "").includes(localMicrodataRdfa.phone.replace(/\D/g, "").slice(-7))) &&
    (!localMicrodataRdfa.name || localGeoLowerBody.includes(localMicrodataRdfa.name.toLowerCase().trim()))
  ) || visibleNapSignal(localGeoBodyText), "NAP consistency scan");
  addCheck(result, 16, jsonLd.errors.length === 0 && schemaTypes.length > 0, `${jsonLd.errors.length} JSON-LD errors`);
  if (!faqIntentPages.length) {
    addSkippedCheck(result, 17, "No FAQ intent page was detected");
    addSkippedCheck(result, 18, "No visible FAQ intent was detected, so FAQPage schema is not required");
    addSkippedCheck(result, 19, "No FAQPage schema or applicable FAQ page was detected");
  } else {
    const faqSectionFailures = faqIntentPages.filter(({ page$ }) => page$("details,.faq,[id*='faq' i],[class*='faq' i]").length === 0);
    addCheck(result, 17, faqSectionFailures.length === 0, geoPageEvidence(sitePages.length, faqIntentPages.map((item) => item.page), faqSectionFailures.map((item) => item.page), "FAQ-intent page has no visible FAQ section"));
    const faqSchemaFailures = faqIntentPages.filter(({ page$ }) => {
      const parsed = parseJsonLd(page$);
      const visibleFaq = page$("details,.faq,[id*='faq' i],[class*='faq' i]").length > 0;
      return visibleFaq && !hasSchemaType(parsed.blocks, /FAQPage/);
    });
    addCheck(result, 18, faqSchemaFailures.length === 0, geoPageEvidence(sitePages.length, faqIntentPages.map((item) => item.page), faqSchemaFailures.map((item) => item.page), "Visible FAQs exist without matching FAQPage schema"));
    const faqCompletenessFailures = faqIntentPages.filter(({ page$ }) => {
      const objects = findObjects(parseJsonLd(page$).blocks, (record) => flattenSchemaTypes(record).some((type) => /FAQPage/i.test(type)));
      return objects.length > 0 && !objects.some((record) => Array.isArray(record.mainEntity) && record.mainEntity.length >= 2);
    });
    addCheck(result, 19, faqCompletenessFailures.length === 0, geoPageEvidence(sitePages.length, faqIntentPages.map((item) => item.page), faqCompletenessFailures.map((item) => item.page), "FAQPage mainEntity is incomplete"));
  }
  if (!blufPages.length) {
    addNotApplicableCheck(result, 20, "BLUF is advisory and no article, guide, help, or research page was detected");
  } else {
    const blufFailures = blufPages.filter(({ page$ }) => !/\b(in short|bottom line|summary|answer:|tl;dr)\b/i.test(page$("body").text()) && page$("main p,article p").first().text().trim().length < 80);
    addCheck(result, 20, blufFailures.length === 0, geoPageEvidence(sitePages.length, blufPages.map((item) => item.page), blufFailures.map((item) => item.page), "Informational page does not provide a concise answer-first introduction"), {
      warning: true,
      priorityScore: 15,
      recommendation: "Add a concise answer-first summary where it improves clarity; keep this advisory for informational content."
    });
  }
  if (!informationalPages.length) {
    addNotApplicableCheck(result, 21, "Question-based structure is advisory and no blog, guide, FAQ, or help page was detected");
  } else {
    const questionStructureFailures = informationalPages.filter(({ page$ }) =>
      page$("h2,h3").toArray().filter((element) => /\?|\b(what|how|why|when|where|who|can|does|is|are)\b/i.test(page$(element).text())).length < 1
    );
    addCheck(result, 21, questionStructureFailures.length === 0, geoPageEvidence(sitePages.length, informationalPages.map((item) => item.page), questionStructureFailures.map((item) => item.page), "Informational page has no question-led heading structure"), {
      warning: true,
      priorityScore: 15,
      recommendation: "Use question-based headings only where they match real reader intent on blog, guide, FAQ, or help pages."
    });
  }
  if (!articlePages.length) {
    addNotApplicableCheck(result, 22, "Author byline checks run only on article or blog pages");
    addNotApplicableCheck(result, 23, "Author bio checks run only on article or blog pages");
    addNotApplicableCheck(result, 26, "Visible updated-date checks run only on article or blog pages");
  } else {
    const bylineFailures = articlePages.filter(({ page }) => !/author|byline|written by|reviewed by/i.test(page.html));
    addCheck(result, 22, bylineFailures.length === 0, geoPageEvidence(sitePages.length, articlePages.map((item) => item.page), bylineFailures.map((item) => item.page), "Article page has no visible author byline"));
    const bioFailures = articlePages.filter(({ page$ }) => page$("a[href*='/author/'],a[href*='/team/'],a[href*='/about'],.author-bio,[class*='author' i]").length === 0);
    addCheck(result, 23, bioFailures.length === 0, geoPageEvidence(sitePages.length, articlePages.map((item) => item.page), bioFailures.map((item) => item.page), "Article author has no visible bio or profile link"));
    const updatedFailures = articlePages.filter(({ page }) => !/dateModified|last updated|updated on|last-modified/i.test(page.html));
    addCheck(result, 26, updatedFailures.length === 0, geoPageEvidence(sitePages.length, articlePages.map((item) => item.page), updatedFailures.map((item) => item.page), "Article page has no visible updated date"));
  }
  if (!ymylExpertPages.length) {
    addNotApplicableCheck(result, 24, "Credentials and certifications are checked only for YMYL or expert-authored content");
  } else {
    const credentialFailures = ymylExpertPages.filter(({ text }) => !/\b(certified|credential|licensed|award|degree|accredited|specialist|expert)\b/i.test(text));
    addCheck(result, 24, credentialFailures.length === 0, geoPageEvidence(sitePages.length, ymylExpertPages.map((item) => item.page), credentialFailures.map((item) => item.page), "YMYL article provides no visible author credential or expertise signal"));
  }
  if (!informationalPages.length) {
    addSkippedCheck(result, 25, "First-hand experience language is advisory and no informational content page was detected");
  } else {
    const experienceFailures = informationalPages.filter(({ text }) => !/\b(we tested|our experience|case study|results|client|customer|first-hand|hands-on)\b/i.test(text));
    addCheck(result, 25, experienceFailures.length === 0, geoPageEvidence(sitePages.length, informationalPages.map((item) => item.page), experienceFailures.map((item) => item.page), "No first-hand experience language was detected"), {
      warning: true,
      priorityScore: 10,
      recommendation: "Add first-hand observations, methodology, examples, or outcomes only when they are genuine and relevant."
    });
  }
  if (!researchPages.length) {
    addSkippedCheck(result, 27, "Outbound authority links are checked only on informational or research-style content");
  } else {
    const authorityLinkFailures = researchPages.filter(({ page$, page }) => {
      const pageUrl = new URL(page.url ?? normalizedUrl);
      return page$("a[href]").toArray().filter((element) => {
        const href = String(page$(element).attr("href") ?? "");
        return /^https?:/i.test(href) && !sameOrigin(pageUrl, href);
      }).length < 1;
    });
    addCheck(result, 27, authorityLinkFailures.length === 0, geoPageEvidence(sitePages.length, researchPages.map((item) => item.page), authorityLinkFailures.map((item) => item.page), "Informational page cites no external authority source"));
  }
  if (!localTargetPages.length) {
    addNotApplicableCheck(result, 28, "No conversion-relevant local SEO or physical-location page was detected");
  } else {
    const localEntityFound = localBusinessObjects.length > 0 || localMicrodataRdfa.hasLocalEntity;
    addCheck(
      result,
      28,
      localEntityFound,
      geoPageEvidence(sitePages.length, localTargetPages, localEntityFound ? [] : localTargetPages, "Local SEO page has no applicable LocalBusiness entity schema")
    );
  }
  if (!localGeoApplicable) {
    addNotApplicableCheck(result, 29, "LocalBusiness geo checks are not applicable without LocalBusiness schema and a conversion-relevant local SEO page");
    addNotApplicableCheck(result, 30, "LocalBusiness geo checks are not applicable without LocalBusiness schema and a conversion-relevant local SEO page");
    addNotApplicableCheck(result, 31, "areaServed is not applicable without LocalBusiness schema and a visible physical service area");
  } else {
    addCheck(result, 29, jsonLdHasProperty(localBusinessObjects, "latitude") || localMicrodataRdfa.hasLatitude || localMapSignals.hasLatitude, geoPageEvidence(sitePages.length, localTargetPages, (jsonLdHasProperty(localBusinessObjects, "latitude") || localMicrodataRdfa.hasLatitude || localMapSignals.hasLatitude) ? [] : localTargetPages, "Applicable local page has no latitude signal"), { severity: "MINOR" });
    addCheck(result, 30, jsonLdHasProperty(localBusinessObjects, "longitude") || localMicrodataRdfa.hasLongitude || localMapSignals.hasLongitude, geoPageEvidence(sitePages.length, localTargetPages, (jsonLdHasProperty(localBusinessObjects, "longitude") || localMicrodataRdfa.hasLongitude || localMapSignals.hasLongitude) ? [] : localTargetPages, "Applicable local page has no longitude signal"), { severity: "MINOR" });
    const hasAreaServed = jsonLdHasProperty(localBusinessObjects, "areaServed")
      || jsonLdHasProperty(localBusinessObjects, "serviceArea")
      || localMicrodataRdfa.hasAreaServed
      || visibleAreaServedSignal(localGeoBodyText);
    addCheck(result, 31, hasAreaServed, geoPageEvidence(sitePages.length, localTargetPages, hasAreaServed ? [] : localTargetPages, "Applicable local service page has no areaServed signal"), { severity: "MINOR" });
  }
  addCheck(result, 32, wordCount(bodyText) >= 100, JSON.stringify({ pagesCrawled: sitePages.length, pagesChecked: 1, pagesFailed: wordCount(bodyText) >= 100 ? 0 : 1, affectedPages: wordCount(bodyText) >= 100 ? [] : [{ url: normalizedUrl, issueCount: 1 }], rawHtmlWords: wordCount(bodyText) }), {
    recommendation: "Ensure primary content is available in the initial HTML response or server-rendered markup."
  });
  const hiddenPrimaryPagesChecked = hiddenPrimaryEvidence.filter((item) => item.primaryContainerFound).length;
  if (!hiddenPrimaryPagesChecked) {
    addSkippedCheck(result, 33, "Insufficient evidence: no main, article, or role=main container was detected for reliable hidden-primary-content analysis");
  } else {
    addCheck(result, 33, hiddenPrimaryFailures.length === 0, JSON.stringify({
      pagesCrawled: sitePages.length,
      pagesChecked: hiddenPrimaryPagesChecked,
      pagesFailed: hiddenPrimaryFailures.length,
      affectedPages: hiddenPrimaryFailures.map((item) => ({
        url: item.url,
        issueCount: 1,
        sampleEvidence: `Important primary content is hidden (${item.hiddenWords} words; ${Math.round(item.hiddenRatio * 100)}% of primary content)`
      })),
      samples: hiddenPrimaryFailures.slice(0, 3)
    }), {
      recommendation: "Keep important primary content visible in the initial page experience. Hidden menus, dialogs, accordions, and interface controls are excluded from this check."
    });
  }
  if (!informationalPages.length) {
    addSkippedCheck(result, 34, "Data point density is advisory and no informational content page was detected");
  } else {
    const dataPointFailures = informationalPages.filter(({ text }) => (text.match(/\b\d+(?:\.\d+)?%|\b\d{4}\b|\b\d+(?:,\d{3})+\b/g) ?? []).length < 3);
    addCheck(result, 34, dataPointFailures.length === 0, geoPageEvidence(sitePages.length, informationalPages.map((item) => item.page), dataPointFailures.map((item) => item.page), "Informational page has low measurable fact density"), {
      warning: true,
      priorityScore: 20,
      recommendation: "Add factual details, numbers, examples, comparisons, or entity-rich statements where relevant."
    });
  }
  addCheck(result, 35, !faqObjects.length || questionCount >= 2, "FAQ schema-DOM consistency scan");
  addCheck(result, 36, !productObjects.length || productObjects.some((record) => {
    const productName = typeof record.name === "string" ? record.name.toLowerCase() : "";
    return !productName || lowerBody.includes(productName);
  }), "Product schema-DOM consistency scan");
  addCheck(result, 37, jsonLd.errors.length === 0, `${jsonLd.errors.length} JSON-LD errors`);
  addCheck(result, 38, robotGroupAllows(robotsText, "OAI-SearchBot"), robots?.response.status ? `robots.txt ${robots.response.status}` : "robots.txt unavailable");
  addCheck(result, 39, robotGroupAllows(robotsText, "ChatGPT-User"), robots?.response.status ? `robots.txt ${robots.response.status}` : "robots.txt unavailable");
  addCheck(result, 40, robotGroupAllows(robotsText, "OAI-SearchBot") && robotGroupAllows(robotsText, "ChatGPT-User"), robotGroupFor(robotsText, "GPTBot") ? "GPTBot group checked against OAI agents" : "No explicit GPTBot group");
  if (inconclusiveOaiAgentResults.length > 0 && blockedOaiAgentResults.length === 0) {
    addSkippedCheck(result, 41, JSON.stringify({ ...oaiWafDebug, skipped: true, reason: "Insufficient evidence: one or more OAI agent responses were unavailable or inconclusive" }));
  } else {
    addCheck(result, 41, oaiNotChallenged, JSON.stringify(oaiWafDebug), {
      recommendation: "Remove the observed WAF, CAPTCHA, or bot challenge for the affected OAI agent on public pages."
    });
  }
  if (!browserPage && !oaiPage && !pageHtml) {
    addSkippedCheck(result, 42, "Insufficient evidence: no anonymous page response was available for paywall detection");
  } else {
    addCheck(result, 42, !explicitPaywallDetected, JSON.stringify({
      pagesCrawled: sitePages.length,
      pagesChecked: 1,
      pagesFailed: explicitPaywallDetected ? 1 : 0,
      affectedPages: explicitPaywallDetected ? [{ url: normalizedUrl, issueCount: 1, sampleEvidence: "Explicit login, subscription, registration, membership, or hidden-content wall detected" }] : [],
      browserPaywallDetected,
      oaiPaywallDetected,
      browserTextSample: visibleBodyText(browserPage?.text ?? pageHtml).slice(0, 240),
      oaiTextSample: visibleBodyText(oaiPage?.text ?? "").slice(0, 240),
      anonWords: browserWords,
      oaiWords,
      ratio: browserWords ? Number(paywallRatio.toFixed(2)) : null
    }), {
      recommendation: "Make the affected citable content visible without requiring login, subscription, membership, or registration."
    });
  }
  if (alternativesSignals.score > 0) {
    addCheck(result, 49, true, JSON.stringify(alternativesSignals));
  } else {
    addInformationalCheck(result, 49, JSON.stringify(alternativesSignals), "Create comparison or alternatives pages to increase citation coverage.");
  }
  if (useCaseSignals.score > 0) {
    addCheck(result, 50, true, JSON.stringify(useCaseSignals));
  } else {
    addInformationalCheck(result, 50, JSON.stringify(useCaseSignals), "Create use-case pages targeting specific audiences, industries, or scenarios.");
  }
  if (!productObjects.length) {
    addNotApplicableCheck(result, 52, "Product schema completeness is not applicable because no Product schema was detected");
  } else {
    addCheck(result, 52, productFieldScore.score >= 6, `${productFieldScore.present}/${productFieldScore.total} Product schema fields present (${productFieldScore.percent}%); score ${productFieldScore.score}/10`);
  }
  addCheck(result, 54, !reviewDiversitySignal.suspiciousPerfect, reviewDiversitySignal.reviewCount ? `rating ${reviewDiversitySignal.ratingValue}, reviewCount ${reviewDiversitySignal.reviewCount}` : "No suspicious aggregateRating detected");
  addCheck(result, 55, merchantTrust.score > 0, JSON.stringify(merchantTrust));
  addCheck(result, 65, !nosnippet, nosnippet ? "nosnippet/max-snippet/data-nosnippet found" : "No nosnippet restrictions found");
  if (renderedWords === null) {
    addSkippedCheck(result, 66, JSON.stringify({ error: renderedResult.error ?? "Rendered browser audit unavailable", skipped: true }));
  } else {
    const renderedRatio = ssrRatio ?? 0;
    addCheck(result, 66, renderedRatio >= 0.6, JSON.stringify({ score: renderedRatio >= 0.8 ? 10 : renderedRatio >= 0.6 ? 5 : 0, skipped: false, ratio: Number(renderedRatio.toFixed(2)), oaiWords, renderedWords }));
  }
  const googleExtendedRobotsAllowed = robotGroupAllows(robotsText, "Google-Extended");
  if (!geminiWaf.conclusive) {
    addSkippedCheck(result, 67, JSON.stringify({
      skipped: true,
      robotsAllowed: googleExtendedRobotsAllowed,
      status: geminiWaf.status,
      reason: "Unable to verify Google-Extended HTTP access from the current crawl response"
    }));
    addSkippedCheck(result, 68, JSON.stringify({
      ...geminiWaf,
      skipped: true,
      reason: "No conclusive Google-Extended WAF or challenge response was observed"
    }));
  } else {
    const googleExtendedAccessible = googleExtendedRobotsAllowed && geminiWaf.pass;
    addCheck(result, 67, googleExtendedAccessible, JSON.stringify({
      pass: googleExtendedAccessible,
      robotsAllowed: googleExtendedRobotsAllowed,
      status: geminiWaf.status,
      challengeDetected: geminiWaf.challengeDetected,
      raw: robotGroupFor(robotsText, "Google-Extended") || "No explicit Google-Extended group; wildcard/default access applies"
    }), {
      recommendation: googleExtendedRobotsAllowed
        ? "Remove the observed WAF, CAPTCHA, or bot block preventing Google-Extended from receiving the public page."
        : "Remove the Google-Extended robots.txt block from public pages intended for Gemini discovery."
    });
    addCheck(result, 68, googleExtendedAccessible, JSON.stringify({
      ...geminiWaf,
      robotsAllowed: googleExtendedRobotsAllowed,
      pass: googleExtendedAccessible
    }), {
      recommendation: "Remove the observed WAF, CAPTCHA, or bot challenge for Google-Extended on the affected public page."
    });
  }
  addSkippedCheck(result, 69, JSON.stringify(ipRangeEvidence));
  if (!napGbpApplicable) {
    addNotApplicableCheck(result, 70, JSON.stringify({
      notApplicable: true,
      localBusinessSchema: localBusinessObjects.length > 0,
      physicalLocationExists,
      localSeoIntent: localTargetPages.length > 0,
      googleBusinessProfileDetected: googleBusinessProfileUrls.length > 0,
      googleBusinessProfileVerificationAvailable: gbpVerificationAvailable,
      reason: "Google Business Profile comparison is not applicable because verified GBP data is unavailable or the page lacks required local-business signals."
    }));
  } else {
    addCheck(result, 70, napEvidence.pass, JSON.stringify(napEvidence), {
      recommendation: "Correct the proven name, address, or phone mismatch between the verified Google Business Profile and the affected local-business page."
    });
  }
  addCheck(result, 71, consentEvidence.pass, JSON.stringify(consentEvidence), {
    recommendation: "Keep primary page content available in the initial HTML instead of replacing it with a cookie-consent interstitial."
  });
  if ("skipped" in schemaInjectionEvidence && schemaInjectionEvidence.skipped) {
    addSkippedCheck(result, 72, JSON.stringify(schemaInjectionEvidence));
  } else {
    addCheck(result, 72, Boolean(schemaInjectionEvidence.pass), JSON.stringify(schemaInjectionEvidence));
  }
  addCheck(result, 73, robotGroupAllows(robotsText, "GoogleOther"), JSON.stringify({ pass: robotGroupAllows(robotsText, "GoogleOther") }));
  if ("skipped" in speakable && speakable.skipped) {
    addNotApplicableCheck(result, 74, JSON.stringify(speakable));
  } else {
    addCheck(result, 74, speakable.pass, JSON.stringify(speakable));
  }
  if (!images.length) {
    addNotApplicableCheck(result, 75, JSON.stringify({ skipped: true, reason: "No images were detected for stock-photo analysis" }));
    addNotApplicableCheck(result, 76, JSON.stringify({ skipped: true, reason: "No images were detected for image-text legibility analysis" }));
  } else {
    addCheck(result, 75, stockPhoto.score >= 5, JSON.stringify(stockPhoto), {
      warning: true,
      severity: "ADVISORY",
      priorityScore: 15,
      recommendation: "Use original imagery where it materially strengthens trust; stock imagery alone is not a citation blocker."
    });
    addCheck(result, 76, ocrLegibility.score >= 5, JSON.stringify(ocrLegibility), {
      recommendation: "Add meaningful alt text or nearby HTML text for images that communicate important facts."
    });
  }
  if (!videoSchema.videosFound) {
    addNotApplicableCheck(result, 77, JSON.stringify({ ...videoSchema, skipped: true, reason: "No embedded video was detected" }));
  } else {
    addCheck(result, 77, videoSchema.score >= 5, JSON.stringify(videoSchema));
  }
  if ("skipped" in transcriptAlignment && transcriptAlignment.skipped) {
    if (transcriptAlignment.reason === "No video content detected") {
      addNotApplicableCheck(result, 78, JSON.stringify({ ...transcriptAlignment, notApplicable: true }));
    } else {
      addSkippedCheck(result, 78, JSON.stringify(transcriptAlignment));
    }
  } else {
    const transcriptScore = transcriptAlignment.score ?? 0;
    addCheck(result, 78, transcriptScore >= 5, JSON.stringify(transcriptAlignment));
  }

  for (const check of result) {
    if (check.passed || check.skipped) continue;
    if (check.scope === "page" && !measurablePageContent) {
      check.passed = true;
      check.skipped = true;
      check.warning = undefined;
      check.evidence = "Insufficient evidence: no measurable page body was retrieved";
      continue;
    }
    const affected = affectedPagesFor(check);
    if (affected.affectedPages === 0 || affected.sampleUrls.length === 0) {
      check.passed = true;
      check.skipped = true;
      check.warning = undefined;
      check.evidence = "Insufficient measurable evidence or no affected URL was available";
      continue;
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(check.evidence) as Record<string, unknown>;
    } catch {
      parsed = { observedEvidence: check.evidence };
    }
    const pagesChecked = Number(parsed.pagesChecked);
    const pagesFailed = Number(parsed.pagesFailed);
    check.evidence = JSON.stringify({
      ...parsed,
      pagesCrawled: Number.isFinite(Number(parsed.pagesCrawled)) ? Number(parsed.pagesCrawled) : sitePages.length,
      pagesChecked: Number.isFinite(pagesChecked) && pagesChecked > 0 ? pagesChecked : check.scope === "domain" ? 1 : sitePages.length,
      pagesFailed: Number.isFinite(pagesFailed) && pagesFailed > 0 ? pagesFailed : affected.affectedPages,
      affectedPages: Array.isArray(parsed.affectedPages) && parsed.affectedPages.length
        ? parsed.affectedPages
        : affected.sampleUrls.map((href) => ({ url: href, issueCount: 1 }))
    });
  }

  const pageScore = scoreByScope(result, "page");
  const domainScore = scoreByScope(result, "domain");
  const citationFailedDetails = result
    .filter((check) => (isChatgptCitationCategory(check.category) || isGeminiCitationCategory(check.category)) && !check.passed && !check.skipped)
    .map((check) => {
      const affected = affectedPagesFor(check);
      return {
        id: check.id,
        name: check.name,
        severity: check.severity,
        evidence: check.evidence,
        recommendation: check.recommendation ?? CITATION_RECOMMENDATIONS[check.id] ?? "Review the measured evidence for this citation-readiness check on the affected pages.",
        affectedPages: affected.affectedPages,
        sampleUrls: affected.sampleUrls
      };
    });
  const citationSkippedDetails = result
    .filter((check) => (isChatgptCitationCategory(check.category) || isGeminiCitationCategory(check.category)) && check.skipped)
    .map((check) => ({
      id: check.id,
      name: check.name,
      reason: check.evidence
    }));
  const categories = categorySummaries(result, citationFailedDetails, citationSkippedDetails);
  const rawScore = scoreGeoChecks(result);
  const blockerFailed = false;
  const score = rawScore;
  const grade = gradeFor(score);

  return {
    score,
    rawScore,
    pageScore,
    domainScore,
    grade: grade.grade,
    gradeDescription: grade.description,
    blockerFailed,
    opportunityCounts: opportunityCounts(result),
    checkedAt: new Date().toISOString(),
    categories,
    checks: result
  };
}
