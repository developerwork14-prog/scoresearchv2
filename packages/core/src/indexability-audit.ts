import * as cheerio from "cheerio";
import { scoreParameterOutcomes, statusForParameterOutcomes } from "./audit-outcome.js";
import { fetchSitemapUrls } from "./site-crawler.js";
import type { GoogleSearchConsoleContext } from "./types.js";

export type IndexabilitySeverity = "Critical" | "High" | "Medium" | "Low";
export type IndexabilityStatus = "Passed" | "Minor Attention" | "Needs Attention" | "Skipped";

export interface IndexabilityCheckDefinition {
  id: number;
  category: string;
  name: string;
  severity: IndexabilitySeverity;
  maxScore: number;
}

export interface IndexabilityCheckResult extends IndexabilityCheckDefinition {
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
  status: IndexabilityStatus;
}

export interface IndexabilityAuditResult {
  score: number;
  checkedAt: string;
  categories: IndexabilityCategorySummary[];
  checks: IndexabilityCheckResult[];
}

const CHECKS: IndexabilityCheckDefinition[] = [
  { id: 1, category: "Index Status", name: "No noindex Anywhere", severity: "Critical", maxScore: 10 },
  { id: 2, category: "Index Status", name: "Google Index Verified", severity: "Critical", maxScore: 10 },
  { id: 3, category: "Index Status", name: "Bing Index Verified", severity: "Critical", maxScore: 10 },
  { id: 4, category: "Index Status", name: "GSC Coverage Zero Errors", severity: "High", maxScore: 8 },
  { id: 5, category: "Index Status", name: "Canonical Not -> Noindex", severity: "Critical", maxScore: 10 },
  { id: 6, category: "Index Status", name: "No noindex in Sitemap", severity: "High", maxScore: 8 },
  { id: 7, category: "Canonicalization", name: "Self-Referencing Canonical", severity: "Critical", maxScore: 10 },
  { id: 8, category: "Canonicalization", name: "Canonical Absolute HTTPS", severity: "High", maxScore: 8 },
  { id: 9, category: "Canonicalization", name: "Canonical Target Returns 200", severity: "Critical", maxScore: 10 },
  { id: 10, category: "Canonicalization", name: "No Canonical Chains", severity: "High", maxScore: 8 },
  { id: 12, category: "Snippet Controls", name: "No nosnippet on Key Pages", severity: "Critical", maxScore: 10 },
  { id: 13, category: "Snippet Controls", name: "No max-snippet:0 / Low", severity: "Critical", maxScore: 10 },
  { id: 14, category: "Snippet Controls", name: "No data-nosnippet Key Content", severity: "High", maxScore: 8 },
  { id: 15, category: "Snippet Controls", name: "No max-image-preview:none", severity: "Low", maxScore: 4 },
  { id: 16, category: "URL & Redirect Management", name: "HTTP->HTTPS No Dual Serving", severity: "Critical", maxScore: 10 },
  { id: 17, category: "URL & Redirect Management", name: "WWW/Non-WWW Handled", severity: "Critical", maxScore: 10 },
  { id: 18, category: "URL & Redirect Management", name: "Parameter URL Managed", severity: "High", maxScore: 8 },
  { id: 19, category: "International & Pagination", name: "Pagination rel=next/prev", severity: "Low", maxScore: 4 },
  { id: 20, category: "International & Pagination", name: "Hreflang Correct", severity: "High", maxScore: 8 },
  { id: 21, category: "Access & Gating", name: "No Login/Paywall Gate", severity: "Critical", maxScore: 10 },
  { id: 22, category: "Access & Gating", name: "No Consent Wall Blocking", severity: "Critical", maxScore: 10 },
  { id: 23, category: "Access & Gating", name: "No Back-Button Hijack", severity: "Critical", maxScore: 10 },
  { id: 24, category: "Rendering & Content Access", name: "CSS Hidden <100 Words", severity: "High", maxScore: 8 },
  { id: 25, category: "Rendering & Content Access", name: "No Soft-404s", severity: "High", maxScore: 8 },
  { id: 26, category: "Rendering & Content Access", name: "Infinite Scroll Crawlable Pagination", severity: "Low", maxScore: 4 }
];

