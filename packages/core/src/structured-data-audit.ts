import * as cheerio from "cheerio";
import { statusForParameterOutcomes } from "./audit-outcome.js";
import type { SiteCrawlResult } from "./site-crawler.js";
import {
  StructuredDataAuditResult,
  StructuredDataCategorySummary,
  StructuredDataCheckResult,
  StructuredDataSeverity,
  TechnicalCategoryStatus
} from "./types.js";

interface CheckDefinition {
  id: number;
  category: string;
  name: string;
  weight: number;
  severity: StructuredDataSeverity;
  priorityScore?: number;
  recommendation?: string;
}

const CHECKS: CheckDefinition[] = [
  [1, "Organization Schema", "Organization Schema Present", 3.07, "Critical"],
  [2, "Organization Schema", "Org: name Property", 2.03, "Critical"],
  [3, "Organization Schema", "Org: url Property", 1.52, "High"],
  [4, "Organization Schema", "Org: logo Property", 1.52, "Medium"],
  [5, "Organization Schema", "Org: telephone", 1.52, "Critical"],
  [6, "Organization Schema", "Org: address PostalAddress", 2.03, "Critical"],
  [7, "Organization Schema", "Organization sameAs links", 0, "Advisory"],
  [8, "Organization Schema", "Organization LinkedIn sameAs", 0, "Advisory"],
  [9, "Organization Schema", "Organization authority-profile sameAs", 0, "Advisory"],
  [10, "Organization Schema", "Organization knowsAbout topics", 0, "Advisory"],
  [11, "Organization Schema", "Org: @id Declared", 1.52, "High"],
  [12, "Organization Schema", "Org: foundingDate", 0, "Advisory"],
  [13, "LocalBusiness Schema", "LocalBusiness: GPS", 0, "Advisory"],
  [14, "LocalBusiness Schema", "LocalBusiness: areaServed", 0, "Advisory"],
  [15, "LocalBusiness Schema", "LocalBusiness: openingHours", 0, "Advisory"],
  [16, "LocalBusiness Schema", "LocalBusiness Schema Present with Valid @type", 2.03, "High"],
  [17, "Article Schema", "Article: headline", 2.03, "Critical"],
  [18, "Article Schema", "Article: author Person", 2.03, "High"],
  [19, "Article Schema", "Article: datePublished ISO", 1.52, "High"],
  [20, "Article Schema", "Article: dateModified Matches Visible Date", 0, "Advisory"],
  [21, "Article Schema", "Article: about Entity", 0, "Advisory"],
  [22, "Article Schema", "Article: image ImageObject", 1.02, "Medium"],
  [23, "Article Schema", "Article: publisher->Org", 1.52, "High"],
  [24, "Person Schema", "Person Schema on Bio Pages", 2.03, "High"],
  [25, "Person Schema", "Person: name Property", 1.52, "Medium"],
  [26, "Person Schema", "Person: sameAs LinkedIn", 0, "Advisory"],
  [27, "Person Schema", "Person: knowsAbout", 0, "Advisory"],
  [28, "FAQ & HowTo Schema", "FAQPage When FAQ in DOM", 2.03, "High"],
  [29, "FAQ & HowTo Schema", "FAQPage mainEntity present", 1.52, "Medium"],
  [30, "FAQ & HowTo Schema", "FAQPage acceptedAnswer completeness", 1.52, "Medium"],
  [31, "FAQ & HowTo Schema", "HowTo on Step-by-Step", 1.52, "Medium"],
  [36, "Supporting Schema Types", "BreadcrumbList on Interior", 2.03, "High"],
  [37, "Supporting Schema Types", "BreadcrumbList Matches DOM", 1.52, "High"],
  [38, "Supporting Schema Types", "WebSite on Homepage", 1.02, "Medium"],
  [39, "Supporting Schema Types", "@graph Interconnection", 0, "Advisory"],
  [40, "Supporting Schema Types", "ImageObject on Key Images", 0, "Advisory"],
  [41, "Supporting Schema Types", "VideoObject on Videos", 1.02, "Medium"],
  [42, "Schema Validation & Quality", "JSON-LD Syntax Valid", 2.54, "Critical"],
  [43, "Schema Validation & Quality", "JSON-LD Format (Not Microdata)", 0, "Advisory"],
  [44, "Schema Validation & Quality", "Absolute HTTPS URLs in Schema", 1.52, "High"],
  [46, "Schema-DOM Parity", "Schema-DOM: Phone Match", 2.03, "Critical"],
  [47, "Schema-DOM Parity", "Schema-DOM: Name Match", 1.52, "High"],
  [48, "Schema-DOM Parity", "Schema-DOM: Date Match", 1.52, "High"],
  [49, "Schema-DOM Parity", "Schema-DOM: FAQ Match", 1.52, "High"],
  [51, "Schema Validation & Quality", "No Conflicting Duplicate Entities", 1.52, "High"],
  [52, "Schema Validation & Quality", "Schema in Server HTML", 2.03, "Critical"],
  [53, "FAQ & HowTo Schema", "HowTo: step Array Nested", 1.52, "Medium"],
  [54, "LocalBusiness Schema", "LocalBusiness: priceRange", 0, "Advisory"],
  [55, "FAQ & HowTo Schema", "HowTo: totalTime+Cost", 0, "Advisory"],
  [56, "Schema Validation & Quality", "Schema Versioning", 0.51, "Low"],
  [57, "Specialist Schema Types", "Speakable + Valid Selectors", 0, "Advisory"],
  [58, "Specialist Schema Types", "DefinedTerm on Glossary", 0, "Advisory"],
  [59, "Specialist Schema Types", "Dataset on Research", 0, "Advisory"],
  [60, "Specialist Schema Types", "ProfilePage on Bio Pages", 0, "Advisory"],
  [61, "Specialist Schema Types", "Event on Webinars", 0, "Advisory"],
  [62, "Specialist Schema Types", "SoftwareApp on Tools", 0, "Advisory"]
].map(([id, category, name, weight, severity]) => ({ id, category, name, weight, severity })) as CheckDefinition[];