const CATEGORY_ORDER = [
  "Index Status",
  "Canonicalization",
  "Snippet Controls",
  "URL & Redirect Management",
  "International & Pagination",
  "Access & Gating",
  "Rendering & Content Access"
];

const SITEMAP_INDEXABILITY_SAMPLE_LIMIT = 8;
const SITEMAP_INDEXABILITY_CONCURRENCY = 4;

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeUrl(value: string) {
  const withProtocol = value.startsWith("http") ? value : `https://${value}`;
  return new URL(withProtocol).toString();
}

async function fetchText(url: string, timeoutMs = 8000, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: init?.redirect ?? "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "AIVisibilityAnalyzer/1.0",
        accept: "text/html,application/xhtml+xml,text/plain,*/*",
        ...(init?.headers ?? {})
      }
    });
    const text = await response.text().catch(() => "");
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
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

async function settleWithin<T>(promise: Promise<T>, ms: number, fallback: T) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function robotsDirectives(html: string, response?: Response | null) {
  const $ = cheerio.load(html);
  const meta = $("meta[name='robots' i],meta[name='googlebot' i],meta[name='bingbot' i]")
    .toArray()
    .map((el) => $(el).attr("content") ?? "")
    .join(",");
  const header = response?.headers.get("x-robots-tag") ?? "";
  return `${meta},${header}`;
}

function noindexFoundIn(html: string, response?: Response | null) {
  return /(^|,|\s)noindex(,|\s|$)/i.test(robotsDirectives(html, response));
}

function canonicalHref(html: string, baseUrl: string, response?: Response | null) {
  const $ = cheerio.load(html);
  const htmlCanonical = $("link[rel='canonical' i]").first().attr("href") ?? "";
  if (!htmlCanonical) return "";
  try {
    return new URL(htmlCanonical, baseUrl).toString();
  } catch {
    return "";
  }
}

function comparableUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

function maxSnippetValue(html: string, response?: Response | null) {
  const match = robotsDirectives(html, response).match(/max-snippet\s*:\s*(-?\d+)/i);
  return match ? Number(match[1]) : null;
}

function maxImagePreviewValue(html: string, response?: Response | null) {
  return robotsDirectives(html, response).match(/max-image-preview\s*:\s*([a-z]+)/i)?.[1]?.toLowerCase() ?? "";
}

function dataNosnippetEvidence($: cheerio.CheerioAPI) {
  const affectedElements = $("[data-nosnippet]")
    .toArray()
    .map((el) => ({ tag: el.tagName?.toLowerCase() ?? "element", words: wordCount($(el).text()) }))
    .filter((item) => item.words > 50);
  return { pass: affectedElements.length === 0, count: $("[data-nosnippet]").length, affectedElements };
}

async function httpToHttpsEvidence(url: URL) {
  if (url.protocol === "http:") return { pass: false, reason: "Audited URL is HTTP" };
  const httpUrl = new URL(url.toString());
  httpUrl.protocol = "http:";
  const result = await fetchText(httpUrl.toString(), 5000, { redirect: "manual" }).catch(() => null);
  const location = result?.response.headers.get("location") ?? "";
  if (!result) return { skipped: true, reason: "HTTP-to-HTTPS redirect could not be verified from the current crawl environment" };
  return {
    pass: Boolean(result && [301, 302, 307, 308].includes(result.response.status) && /^https:/i.test(location)),
    status: result?.response.status ?? 0,
    location
  };
}

async function wwwVariantEvidence(url: URL) {
  const alternate = new URL(url.toString());
  alternate.hostname = url.hostname.startsWith("www.") ? url.hostname.replace(/^www\./, "") : `www.${url.hostname}`;
  const result = await fetchText(alternate.toString(), 5000, { redirect: "manual" }).catch(() => null);
  const location = result?.response.headers.get("location") ?? "";
  const pass = !result || [301, 302, 307, 308, 404, 410].includes(result.response.status) || comparableUrl(location) === comparableUrl(url.toString());
  return { pass, alternate: alternate.toString(), status: result?.response.status ?? 0, location };
}

function parameterUrlEvidence(url: URL, canonicalUrl: string) {
  const trapParams = ["sort", "filter", "color", "size", "page", "q", "s"];
  const present = trapParams.filter((param) => url.searchParams.has(param));
  if (!present.length) return { pass: true, parameterUrlsFound: 0, canonicalized: 0, params: [] };
  const canonicalClean = canonicalUrl ? new URL(canonicalUrl).searchParams.size === 0 : false;
  return { pass: canonicalClean, parameterUrlsFound: present.length, canonicalized: canonicalClean ? present.length : 0, params: present, canonicalUrl };
}

function paginationEvidence($: cheerio.CheerioAPI, canonicalUrl: string) {
  const paginationDetected = $("a[href*='page='],a[href*='/page/'],link[rel='next' i],link[rel='prev' i]").length > 0;
  if (!paginationDetected) return { skipped: true, notApplicable: true, reason: "Pagination not detected" };
  const next = $("link[rel='next' i]").attr("href") ?? "";
  const prev = $("link[rel='prev' i]").attr("href") ?? "";
  return { pass: Boolean(next || prev || canonicalUrl), paginationDetected, next, prev, canonicalUrl };
}

function hreflangEvidence($: cheerio.CheerioAPI) {
  const alternates = $("link[rel='alternate' i][hreflang]").toArray();
  if (!alternates.length) return { skipped: true, notApplicable: true, reason: "Multilingual hreflang not detected" };
  const values = alternates.map((el) => ($(el).attr("hreflang") ?? "").toLowerCase()).filter(Boolean);
  const hrefs = alternates.map((el) => $(el).attr("href") ?? "").filter(Boolean);
  const hasXDefault = values.includes("x-default");
  const malformed = values.filter((value) => value !== "x-default" && !/^[a-z]{2}(-[a-z]{2})?$/i.test(value));
  return { pass: hrefs.length === values.length && malformed.length === 0, count: values.length, hasXDefault, malformed };
}

function gatingEvidence($: cheerio.CheerioAPI, bodyText: string) {
  const gatePattern = /\b(login|sign in|subscribe|paywall|members only|create an account|restricted access)\b/i;
  const formCount = $("input[type='password'],form[action*='login' i],form[action*='signin' i]").length;
  const words = wordCount(bodyText);
  const gateTextDetected = gatePattern.test(bodyText);
  const hardGate = formCount > 0 && words < 250;
  return { pass: !hardGate && !(gateTextDetected && words < 120), warning: !hardGate && gateTextDetected && words < 250, words, formCount, gateTextDetected };
}

function consentEvidence($: cheerio.CheerioAPI, bodyText: string) {
  const overlays = $("[class*='cookie' i],[class*='consent' i],[id*='cookie' i],[id*='consent' i],[class*='gdpr' i]").length;
  const rawWordCount = wordCount(bodyText);
  return { pass: overlays === 0 || rawWordCount >= 100, warning: overlays > 0 && rawWordCount >= 50 && rawWordCount < 100, overlays, rawWordCount };
}

function backButtonHijackEvidence(html: string) {
  const scriptsFound = (html.match(/history\.(?:pushState|replaceState)|onpopstate/gi) ?? []);
  const loopSignals = (html.match(/setInterval\s*\([^)]*history\.|while\s*\([^)]*\)\s*{[^}]*history\./gi) ?? []);
  if (loopSignals.length > 0) {
    return {
      pass: true,
      reason: "History API code was detected, but no confirmed Back-button interference was observed.",
      scriptsFound: [...new Set(scriptsFound)],
      loopSignals
    };
  }
  return { pass: true, scriptsFound: [...new Set(scriptsFound)], loopSignals };
}