const ADVISORY_DETAILS: Record<number, Pick<CheckDefinition, "priorityScore" | "recommendation">> = {
  7: {
    priorityScore: 15,
    recommendation: "Optional entity reinforcement: add official sameAs links when verified profiles exist."
  },
  8: {
    priorityScore: 12,
    recommendation: "Add the official LinkedIn profile to sameAs only when the business has a verified profile."
  },
  9: {
    priorityScore: 10,
    recommendation: "Add Wikidata or Crunchbase to sameAs only when the brand already has a verified profile there. Never create a profile only to satisfy this check."
  },
  10: {
    priorityScore: 15,
    recommendation: "Add knowsAbout topics only when they accurately describe the business expertise."
  }
};

for (const check of CHECKS) Object.assign(check, ADVISORY_DETAILS[check.id]);

const CATEGORY_ORDER = [...new Set(CHECKS.map((check) => check.category))];
const ORG_TYPES = new Set(["Organization", "LocalBusiness", "Corporation", "OnlineBusiness", "ProfessionalService", "MedicalOrganization", "NGO", "EducationalOrganization"]);
const LOCAL_TYPES = new Set(["LocalBusiness", "ProfessionalService", "FinancialService", "MedicalBusiness", "Store", "Restaurant", "Dentist", "MedicalClinic", "HealthAndBeautyBusiness"]);

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeUrl(value: string) {
  return value.startsWith("http") ? value : `https://${value}`;
}

async function fetchHtml(url: string) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "AIVisibilityAnalyzer/1.0" }
    });
    return response.ok ? response.text() : "";
  } catch {
    return "";
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function typesOf(record: Record<string, unknown>) {
  return asArray(record["@type"] as string | string[] | undefined).map(String);
}

function flattenSchema(value: unknown, inheritedContext?: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => flattenSchema(item, inheritedContext));
  const record = value as Record<string, unknown>;
  const context = record["@context"] ?? inheritedContext;
  const normalizedRecord = context && !record["@context"] ? { ...record, "@context": context } : record;
  const current = record["@type"] ? [normalizedRecord] : [];
  return [...current, ...flattenSchema(record["@graph"], context)];
}

function parseJsonLd($: cheerio.CheerioAPI) {
  const errors: string[] = [];
  const records = $("script[type='application/ld+json']").toArray().flatMap((el) => {
    try {
      return flattenSchema(JSON.parse($(el).text()));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Invalid JSON-LD");
      return [];
    }
  });
  return { records, errors };
}

function findByType(records: Record<string, unknown>[], predicate: (type: string) => boolean) {
  return records.filter((record) => typesOf(record).some(predicate));
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return textValue(record.name) || textValue(record.url) || textValue(record["@id"]);
  }
  return "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function hasDom($: cheerio.CheerioAPI, pattern: RegExp) {
  return pattern.test($("body").text());
}

function pageSignals($: cheerio.CheerioAPI, url: URL) {
  const title = $("title").first().text();
  const h1 = $("h1").first().text();
  const primary = $("main,article").first().text() || $("body").text();
  const pathAndHeadings = `${url.pathname} ${title} ${h1}`.toLowerCase();
  const visible = `${pathAndHeadings} ${primary}`.replace(/\s+/g, " ").toLowerCase();
  return { pathAndHeadings, visible };
}

function pathSegments(url: URL) {
  return url.pathname.split("/").filter(Boolean);
}

function visibleFaqSignals($: cheerio.CheerioAPI) {
  const roots = $("main,article").length ? $("main,article") : $("body");
  const containers = roots.find("details,.faq,[id*='faq' i],[class*='faq' i],[aria-label*='faq' i]").filter((_, element) =>
    $(element).closest("footer,nav,header,aside").length === 0
  );
  const detailsQuestions = containers.filter("details").toArray().filter((element) => {
    const node = $(element);
    const question = node.find("summary").text().trim();
    return question.length > 0 && node.text().replace(question, "").trim().length > 0;
  }).length;
  const headingQuestions = containers.find("h2,h3,h4,[class*='question' i]").toArray()
    .filter((element) => /\?|^(?:what|how|why|when|where|who|can|does|is|are)\b/i.test($(element).text().trim())).length;
  return {
    containers: containers.length,
    questions: detailsQuestions + headingQuestions,
    applicable: containers.length > 0 && detailsQuestions + headingQuestions >= 1
  };
}