function hiddenContentEvidence($: cheerio.CheerioAPI, pageUrl: string) {
  const primary = $("main,article,[role='main']").first();
  if (!primary.length) {
    return { skipped: true, reason: "Insufficient evidence to determine hidden-content usage." };
  }
  const excluded = "nav,header,footer,details,dialog,[role='navigation'],[aria-modal='true'],[class*='modal' i],[class*='menu' i],[class*='accordion' i],[class*='tab' i],[class*='carousel' i],[class*='slider' i],[class*='cookie' i],[class*='consent' i]";
  let hiddenWords = 0;
  const samples: string[] = [];
  primary.find("[hidden],[aria-hidden='true'],[style*='display:none' i],[style*='display: none' i],[style*='visibility:hidden' i],[style*='visibility: hidden' i]").each((_, el) => {
    if ($(el).closest(excluded).length) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    hiddenWords += wordCount(text);
    if (text && samples.length < 3) samples.push(text.slice(0, 180));
  });
  const primaryWords = wordCount(primary.text());
  const hiddenRatio = primaryWords ? hiddenWords / primaryWords : 0;
  const failed = hiddenWords >= 100 && hiddenRatio >= 0.2;
  return {
    pass: !failed,
    pagesCrawled: 1,
    pagesChecked: 1,
    pagesFailed: failed ? 1 : 0,
    affectedPages: failed ? [{ url: pageUrl, issueCount: 1 }] : [],
    hiddenWords,
    hiddenRatio: Number(hiddenRatio.toFixed(2)),
    samples
  };
}

async function soft404Evidence(url: URL) {
  const samples = ["/random-url-123456789-test/", "/nonexistent-page-seo-audit-test/"];
  const results = await Promise.all(samples.map(async (path) => {
    const target = new URL(path, url.origin).toString();
    const result = await fetchText(target, 5000).catch(() => null);
    return { url: target, status: result?.response.status ?? 0, words: wordCount(cheerio.load(result?.text ?? "")("body").text()) };
  }));
  const pass = results.every((result) => result.status === 404 || result.status === 410);
  const warning = !pass && results.every((result) => result.status === 0 || result.status >= 400 || result.words < 300);
  return { pass, warning, results };
}