function visibleHowToSignals($: cheerio.CheerioAPI, signals: ReturnType<typeof pageSignals>) {
  const roots = $("main,article").length ? $("main,article") : $("body");
  const headingIntent = /\b(how to|step-by-step|instructions?|tutorial)\b/i.test(signals.pathAndHeadings);
  const orderedSteps = roots.find("ol").toArray().some((list) => $(list).find(":scope > li").length >= 3);
  const labelledSteps = roots.find("h2,h3,h4,[class*='step' i]").toArray()
    .filter((element) => /\bstep\s*\d+\b/i.test($(element).text()) || /\bstep\b/i.test($(element).attr("class") ?? "")).length >= 3;
  return headingIntent && (orderedSteps || labelledSteps);
}

function visibleDateCandidates($: cheerio.CheerioAPI) {
  const excluded = "footer,nav,aside,[class*='related' i],[class*='recent' i],[class*='recommend' i],[class*='blog-list' i],[class*='post-list' i],[class*='carousel' i],[class*='slider' i]";
  const explicit = $("time[datetime],[itemprop='dateModified'],[class*='updated' i],[class*='modified' i]").toArray()
    .filter((element) => $(element).closest(excluded).length === 0);
  const candidates = explicit.flatMap((element) => {
    const node = $(element);
    return [node.attr("datetime") ?? node.attr("content") ?? "", node.text()];
  });
  return [...new Set(candidates.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 10);
}

function hasDatedEventSignals($: cheerio.CheerioAPI, visible: string) {
  const eventIdentity = /\b(webinar|event|conference|workshop|seminar|meetup)\b/i.test(visible);
  const registration = /\b(register|registration|rsvp|tickets?|book (?:a )?(?:seat|place))\b/i.test(visible);
  const logistics = Boolean($("time,[datetime]").length)
    || /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/i.test(visible)
    || /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i.test(visible)
    || /\b(speaker|venue|hosted by)\b/i.test(visible);
  return eventIdentity && registration && logistics;
}

function primaryContentImages($: cheerio.CheerioAPI) {
  return $("main img, article img").toArray().filter((image) => {
    const element = $(image);
    if (element.closest("header,footer,nav,aside").length) return false;
    const marker = `${element.attr("class") ?? ""} ${element.attr("alt") ?? ""} ${element.attr("src") ?? ""}`;
    return !/\b(logo|icon|avatar|badge|sprite|tracking|pixel|decorative)\b/i.test(marker);
  });
}

function normalizedText(value: string) {
  return value.toLowerCase().replace(/&nbsp;/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function visibleDateMatches(body: string, value: unknown) {
  const raw = textValue(value);
  if (!raw) return false;
  const isoDate = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!isoDate) return normalizedText(body).includes(normalizedText(raw));
  if (normalizedText(body).includes(normalizedText(isoDate))) return true;
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const formats = [
    new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed),
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed),
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(parsed),
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed)
  ];
  const normalizedBody = normalizedText(body);
  return formats.some((format) => normalizedBody.includes(normalizedText(format)));
}

function dateMatchesCandidates(candidates: string[], value: unknown) {
  if (!candidates.length) return false;
  return candidates.some((candidate) => visibleDateMatches(candidate, value));
}