function infiniteScrollEvidence(html: string, $: cheerio.CheerioAPI, pagination: { skipped?: boolean; pass?: boolean }) {
  const explicitLibrarySignal = /infinite[-_\s]?scroll|endless[-_\s]?scroll|jscroll|ias\.|infiniteScroll\(/i.test(html);
  const observerAppendSignal = /IntersectionObserver[\s\S]{0,1200}(?:appendChild|insertAdjacentHTML|loadMore|nextPage|page\s*\+\+|offset\s*\+=|cursor)/i.test(html);
  const scrollAppendSignal = /(?:addEventListener\(\s*["']scroll["']|onscroll\s*=|\.on\(\s*["']scroll["'])[\s\S]{0,1200}(?:appendChild|insertAdjacentHTML|loadMore|nextPage|page\s*\+\+|offset\s*\+=|cursor)/i.test(html);
  const listingItemCount = $("article,[class*='post-card' i],[class*='article-card' i],[class*='product-card' i],[class*='listing-item' i]").length;
  const visibleLoadMore = listingItemCount >= 2 && $("button,a").toArray().some((element) => {
    const node = $(element);
    const href = (node.attr("href") ?? "").trim();
    const nonCrawlableControl = element.tagName?.toLowerCase() === "button"
      || !href
      || href === "#"
      || /^javascript:/i.test(href);
    return nonCrawlableControl && /\b(?:load|show|view)\s+more\b/i.test(node.text());
  });
  const hasInfiniteSignal = explicitLibrarySignal || observerAppendSignal || scrollAppendSignal || visibleLoadMore;
  if (!hasInfiniteSignal) return { skipped: true, notApplicable: true, reason: "No infinite-scroll or auto-loading content behavior detected" };
  const hasPagination = !pagination.skipped || $("a[href*='page='],a[href*='?p='],a[href*='/page/'],a[rel='next' i],a[rel='prev' i],link[rel='next' i],link[rel='prev' i],[class*='pagination' i] a[href]").length > 0;
  return {
    pass: hasPagination,
    infiniteScrollDetected: hasInfiniteSignal,
    paginationDetected: hasPagination,
    signals: { explicitLibrarySignal, observerAppendSignal, scrollAppendSignal, visibleLoadMore, listingItemCount }
  };
}

async function searchIndexEvidence(engine: "google" | "bing", hostname: string, googleSearchConsole?: GoogleSearchConsoleContext) {
  if (engine === "google") return googleUrlInspectionEvidence(hostname, googleSearchConsole);
  const envKey = "BING_WEBMASTER_API_KEY";
  return {
    skipped: true,
    reason: process.env[envKey]
      ? `${envKey} configured but API integration is not implemented in this audit runtime`
      : `${engine} index verification requires a connected API`,
    hostname
  };
}

function gscSiteUrlFor(hostname: string, googleSearchConsole?: GoogleSearchConsoleContext) {
  if (googleSearchConsole?.siteUrl) return googleSearchConsole.siteUrl;
  return `sc-domain:${hostname.replace(/^www\./, "")}`;
}

function googleIndexPass(indexStatusResult: Record<string, unknown>) {
  const verdict = String(indexStatusResult.verdict ?? "");
  const coverageState = String(indexStatusResult.coverageState ?? "");
  const indexingState = String(indexStatusResult.indexingState ?? "");
  return verdict === "PASS"
    || indexingState === "INDEXING_ALLOWED" && /indexed|submitted and indexed/i.test(coverageState);
}

async function googleUrlInspectionEvidence(hostname: string, googleSearchConsole?: GoogleSearchConsoleContext) {
  const accessToken = (googleSearchConsole?.accessToken || "").trim();
  const inspectionUrl = (googleSearchConsole?.inspectionUrl || "").trim();
  const siteUrl = gscSiteUrlFor(hostname, googleSearchConsole);
  if (!accessToken) {
    return {
      skipped: true,
      reason: "Connect Google Search Console with Google OAuth to verify index status",
      requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
      hostname
    };
  }
  const targetUrl = inspectionUrl || `https://${hostname}/`;
  try {
    const response = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        inspectionUrl: targetUrl,
        siteUrl,
        languageCode: "en-US"
      })
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    const inspectionResult = data.inspectionResult && typeof data.inspectionResult === "object"
      ? data.inspectionResult as Record<string, unknown>
      : {};
    const indexStatusResult = inspectionResult.indexStatusResult && typeof inspectionResult.indexStatusResult === "object"
      ? inspectionResult.indexStatusResult as Record<string, unknown>
      : {};
    const pass = response.ok && googleIndexPass(indexStatusResult);
    return {
      pass,
      pagesChecked: 1,
      pagesFailed: pass ? 0 : 1,
      affectedPages: pass ? [] : [{ url: targetUrl, issueCount: 1 }],
      inspectionUrl: targetUrl,
      siteUrl,
      status: response.status,
      verdict: indexStatusResult.verdict ?? "",
      coverageState: indexStatusResult.coverageState ?? "",
      indexingState: indexStatusResult.indexingState ?? "",
      robotsTxtState: indexStatusResult.robotsTxtState ?? "",
      pageFetchState: indexStatusResult.pageFetchState ?? "",
      googleCanonical: indexStatusResult.googleCanonical ?? "",
      userCanonical: indexStatusResult.userCanonical ?? "",
      lastCrawlTime: indexStatusResult.lastCrawlTime ?? "",
      ...(response.ok ? {} : { error: data.error ?? data })
    };
  } catch (error) {
    return {
      skipped: true,
      reason: "Google URL Inspection API request failed in this crawl environment",
      inspectionUrl: targetUrl,
      siteUrl,
      hostname,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function gscCoverageEvidence(googleSearchConsole?: GoogleSearchConsoleContext) {
  if (!googleSearchConsole?.accessToken) return { skipped: true, reason: "Connect Google Search Console with Google OAuth to verify coverage signals" };
  return { skipped: true, reason: "Search Console connected; Google does not expose the full Coverage report through this audit path. URL Inspection is used for Google Index Verified." };
}

function categorySummaries(checks: IndexabilityCheckResult[]): IndexabilityCategorySummary[] {
  return CATEGORY_ORDER.map((categoryName) => {
    const categoryChecks = checks.filter((check) => check.category === categoryName);
    const scorable = categoryChecks.filter((check) => !check.skipped);
    const failed = scorable.filter((check) => !check.passed && !check.warning);
    const warnings = scorable.filter((check) => check.warning);
    const skippedChecks = categoryChecks.filter((check) => check.skipped).length;
    const score = scoreParameterOutcomes(categoryChecks, 0);
    const status: IndexabilityStatus = statusForParameterOutcomes(categoryChecks);
    return {
      categoryName,
      totalChecks: categoryChecks.length,
      passedChecks: scorable.filter((check) => check.passed && !check.warning).length,
      failedChecks: failed.length,
      warningChecks: warnings.length,
      skippedChecks,
      score,
      status
    };
  }).filter((category) => category.totalChecks > 0);
}

function resultFor(id: number, evidence: Record<string, unknown>): IndexabilityCheckResult {
  const definition = CHECKS.find((check) => check.id === id);
  if (!definition) throw new Error(`Unknown indexability check ${id}`);
  const skipped = Boolean(evidence.skipped);
  const passed = skipped ? true : Boolean(evidence.pass);
  const warning = !skipped && !passed && Boolean(evidence.warning);
  return {
    ...definition,
    passed,
    skipped,
    ...(evidence.notApplicable ? { notApplicable: true } : {}),
    warning: warning || undefined,
    score: skipped ? 0 : passed ? 1 : 0,
    evidence
  };
}

export async function runIndexabilityAudit(inputUrl: string, html?: string, options: { googleSearchConsole?: GoogleSearchConsoleContext } = {}): Promise<IndexabilityAuditResult> {
  const normalizedUrl = normalizeUrl(inputUrl);
  const url = new URL(normalizedUrl);
  const serverPage = html ? { text: html, response: null as Response | null } : await fetchText(normalizedUrl).catch(() => ({ text: "", response: null as Response | null }));
  const pageHtml = serverPage.text;
  const $ = cheerio.load(pageHtml);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const canonicalUrl = canonicalHref(pageHtml, normalizedUrl, serverPage.response);
  const canonicalTarget = canonicalUrl ? await fetchText(canonicalUrl, 3000).catch(() => null) : null;
  const secondCanonicalUrl = canonicalTarget ? canonicalHref(canonicalTarget.text, canonicalUrl, canonicalTarget.response) : "";
  const sitemapUrls = await settleWithin(
    fetchSitemapUrls(url.origin, 2500, SITEMAP_INDEXABILITY_SAMPLE_LIMIT)
      .then((result) => result.urls.slice(0, SITEMAP_INDEXABILITY_SAMPLE_LIMIT))
      .catch(() => []),
    8000,
    []
  );
  const sitemapSamples = await mapWithConcurrency(sitemapUrls, SITEMAP_INDEXABILITY_CONCURRENCY, async (sampleUrl) => {
    const page = await fetchText(sampleUrl, 1800).catch(() => null);
    const sampleCanonical = page ? canonicalHref(page.text, sampleUrl, page.response) : "";
    const canonicalPage = sampleCanonical ? await fetchText(sampleCanonical, 1500).catch(() => null) : null;
    return {
      url: sampleUrl,
      noindex: Boolean(page && noindexFoundIn(page.text, page.response)),
      canonicalNoindex: Boolean(canonicalPage && noindexFoundIn(canonicalPage.text, canonicalPage.response))
    };
  });
  const pagination = paginationEvidence($, canonicalUrl);
  const [googleIndex, bingIndex, soft404, httpHttps, wwwVariant] = await Promise.all([
    searchIndexEvidence("google", url.hostname, options.googleSearchConsole),
    searchIndexEvidence("bing", url.hostname),
    soft404Evidence(url),
    httpToHttpsEvidence(url),
    wwwVariantEvidence(url)
  ]);
  const checks = [
    resultFor(1, { pass: !noindexFoundIn(pageHtml, serverPage.response), directives: robotsDirectives(pageHtml, serverPage.response) }),
    resultFor(2, googleIndex),
    resultFor(3, bingIndex),
    resultFor(4, gscCoverageEvidence(options.googleSearchConsole)),
    resultFor(5, { pass: !canonicalTarget || !noindexFoundIn(canonicalTarget.text, canonicalTarget.response), canonicalUrl, targetNoindex: Boolean(canonicalTarget && noindexFoundIn(canonicalTarget.text, canonicalTarget.response)) }),
    resultFor(6, { pass: sitemapSamples.every((sample) => !sample.noindex && !sample.canonicalNoindex), checked: sitemapSamples.length, noindexedUrls: sitemapSamples.filter((sample) => sample.noindex || sample.canonicalNoindex).slice(0, 10) }),
    resultFor(7, { pass: Boolean(canonicalUrl && comparableUrl(canonicalUrl) === comparableUrl(normalizedUrl)), canonicalUrl, pageUrl: normalizedUrl }),
    resultFor(8, { pass: /^https:\/\//i.test(canonicalUrl), canonicalUrl }),
    resultFor(9, !canonicalUrl
      ? { skipped: true, notApplicable: true, reason: "No canonical target was declared" }
      : !canonicalTarget
        ? { skipped: true, reason: "Unable to verify the canonical target response from the current crawl environment", canonicalUrl }
        : { pass: canonicalTarget.response.status === 200, canonicalUrl, status: canonicalTarget.response.status }),
    resultFor(10, { pass: !canonicalUrl || !secondCanonicalUrl || comparableUrl(secondCanonicalUrl) === comparableUrl(canonicalUrl), chain: [normalizedUrl, canonicalUrl, secondCanonicalUrl].filter(Boolean), maxDepth: 1 }),
    resultFor(12, { pass: !/nosnippet/i.test(robotsDirectives(pageHtml, serverPage.response)), directives: robotsDirectives(pageHtml, serverPage.response) }),
    resultFor(13, { pass: maxSnippetValue(pageHtml, serverPage.response) === null || maxSnippetValue(pageHtml, serverPage.response) === -1 || (maxSnippetValue(pageHtml, serverPage.response) ?? 0) >= 50, value: maxSnippetValue(pageHtml, serverPage.response), lowThreshold: 50 }),
    resultFor(14, dataNosnippetEvidence($)),
    resultFor(15, { pass: maxImagePreviewValue(pageHtml, serverPage.response) !== "none", value: maxImagePreviewValue(pageHtml, serverPage.response) || "default" }),
    resultFor(16, httpHttps),
    resultFor(17, wwwVariant),
    resultFor(18, parameterUrlEvidence(url, canonicalUrl)),
    resultFor(19, pagination),
    resultFor(20, hreflangEvidence($)),
    resultFor(21, gatingEvidence($, bodyText)),
    resultFor(22, consentEvidence($, bodyText)),
    resultFor(23, backButtonHijackEvidence(pageHtml)),
    resultFor(24, hiddenContentEvidence($, normalizedUrl)),
    resultFor(25, soft404),
    resultFor(26, infiniteScrollEvidence(pageHtml, $, pagination))
  ];
  for (const check of checks) {
    if (check.passed || check.skipped) continue;
    const pagesChecked = Number(check.evidence.pagesChecked);
    const pagesFailed = Number(check.evidence.pagesFailed);
    const affectedPages = Array.isArray(check.evidence.affectedPages) ? check.evidence.affectedPages : [];
    if (!(pagesChecked > 0 && pagesFailed > 0 && affectedPages.some((page) =>
      page && typeof page === "object" && typeof (page as Record<string, unknown>).url === "string"
    ))) {
      check.evidence = {
        ...check.evidence,
        pagesCrawled: 1,
        pagesChecked: 1,
        pagesFailed: 1,
        affectedPages: [{ url: normalizedUrl, issueCount: 1 }]
      };
    }
  }
  const hiddenCheck = checks.find((check) => check.id === 24);
  if (hiddenCheck) {
    hiddenCheck.recommendation = "Keep important primary content visible in the initial page experience. Hidden navigation, dialogs, accordions, and interface controls are excluded.";
  }
  const infiniteScrollCheck = checks.find((check) => check.id === 26);
  if (infiniteScrollCheck) {
    infiniteScrollCheck.recommendation = "When content is loaded automatically during scrolling, provide crawlable pagination links to the same items.";
  }
  const categories = categorySummaries(checks);
  const scorable = checks.filter((check) => !check.skipped);
  const score = scoreParameterOutcomes(checks, 0);
  return { score, checkedAt: new Date().toISOString(), categories, checks };
}