function absoluteHttpsUrls(record: Record<string, unknown>) {
  const urls = JSON.stringify(record).match(/https?:\/\/[^"',\]\s}]+/g) ?? [];
  return { urls, invalid: urls.filter((url) => !url.startsWith("https://")) };
}

function conflictingDuplicateIds(records: Record<string, unknown>[]) {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const record of records) {
    const id = textValue(record["@id"]);
    if (!id) continue;
    grouped.set(id, [...(grouped.get(id) ?? []), record]);
  }
  return [...grouped.entries()].flatMap(([id, matches]) => {
    if (matches.length < 2) return [];
    const signatures = new Set(matches.map((record) => JSON.stringify({
      types: typesOf(record).sort(),
      name: normalizedText(textValue(record.name)),
      url: textValue(record.url),
      telephone: normalizedText(textValue(record.telephone)),
      address: normalizedText(textValue(record.address))
    })));
    return signatures.size > 1 ? [id] : [];
  });
}

function result(def: CheckDefinition, state: {
  passed?: boolean;
  skipped?: boolean;
  notApplicable?: boolean;
  warning?: boolean;
  evidence?: Record<string, unknown>;
  whatIsWrong?: string;
  severity?: StructuredDataSeverity;
  weight?: number;
  priorityScore?: number;
}): StructuredDataCheckResult {
  const skipped = false;
  const passed = Boolean(state.passed);
  const warning = false;
  const affected = passed ? 0 : 1;
  return {
    ...def,
    ...(state.severity ? { severity: state.severity } : {}),
    ...(state.weight !== undefined ? { weight: state.weight } : {}),
    ...(state.priorityScore !== undefined ? { priorityScore: state.priorityScore } : {}),
    passed,
    skipped,
    warning,
    score: skipped ? 0 : passed ? 1 : 0,
    ...(state.whatIsWrong ? { whatIsWrong: state.whatIsWrong } : {}),
    evidence: {
      ...(state.evidence ?? {}),
      pagesCrawled: 1,
      pagesChecked: 1,
      pagesFailed: affected,
      affectedRate: affected * 100
    }
  };
}

function scoreChecks(checks: StructuredDataCheckResult[]) {
  const applicable = checks.filter((check) => !check.skipped && check.weight > 0);
  if (!applicable.length) return 100;
  const possible = applicable.reduce((sum, check) => sum + check.weight, 0);
  const earned = applicable.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  return possible ? clamp((earned / possible) * 100) : 100;
}

function summarize(checks: StructuredDataCheckResult[]): StructuredDataCategorySummary[] {
  return CATEGORY_ORDER.map((categoryName) => {
    const categoryChecks = checks.filter((check) => check.category === categoryName);
    const scorable = categoryChecks.filter((check) => !check.skipped);
    const failed = scorable.filter((check) => !check.passed && !check.warning);
    const warningChecks = scorable.filter((check) => check.warning).length;
    const skippedChecks = categoryChecks.filter((check) => check.skipped).length;
    const score = scoreChecks(categoryChecks);
    const status: TechnicalCategoryStatus = statusForParameterOutcomes(categoryChecks);
    return {
      categoryName,
      totalChecks: categoryChecks.length,
      passedChecks: scorable.filter((check) => check.passed && !check.warning).length,
      failedChecks: failed.length,
      warningChecks,
      skippedChecks,
      score,
      status
    };
  });
}

async function runStructuredDataPageAudit(inputUrl: string, html?: string): Promise<StructuredDataAuditResult> {
  const normalized = normalizeUrl(inputUrl);
  const url = new URL(normalized);
  const pageHtml = html ?? await fetchHtml(normalized);
  const $ = cheerio.load(pageHtml);
  const body = $("body").text().replace(/\s+/g, " ").trim();
  const lowerBody = body.toLowerCase();
  const { records, errors } = parseJsonLd($);
  const organizations = findByType(records, (type) => ORG_TYPES.has(type));
  const org = organizations[0];
  const local = findByType(records, (type) => LOCAL_TYPES.has(type))[0];
  const article = findByType(records, (type) => /Article|BlogPosting|NewsArticle/i.test(type))[0];
  const person = findByType(records, (type) => type === "Person")[0];
  const faq = findByType(records, (type) => type === "FAQPage")[0];
  const howTo = findByType(records, (type) => type === "HowTo")[0];
  const breadcrumb = findByType(records, (type) => type === "BreadcrumbList")[0];
  const website = findByType(records, (type) => type === "WebSite")[0];
  const sameAs = [...new Set(organizations.flatMap((record) =>
    asArray(record.sameAs as string | string[] | undefined).map(String)
  ))];
  const knowsAbout = organizations.flatMap((record) => asArray(record.knowsAbout as unknown[] | undefined));
  const signals = pageSignals($, url);
  const segments = pathSegments(url);
  const primaryScopeForLocal = $("main,article").length ? $("main,article") : $("body").clone().find("header,footer,nav,aside").remove().end();
const primaryVisibleForLocal = primaryScopeForLocal.text().replace(/\s+/g, " ").toLowerCase();
const primaryPathAndHeadingsForLocal = signals.pathAndHeadings;

const localSignalCount = [
  /\b(contact|location|directions|visit us|near me)\b/i.test(primaryPathAndHeadingsForLocal),
  /\b(opening hours|business hours|store hours|walk-?in)\b/i.test(primaryVisibleForLocal),
  primaryScopeForLocal.find("address,iframe[src*='google.com/maps']").length > 0
].filter(Boolean).length;

const digitalOnlyBusinessSignals = /\b(online platform|digital[- ]first|forex card|remittance|saas|sign ?up|create an account|download the app|loan app|buy now|enquiry form)\b/i.test(signals.visible)
  && !/\b(walk-?in|visit our store|in-store|book an appointment|dine[- ]in)\b/i.test(signals.visible);

const localApplicable = Boolean(local) || (localSignalCount >= 2 && !digitalOnlyBusinessSignals);
  const articlePath = /^(?:blog|blogs|articles?|news|insights?|guides?)$/i.test(segments[0] ?? "") && segments.length >= 2;
  const articleDom = $("article").length === 1
    && Boolean($("article h1").length)
    && /\b(author|written by|published|updated|reading time)\b/i.test(signals.visible);
  const articleApplicable = Boolean(article || articleDom || articlePath && /\b(author|written by|published|updated|reading time)\b/i.test(signals.visible));
  const personApplicable = Boolean(person
    || /\/(author|authors|team|people|experts?|doctors?|profile|bio)\//i.test(url.pathname)
    || /\b(author|team member|doctor|expert|profile|biography|about the author)\b/i.test(signals.pathAndHeadings)
    || ($("[rel='author'],.author-bio,[class*='profile' i],[class*='bio' i]").length > 0 && /\b(job title|credentials?|linkedin|specialist|expertise)\b/i.test(signals.visible)));
  const visibleFaq = visibleFaqSignals($);
  const faqApplicable = Boolean(faq || visibleFaq.applicable);
  const howToApplicable = Boolean(howTo || visibleHowToSignals($, signals));
  const videoApplicable = Boolean($("video,iframe[src*='youtube'],iframe[src*='vimeo']").length);
  const contentImages = primaryContentImages($);
  const imageApplicable = contentImages.length > 0 && Boolean(articleApplicable || $("main,article").length);
  const speakableApplicable = Boolean(article && /NewsArticle/i.test(typesOf(article).join(" "))) || /\bspeakable\b/i.test(body);
  const glossaryTermPath = /^(?:glossary|dictionary|terms?)$/i.test(segments[0] ?? "") && segments.length >= 2;
  const definedTermApplicable = glossaryTermPath
    || /\b(term definition|definition of)\b/i.test(signals.pathAndHeadings)
    || $("main dfn,article dfn,[class*='glossary' i] dfn,[id*='glossary' i] dfn").length >= 1;
  const datasetApplicable = /\b(dataset|data catalog|download data|research data|study data)\b/i.test(body) || $("a[href$='.csv'],a[href$='.json'],a[href$='.xlsx']").length > 0;
  const profilePath = /^(?:author|authors|team|people|experts?|doctors?|profile|bio|leadership)$/i.test(segments[0] ?? "") && segments.length >= 2;
  const profilePageApplicable = Boolean(profilePath
    && (person || $(".author-bio,[class*='profile' i],[class*='bio' i]").length > 0)
    && !article);
  const eventApplicable = Boolean(findByType(records, (type) => type === "Event").length) || hasDatedEventSignals($, signals.visible);
  const primaryRoot = $("main,article").length ? $("main,article").first() : $("body");
  const primaryAppStoreLinks = primaryRoot.find("a[href*='play.google.com'],a[href*='apps.apple.com']").length;
  const softwarePath = /^(?:tools?|apps?|software|calculators?|audits?)$/i.test(segments[0] ?? "");
  const softwareHeading = /\b(software|saas|calculator|audit tool|web app|mobile app|loan app|application)\b/i.test(signals.pathAndHeadings);
  const softwareCta = primaryAppStoreLinks > 0
    || /\b(try (?:it|the tool)|use (?:the )?(?:tool|app)|start (?:the )?(?:tool|app)|calculate|run (?:an )?audit|download (?:the )?app|sign up)\b/i.test(primaryRoot.text());
  const softwareSchemaFound = findByType(records, (type) => type === "SoftwareApplication" || type === "SoftwareApp").length > 0;
  const softwareApplicable = Boolean(softwareSchemaFound || !glossaryTermPath && (softwarePath || softwareHeading && softwareCta));
  const ids = records.map((record) => textValue(record["@id"])).filter(Boolean);
  const conflictingIds = conflictingDuplicateIds(records);
  const allUrls = records.flatMap(absoluteHttpsUrls);
  const results: StructuredDataCheckResult[] = [];
  const add = (id: number, state: Parameters<typeof result>[1]) => {
    const def = CHECKS.find((check) => check.id === id);
    if (def) results.push(result(def, state));
  };

  add(1, { passed: Boolean(org), skipped: url.pathname !== "/" && !org, warning: records.length > 0, evidence: { organizationFound: Boolean(org), typesFound: records.flatMap(typesOf) } });
  add(2, { passed: Boolean(textValue(org?.name)), skipped: !org, evidence: { name: textValue(org?.name) } });
  add(3, { passed: textValue(org?.url).startsWith("https://"), skipped: !org, warning: Boolean(textValue(org?.url)), evidence: { url: textValue(org?.url) } });
  add(4, { passed: Boolean(textValue(org?.logo)), skipped: !org, warning: Boolean(org), evidence: { logo: textValue(org?.logo) } });
  add(5, { passed: Boolean(textValue(org?.telephone)), skipped: !localApplicable || !org, warning: localApplicable && Boolean(org) && !textValue(org?.telephone), evidence: { telephone: textValue(org?.telephone), skippedReason: localApplicable ? "" : "No local/service intent detected" } });
  add(6, { passed: Boolean(objectValue(org?.address)["@type"] || textValue(org?.address)), skipped: !localApplicable || !org, warning: localApplicable && Boolean(org) && !objectValue(org?.address)["@type"] && !textValue(org?.address), evidence: { address: org?.address ?? null } });
  add(7, { passed: sameAs.length > 0, skipped: !org, warning: Boolean(org) && sameAs.length === 0, evidence: { sameAsCount: sameAs.length, sameAsUrls: sameAs, note: "sameAs is optional and should contain verified official profiles only." } });
  add(8, { passed: sameAs.some((item) => /linkedin\.com/i.test(item)), skipped: !org, warning: Boolean(org) && !sameAs.some((item) => /linkedin\.com/i.test(item)), evidence: { linkedinFound: sameAs.some((item) => /linkedin\.com/i.test(item)) } });
  add(9, { passed: sameAs.some((item) => /wikidata\.org|crunchbase\.com/i.test(item)), skipped: !org, warning: Boolean(org) && !sameAs.some((item) => /wikidata\.org|crunchbase\.com/i.test(item)), evidence: { sameAsUrls: sameAs, note: "Optional; do not create profiles to satisfy this check." } });
  add(10, { passed: knowsAbout.length > 0, skipped: !org, warning: Boolean(org) && knowsAbout.length === 0, evidence: { knowsAboutCount: knowsAbout.length } });
  add(11, { passed: textValue(org?.["@id"]).startsWith("https://"), skipped: !org, warning: Boolean(org) && !textValue(org?.["@id"]).startsWith("https://"), evidence: { id: textValue(org?.["@id"]) } });
  add(12, {
    passed: /^\d{4}(-\d{2}-\d{2})?$/.test(textValue(org?.foundingDate)),
    skipped: !org,
    warning: Boolean(org) && !org.foundingDate,
    evidence: { foundingDate: textValue(org?.foundingDate) },
    whatIsWrong: "Organization foundingDate exists but is not a valid year or ISO date."
  });

  add(13, { passed: Boolean(objectValue(local?.geo).latitude && objectValue(local?.geo).longitude), skipped: !localApplicable || !local, warning: Boolean(local) && !local.geo, evidence: { geo: local?.geo ?? null } });
  add(14, { passed: Boolean(local?.areaServed), skipped: !localApplicable || !local, warning: Boolean(local) && !local.areaServed, evidence: { areaServed: local?.areaServed ?? null } });
  add(15, { passed: Boolean(local?.openingHours || local?.openingHoursSpecification), skipped: !localApplicable || !local, warning: Boolean(local) && !(local.openingHours || local.openingHoursSpecification), evidence: { openingHours: local?.openingHours ?? local?.openingHoursSpecification ?? null } });
  add(16, { passed: Boolean(local), skipped: !localApplicable, warning: localApplicable, evidence: { types: local ? typesOf(local) : [], localSignalsDetected: localSignalCount } });
  add(54, { passed: Boolean(local?.priceRange), skipped: !localApplicable || !local, warning: Boolean(local) && !local.priceRange, evidence: { priceRange: local?.priceRange ?? "" } });

  add(17, { passed: Boolean(article?.headline), skipped: !articleApplicable, warning: articleApplicable, evidence: { headline: article?.headline ?? "" } });
  add(18, { passed: Boolean(article?.author), skipped: !articleApplicable || !article, warning: Boolean(article), evidence: { author: article?.author ?? null } });
  add(19, { passed: /^\d{4}-\d{2}-\d{2}/.test(textValue(article?.datePublished)), skipped: !articleApplicable || !article, warning: Boolean(article?.datePublished), evidence: { datePublished: article?.datePublished ?? "" } });
  const dateCandidates = visibleDateCandidates($);
  const dateModifiedMatches = dateMatchesCandidates(dateCandidates, article?.dateModified);
  const dateModifiedConflict = Boolean(article?.dateModified) && dateCandidates.length > 0 && !dateModifiedMatches;
  const dateModifiedMissing = Boolean(articleApplicable && article && !article.dateModified);
  add(20, {
    passed: Boolean(article?.dateModified) && (dateModifiedMatches || !dateModifiedConflict),
    skipped: !articleApplicable || !article || Boolean(article.dateModified && dateCandidates.length === 0),
    warning: dateModifiedMissing,
    severity: dateModifiedConflict ? "High" : "Advisory",
    weight: dateModifiedConflict ? 2.03 : 0,
    priorityScore: dateModifiedConflict ? 72 : 15,
    evidence: {
      schemaDateModified: article?.dateModified ?? "",
      visibleDateCandidates: dateCandidates,
      matched: dateModifiedMatches,
      explicitConflict: dateModifiedConflict,
      skippedReason: "No visible modified date was detected, so the schema dateModified value cannot be verified"
    },
    whatIsWrong: dateModifiedConflict
      ? `Schema dateModified ${textValue(article?.dateModified)} conflicts with the visible page date (${dateCandidates.join(", ")}).`
      : `Schema dateModified ${textValue(article?.dateModified) || "is unavailable"} cannot be verified because no visible modified date was detected.`
  });
  add(21, { passed: Boolean(article?.about), skipped: !articleApplicable || !article, warning: Boolean(article) && !article.about, evidence: { about: article?.about ?? null } });
  add(22, { passed: Boolean(article?.image), skipped: !articleApplicable || !article, warning: Boolean(article), evidence: { image: article?.image ?? null } });
  add(23, { passed: Boolean(article?.publisher), skipped: !articleApplicable || !article, warning: Boolean(article), evidence: { publisher: article?.publisher ?? null } });

  add(24, { passed: Boolean(person), skipped: !personApplicable, warning: personApplicable, evidence: { personFound: Boolean(person) } });
  add(25, { passed: Boolean(person?.name), skipped: !personApplicable || !person, evidence: { name: person?.name ?? "" } });
  add(26, { passed: asArray(person?.sameAs as string | string[] | undefined).some((item) => /linkedin\.com/i.test(String(item))), skipped: !personApplicable || !person, warning: Boolean(person) && !asArray(person?.sameAs as string | string[] | undefined).some((item) => /linkedin\.com/i.test(String(item))), evidence: { sameAs: person?.sameAs ?? [] } });
  add(27, { passed: asArray(person?.knowsAbout as unknown[] | undefined).length > 0, skipped: !personApplicable || !person, warning: Boolean(person) && asArray(person?.knowsAbout as unknown[] | undefined).length === 0, evidence: { knowsAbout: person?.knowsAbout ?? [] } });

  const faqItems = asArray(faq?.mainEntity as unknown[] | undefined);
  add(28, { passed: Boolean(faq), skipped: !visibleFaq.applicable && !faq, warning: visibleFaq.applicable, evidence: { faqFound: Boolean(faq), visibleFaqContainers: visibleFaq.containers, visibleFaqQuestions: visibleFaq.questions } });
  add(29, { passed: faqItems.length > 0, skipped: !faq, evidence: { itemCount: faqItems.length } });
  const faqAnswersComplete = faqItems.length > 0 && faqItems.every((item) => {
    const record = objectValue(item);
    const answer = objectValue(record.acceptedAnswer);
    return Boolean(textValue(record.name) && textValue(answer.text));
  });
  add(30, { passed: faqAnswersComplete, skipped: !faq, evidence: { itemCount: faqItems.length, completeAnswers: faqItems.filter((item) => {
    const record = objectValue(item);
    return Boolean(textValue(record.name) && textValue(objectValue(record.acceptedAnswer).text));
  }).length } });
  add(31, { passed: Boolean(howTo), skipped: !howToApplicable, warning: howToApplicable, evidence: { howToFound: Boolean(howTo) } });
  add(53, { passed: asArray(howTo?.step as unknown[] | undefined).length > 0, skipped: !howToApplicable || !howTo, warning: Boolean(howTo), evidence: { steps: asArray(howTo?.step as unknown[] | undefined).length } });
  add(55, { passed: Boolean(howTo?.totalTime || howTo?.estimatedCost), skipped: !howTo, warning: Boolean(howTo) && !(howTo.totalTime || howTo.estimatedCost), evidence: { totalTime: howTo?.totalTime ?? "", estimatedCost: howTo?.estimatedCost ?? "" } });

  add(36, { passed: Boolean(breadcrumb), skipped: url.pathname === "/", evidence: { breadcrumbFound: Boolean(breadcrumb) } });
  add(37, { passed: Boolean(breadcrumb?.itemListElement), skipped: !breadcrumb, evidence: { itemListElement: breadcrumb?.itemListElement ?? null } });
  add(38, { passed: Boolean(website), skipped: url.pathname !== "/", warning: url.pathname === "/", evidence: { websiteFound: Boolean(website) } });
  add(39, { passed: records.some((record) => Boolean(record["@id"])) && records.length > 1, skipped: records.length < 2, warning: records.length > 1 && ids.length === 0, evidence: { records: records.length, ids: ids.length } });
  add(40, { passed: findByType(records, (type) => type === "ImageObject").length > 0, skipped: !imageApplicable, warning: imageApplicable, evidence: { primaryContentImages: contentImages.length } });
  add(41, { passed: findByType(records, (type) => type === "VideoObject").length > 0, skipped: !videoApplicable, evidence: { videos: $("video,iframe[src*='youtube'],iframe[src*='vimeo']").length } });

  add(42, {
    passed: errors.length === 0,
    evidence: { parseErrors: errors, jsonLdBlocks: $("script[type='application/ld+json']").length },
    whatIsWrong: errors.length ? `JSON-LD parsing failed: ${errors.join("; ")}` : undefined
  });
  add(43, { passed: $("[itemscope],[typeof],[property]").length === 0 || $("script[type='application/ld+json']").length > 0, warning: $("[itemscope],[typeof],[property]").length > 0 && $("script[type='application/ld+json']").length === 0, evidence: { jsonLdBlocks: $("script[type='application/ld+json']").length, microdataRdfaSignals: $("[itemscope],[typeof],[property]").length } });
  add(44, { passed: allUrls.every((item) => item.invalid.length === 0), evidence: { invalidHttpUrls: allUrls.flatMap((item) => item.invalid).slice(0, 10) } });
  add(51, { passed: conflictingIds.length === 0, evidence: { conflictingIds } });
  const schemaExpected = url.pathname === "/"
    || articleApplicable
    || personApplicable
    || visibleFaq.applicable
    || howToApplicable
    || localApplicable
    || eventApplicable
    || softwareApplicable
    || definedTermApplicable;
  add(52, { passed: !schemaExpected || $("script[type='application/ld+json']").length > 0, evidence: { jsonLdBlocks: $("script[type='application/ld+json']").length, schemaExpected } });
  add(56, { passed: records.length === 0 || records.some((record) => Boolean(record["@context"])), warning: records.length > 0 && !records.some((record) => Boolean(record["@context"])), evidence: { contexts: records.map((record) => record["@context"]).filter(Boolean) } });

  add(46, { passed: Boolean(!org?.telephone || normalizedText(body).includes(normalizedText(textValue(org.telephone)))), skipped: !org?.telephone, evidence: { telephone: org?.telephone ?? "" } });
  add(47, { passed: Boolean(!org?.name || normalizedText(body).includes(normalizedText(textValue(org.name)))), skipped: !org?.name, evidence: { name: org?.name ?? "" } });
  add(48, { passed: visibleDateMatches(body, article?.datePublished), skipped: !articleApplicable || !article?.datePublished, evidence: { datePublished: article?.datePublished ?? "" } });
  add(49, { passed: faqItems.length > 0 && faqItems.every((item) => normalizedText(body).includes(normalizedText(textValue(item)).slice(0, 40))), skipped: !faq, evidence: { itemCount: faqItems.length, visibleFaqQuestions: visibleFaq.questions } });

  add(57, { passed: findByType(records, (type) => type === "SpeakableSpecification").length > 0, skipped: !speakableApplicable, warning: speakableApplicable, evidence: { speakableApplicable } });
  add(58, { passed: findByType(records, (type) => type === "DefinedTerm").length > 0, skipped: !definedTermApplicable, warning: definedTermApplicable, evidence: { definedTermApplicable } });
  add(59, { passed: findByType(records, (type) => type === "Dataset").length > 0, skipped: !datasetApplicable, warning: datasetApplicable, evidence: { datasetApplicable } });
  add(60, { passed: findByType(records, (type) => type === "ProfilePage").length > 0, skipped: !profilePageApplicable, warning: profilePageApplicable, evidence: { profilePageApplicable } });
  add(61, { passed: findByType(records, (type) => type === "Event").length > 0, skipped: !eventApplicable, warning: eventApplicable, evidence: { eventApplicable } });
  add(62, { passed: findByType(records, (type) => type === "SoftwareApplication" || type === "SoftwareApp").length > 0, skipped: !softwareApplicable, warning: softwareApplicable, evidence: { softwareApplicable } });

  const categories = summarize(results);
  const score = scoreChecks(results);
  return { score, checkedAt: new Date().toISOString(), categories, checks: results };
}

function aggregatePageAudits(
  pageAudits: { url: string; audit: StructuredDataAuditResult }[],
  coverage: {
    pagesCrawled: number;
    targetUrls?: number;
    attemptedUrls?: number;
    cappedByMaxPages?: boolean;
  }
): StructuredDataAuditResult {
  const checks = CHECKS.map((def) => {
    const pageChecks = pageAudits.flatMap(({ url, audit }) => {
      const check = audit.checks.find((item) => item.id === def.id);
      return check ? [{ url, check }] : [];
    });
    const applicable = pageChecks.filter(({ check }) => !check.skipped);
    const affected = applicable.filter(({ check }) => !check.passed);
    const hardFailures = affected.filter(({ check }) => !check.warning);
    const reportedAffected = hardFailures.length ? hardFailures : affected;
    const passed = affected.length === 0;
    const skipped = applicable.length === 0;
    const warning = !skipped && affected.length > 0 && hardFailures.length === 0;
    const firstEvidence = reportedAffected[0]?.check.evidence ?? applicable[0]?.check.evidence ?? pageChecks[0]?.check.evidence ?? {};
    const whatIsWrong = reportedAffected[0]?.check.whatIsWrong;
    const representative = hardFailures[0]?.check ?? affected[0]?.check ?? applicable[0]?.check;
    return {
      ...def,
      ...(representative ? {
        severity: representative.severity,
        weight: representative.weight,
        priorityScore: representative.priorityScore,
        informational: representative.informational,
        opportunity: representative.opportunity,
        notApplicable: representative.notApplicable
      } : {}),
      passed: skipped ? true : passed,
      skipped,
      warning,
      score: skipped ? 0 : passed ? 1 : 0,
      ...(whatIsWrong ? { whatIsWrong } : {}),
      evidence: {
        ...firstEvidence,
        pagesCrawled: coverage.pagesCrawled,
        targetUrls: coverage.targetUrls ?? coverage.pagesCrawled,
        attemptedUrls: coverage.attemptedUrls ?? coverage.pagesCrawled,
        crawlCapped: Boolean(coverage.cappedByMaxPages),
        pagesChecked: applicable.length,
        pagesFailed: reportedAffected.length,
        affectedRate: applicable.length ? Number(((reportedAffected.length / applicable.length) * 100).toFixed(1)) : 0,
        affectedPages: reportedAffected.slice(0, 10).map(({ url, check }) => ({
          url,
          issueCount: 1,
          evidence: check.evidence
        })),
        sampleEvidence: reportedAffected.slice(0, 10).map(({ url, check }) => ({
          url,
          evidence: check.evidence
        })),
        ...(skipped ? {
          skippedReason: String(pageChecks[0]?.check.evidence.skippedReason || "No applicable page type or required DOM pattern was detected")
        } : {})
      }
    } satisfies StructuredDataCheckResult;
  });
  return {
    score: scoreChecks(checks),
    checkedAt: new Date().toISOString(),
    categories: summarize(checks),
    checks
  };
}

export async function runStructuredDataAudit(
  inputUrl: string,
  html?: string,
  siteCrawl?: SiteCrawlResult
): Promise<StructuredDataAuditResult> {
  const crawlPages = siteCrawl?.pages.filter((page) => page.status >= 200 && page.status < 400 && Boolean(page.html.trim())) ?? [];
  if (!crawlPages.length) return runStructuredDataPageAudit(inputUrl, html);
  const pageAudits = await Promise.all(crawlPages.map(async (page) => ({
    url: page.finalUrl,
    audit: await runStructuredDataPageAudit(page.finalUrl, page.html)
  })));
  return aggregatePageAudits(pageAudits, {
    pagesCrawled: crawlPages.length,
    targetUrls: siteCrawl?.crawlStats.targetUrls,
    attemptedUrls: siteCrawl?.crawlStats.attemptedUrls,
    cappedByMaxPages: siteCrawl?.crawlStats.cappedByMaxPages
  });
}
