import * as cheerio from "cheerio";
import {
  ImageSeoAuditResult,
  ImageSeoCategorySummary,
  ImageSeoCheckResult,
  ImageSeoSeverity,
  TechnicalCategoryStatus
} from "./types.js";
import { crawlSite, type SiteCrawlResult } from "./site-crawler.js";
import { isLikelyDecorativeImage, suggestedAltFromPageContext } from "./image-alt-utils.js";
import { scoreParameterOutcomes, statusForParameterOutcomes } from "./audit-outcome.js";
import { aggregatePages, outcomeForEvidence } from "./site-audit-evidence.js";
import { imageSeoRecommendation } from "./image-seo-recommendations.js";

interface CheckDefinition {
  id: number;
  category: string;
  name: string;
  weight: number;
  severity: ImageSeoSeverity;
}

const CHECKS: CheckDefinition[] = [
  [1, "Alt Text", "Meaningful Images Have Alt Text", 4.38, "High"],
  [2, "Image Format & Performance", "WebP/AVIF >=70%", 3.26, "Medium"],
  [3, "Image Format & Performance", "LCP Image Preloaded", 3.8, "High"],
  [4, "Image Format & Performance", "<picture> with WebP+Fallback", 0, "Low"],
  [5, "Image Format & Performance", "Stable Image URLs", 2.17, "Medium"],
  [6, "Image Format & Performance", "Native Lazy Loading (Not JS)", 0, "Low"],
  [7, "Image Format & Performance", "Responsive srcset+sizes", 0, "Low"],
  [8, "Image Format & Performance", "Descriptive File Names", 0, "Low"],
  [9, "Content & Accessibility", "OCR-HTML Data Parity", 3.8, "Medium"],
  [10, "Content & Accessibility", "No Key Data as Image-Only", 3.8, "High"],
  [11, "Content & Accessibility", "No Images Blocking Text", 2.72, "High"],
  [12, "Schema & Markup", "SVG <title>+<desc>", 0, "Low"],
  [13, "Schema & Markup", "ImageObject Schema", 0, "Low"]
].map(([id, category, name, weight, severity]) => ({ id, category, name, weight, severity })) as CheckDefinition[];

const CATEGORY_ORDER = [...new Set(CHECKS.map((check) => check.category))];
const ADVISORY_CHECK_IDS = new Set([4, 6, 7, 8, 12, 13]);

function advisoryOpportunity(name: string) {
  return `Optional image optimization: improve ${name.toLowerCase()} where it benefits performance, accessibility, or image understanding.`;
}
const RASTER_EXTENSIONS = /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i;

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeUrl(value: string) {
  return value.startsWith("http") ? value : `https://${value}`;
}

function linkElementsByRel($: cheerio.CheerioAPI, rel: string) {
  const expected = rel.toLowerCase();
  return $("link").toArray().filter((el) => ($(el).attr("rel") ?? "").toLowerCase().split(/\s+/).includes(expected));
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

function result(def: CheckDefinition, state: { passed?: boolean; skipped?: boolean; warning?: boolean; evidence?: Record<string, unknown> }): ImageSeoCheckResult {
  const skipped = Boolean(state.skipped);
  const passed = skipped ? true : Boolean(state.passed);
  const warning = !skipped && !passed && Boolean(state.warning);
  return {
    ...def,
    ...(ADVISORY_CHECK_IDS.has(def.id) && !passed && !skipped
      ? { informational: true, opportunity: advisoryOpportunity(def.name) }
      : {}),
    recommendation: imageSeoRecommendation(def.name, def.severity, state.evidence ?? {}),
    passed,
    skipped,
    warning,
    score: skipped ? 0 : passed ? 1 : 0,
    evidence: state.evidence ?? {}
  };
}

function summarize(checks: ImageSeoCheckResult[]): ImageSeoCategorySummary[] {
  return CATEGORY_ORDER.map((categoryName) => {
    const categoryChecks = checks.filter((check) => check.category === categoryName);
    const scorable = categoryChecks.filter((check) => !check.skipped && !check.informational && check.weight !== 0);
    const failed = scorable.filter((check) => !check.passed && !check.warning);
    const warningChecks = scorable.filter((check) => check.warning).length;
    const skippedChecks = categoryChecks.filter((check) => check.skipped).length;
    const score = scoreParameterOutcomes(categoryChecks);
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

function imageUrlFrom($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]) {
  return $(el).attr("src") || $(el).attr("data-src") || "";
}

function numericDimension($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0], name: "width" | "height") {
  const direct = Number.parseFloat($(el).attr(name) ?? "");
  if (Number.isFinite(direct)) return direct;
  const style = $(el).attr("style") ?? "";
  const match = style.match(new RegExp(`${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, "i"));
  return match ? Number.parseFloat(match[1]) : null;
}

function isSmallImage($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0], threshold: number) {
  const width = numericDimension($, el, "width");
  const height = numericDimension($, el, "height");
  return (width !== null && width < threshold) || (height !== null && height < threshold);
}

function descriptors($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]) {
  return [$(el).attr("class"), $(el).attr("id"), $(el).attr("role"), $(el).attr("aria-label"), imageUrlFrom($, el)]
    .filter(Boolean)
    .join(" ");
}

function componentHint($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]) {
  const image = $(el);
  const context = [
    image.attr("class"),
    image.attr("id"),
    image.closest("[class],[id]").attr("class"),
    image.closest("[class],[id]").attr("id")
  ].filter(Boolean).join(" ");
  if (/\bhero|masthead|banner\b/i.test(context)) return "Hero or banner component";
  if (/\bcta|call[-_ ]?to[-_ ]?action\b/i.test(context)) return "Shared CTA component";
  if (/\bcard|teaser|thumbnail\b/i.test(context)) return "Content card component";
  if (/\barticle|post|blog\b/i.test(context)) return "Article media component";
  if (/\bgallery|carousel|slider\b/i.test(context)) return "Gallery or carousel component";
  if (/\bfooter\b/i.test(context)) return "Footer component";
  return "Unclassified image renderer";
}

function imageAsset(pageUrl: string, $: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]) {
  const imageUrl = absoluteUrl(new URL(pageUrl), imageUrlFrom($, el));
  return {
    pageUrl,
    assetUrl: imageUrl,
    assetName: fileName(imageUrl) || "inline-image",
    componentHint: componentHint($, el)
  };
}

function shortHash(value: string) {
  return [...value].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261).toString(36);
}

function svgAsset(pageUrl: string, $: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]) {
  const html = $.html(el).replace(/\s+/g, " ").trim();
  const name = `inline-svg-${shortHash(html)}.svg`;
  return {
    pageUrl,
    assetUrl: name,
    assetName: name,
    componentHint: componentHint($, el)
  };
}

function isUiImage($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0]) {
  return isLikelyDecorativeImage($, el)
    || /\b(?:logo|icon|avatar|gravatar|favicon|social|facebook|linkedin|youtube|instagram|twitter|arrow|chevron|hamburger|menu|close)\b/i.test(descriptors($, el));
}

function eligibleRasterImages($: cheerio.CheerioAPI) {
  return $("img").toArray().filter((el) => {
    const src = imageUrlFrom($, el);
    if (!src || !RASTER_EXTENSIONS.test(src) || isUiImage($, el)) return false;
    return !/(?:gravatar\.com|facebook\.com|linkedin\.com|youtube\.com)/i.test(src);
  });
}

function firstPartyImage(pageUrl: string, imageUrl: string) {
  try {
    return new URL(imageUrl, pageUrl).hostname.replace(/^www\./, "") === new URL(pageUrl).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

function eligibleResponsiveImages($: cheerio.CheerioAPI) {
  return eligibleRasterImages($).filter((el) => !isSmallImage($, el, 150));
}

function lazyLoadCandidates($: cheerio.CheerioAPI) {
  const meaningful = eligibleRasterImages($);
  return meaningful.filter((el, index) => {
    if (index < 2) return false;
    return !/\b(?:hero|banner|masthead|above[-_ ]?fold|priority|logo)\b/i.test(descriptors($, el));
  });
}

function meaningfulSvgs($: cheerio.CheerioAPI) {
  return $("svg").toArray().filter((el) => {
    const svg = $(el);
    const descriptor = [svg.attr("class"), svg.attr("id"), svg.attr("role"), svg.attr("aria-label")].filter(Boolean).join(" ");
    if (svg.attr("aria-hidden") === "true" || /^(?:presentation|none)$/i.test(svg.attr("role") ?? "")) return false;
    if (isSmallImage($, el, 32)) return false;
    return !/\b(?:social|facebook|linkedin|youtube|instagram|twitter|arrow|chevron|menu|hamburger|close|icon)\b/i.test(descriptor);
  });
}

function contentImages($: cheerio.CheerioAPI) {
  const scope = $("article").first().length ? $("article").first() : $("main").first();
  if (!scope.length) return [];
  return scope.find("img").toArray().filter((el) => !isUiImage($, el) && !isSmallImage($, el, 150));
}

function absoluteUrl(root: URL, value: string) {
  try {
    return new URL(value, root).toString();
  } catch {
    return value || "";
  }
}

function fileName(url: string) {
  try {
    const parsed = new URL(url, "https://example.com");
    return parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
  } catch {
    return url.split("/").filter(Boolean).at(-1) ?? "";
  }
}

function isDescriptiveFileName(value: string) {
  const name = fileName(value).replace(/\.[a-z0-9]+$/i, "");
  if (!name || name.length < 8) return false;
  if (/^(image|img|photo|pic|screenshot|untitled|dsc|px|spacer|blank|component|group|frame|asset)[-_]?\d*(?:[-_]\d+)*$/i.test(name)) return false;
  return /[a-z]{3,}[-_][a-z0-9]{2,}/i.test(name);
}

function parseJsonLd($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const flatten = (value: unknown): Record<string, unknown>[] => {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(flatten);
    const record = value as Record<string, unknown>;
    return [...(record["@type"] ? [record] : []), ...flatten(record["@graph"])];
  };

  return $("script[type='application/ld+json']").toArray().flatMap((el) => {
    try {
      return flatten(JSON.parse($(el).text()));
    } catch {
      return [];
    }
  });
}

function typesOf(record: Record<string, unknown>) {
  const value = record["@type"];
  return Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];
}

type ImageAltEvidence = {
  pageUrl: string;
  imageUrl: string;
  alt: string;
  issue: "Missing alt attribute" | "Empty alt text";
  suggestedAlt?: string;
};

function uniqueImageEvidence(items: ImageAltEvidence[], limit = 10) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.pageUrl}\n${item.imageUrl}`;
    if (!item.imageUrl || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

async function quickImageCrawl(url: string) {
  const crawl = crawlSite(url, {
    maxPages: 60,
    maxDepth: 0,
    timeoutMs: 1500,
    concurrency: 10,
    maxSitemapFiles: 80,
    followInternalLinks: false
  }).catch(() => null);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5500));
  return Promise.race([crawl, timeout]);
}

function evaluateImageCheck(page: SiteCrawlResult["pages"][number], id: number) {
  const $ = page.$;
  const allImages = $("img").toArray();
  const meaningfulImages = allImages.filter((el) => !isLikelyDecorativeImage($, el));
  const rasterImages = eligibleRasterImages($);
  const imageUrls = rasterImages.map((el) => imageUrlFrom($, el)).filter(Boolean);
  const pictures = $("picture").toArray();
  switch (id) {
    case 1: {
      const missing = meaningfulImages.filter((el) => !($(el).attr("alt") ?? "").trim());
      return {
        passed: missing.length === 0,
        issueCount: missing.length,
        evidence: {
          meaningfulImages: meaningfulImages.length,
          missingAlt: missing.length,
          missingAltImages: missing.map((el) => {
            const alt = $(el).attr("alt");
            const suggestedAlt = suggestedAltFromPageContext($, el);
            return {
              pageUrl: page.finalUrl,
              imageUrl: absoluteUrl(new URL(page.finalUrl), imageUrlFrom($, el)),
              alt: alt ?? "",
              issue: alt === undefined ? "Missing alt attribute" : "Empty alt text",
              ...(suggestedAlt ? { suggestedAlt } : {})
            };
          }).slice(0, 10)
          ,
          affectedAssets: missing.map((el) => imageAsset(page.finalUrl, $, el))
        }
      };
    }
    case 2: {
      const modern = imageUrls.filter((src) => /\.(?:webp|avif)(?:[?#]|$)/i.test(src)).length;
      const legacy = rasterImages.filter((el) => !/\.(?:webp|avif)(?:[?#]|$)/i.test(imageUrlFrom($, el)));
      return { passed: imageUrls.length === 0 || modern / imageUrls.length >= 0.7, issueCount: legacy.length, evidence: { images: imageUrls.length, modernImages: modern, affectedAssets: legacy.map((el) => imageAsset(page.finalUrl, $, el)) } };
    }
    case 4: {
      const failing = pictures.filter((picture) => {
        const sources = $(picture).find("source").toArray();
        const passing = sources.some((source) => /image\/(?:webp|avif)/i.test($(source).attr("type") ?? "") || /\.(?:webp|avif)(?:[?#]|$)/i.test($(source).attr("srcset") ?? "")) && $(picture).find("img").length > 0;
        return !passing;
      });
      return {
        passed: failing.length === 0,
        issueCount: failing.length,
        evidence: {
          pictures: pictures.length,
          passing: pictures.length - failing.length,
          affectedAssets: failing.flatMap((picture) => $(picture).find("img").toArray().map((el) => imageAsset(page.finalUrl, $, el)))
        }
      };
    }
    case 5: {
      const unstable = rasterImages.filter((el) => /[?&](v|ver|version|cache|cachebuster|cb|t|time|timestamp|rand|random)=/i.test(imageUrlFrom($, el)));
      return { passed: unstable.length === 0, issueCount: unstable.length, evidence: { unstableUrls: unstable.map((el) => imageUrlFrom($, el)).slice(0, 5), affectedAssets: unstable.map((el) => imageAsset(page.finalUrl, $, el)) } };
    }
    case 6: {
      const candidates = lazyLoadCandidates($);
      const nativeLazy = candidates.filter((el) => ($(el).attr("loading") ?? "").toLowerCase() === "lazy");
      const jsOnly = candidates.filter((el) => ($(el).attr("data-src") || $(el).attr("data-lazy-src") || /lazyload|lazy-load/i.test($(el).attr("class") ?? "")) && ($(el).attr("loading") ?? "").toLowerCase() !== "lazy");
      const missing = candidates.filter((el) => ($(el).attr("loading") ?? "").toLowerCase() !== "lazy");
      return { passed: missing.length === 0, issueCount: missing.length, evidence: { eligibleBelowFoldImages: candidates.length, nativeLazy: nativeLazy.length, jsOnlyLazy: jsOnly.length, missingNativeLazy: missing.length, affectedAssets: missing.map((el) => imageAsset(page.finalUrl, $, el)) } };
    }
    case 7: {
      const eligible = eligibleResponsiveImages($);
      const responsive = eligible.filter((el) => Boolean($(el).attr("srcset") && $(el).attr("sizes"))).length;
      const missing = eligible.filter((el) => !($(el).attr("srcset") && $(el).attr("sizes")));
      return { passed: eligible.length === 0 || responsive === eligible.length, issueCount: missing.length, evidence: { images: eligible.length, responsive, affectedAssets: missing.map((el) => imageAsset(page.finalUrl, $, el)) } };
    }
    case 8: {
      const firstParty = imageUrls.filter((src) => firstPartyImage(page.finalUrl, src));
      const nonDescriptive = rasterImages.filter((el) => {
        const src = imageUrlFrom($, el);
        return firstPartyImage(page.finalUrl, src) && !isDescriptiveFileName(src);
      });
      return { passed: nonDescriptive.length === 0, issueCount: nonDescriptive.length, evidence: { images: firstParty.length, nonDescriptiveCount: nonDescriptive.length, nonDescriptive: nonDescriptive.map((el) => imageUrlFrom($, el)).slice(0, 5), affectedAssets: nonDescriptive.map((el) => imageAsset(page.finalUrl, $, el)) } };
    }
    case 10: {
      const risk = $("img[alt*='$'],img[alt*='%'],img[alt*='price' i],img[alt*='chart' i],img[alt*='table' i],img[alt*='data' i]").toArray()
        .filter((el) => !isUiImage($, el));
      return { passed: risk.length === 0, issueCount: risk.length, evidence: { possibleImageOnlyData: risk.length, affectedAssets: risk.map((el) => imageAsset(page.finalUrl, $, el)) } };
    }
    case 12: {
      const svgs = meaningfulSvgs($);
      const missing = svgs.filter((el) => $(el).find("title").length === 0 || $(el).find("desc").length === 0);
      return { passed: missing.length === 0, issueCount: missing.length, evidence: { svgs: svgs.length, missingTitleOrDescription: missing.length, affectedAssets: missing.map((el) => svgAsset(page.finalUrl, $, el)) } };
    }
    case 13: {
      const images = contentImages($);
      const objects = parseJsonLd($).filter((record) => typesOf(record).includes("ImageObject")).length;
      return { applicable: images.length > 0, passed: images.length === 0 || objects > 0, issueCount: objects === 0 ? images.length : 0, evidence: { meaningfulContentImages: images.length, imageObjects: objects, affectedAssets: objects === 0 ? images.map((el) => imageAsset(page.finalUrl, $, el)) : [] } };
    }
    default: return { passed: true };
  }
}

function aggregateImageCheck(crawl: SiteCrawlResult, id: number) {
  const evidence = aggregatePages(crawl, (page) => evaluateImageCheck(page, id));
  let failedInstances = 0;
  const allAffectedPageUrls = crawl.pages
    .filter((page) => {
      const result = evaluateImageCheck(page, id);
      if (result.applicable !== false && !result.passed) {
        failedInstances += Math.max(1, result.issueCount ?? 1);
      }
      return result.applicable !== false && !result.passed;
    })
    .map((page) => page.finalUrl);
  const assets = crawl.pages.flatMap((page) => {
    const result = evaluateImageCheck(page, id);
    const sample = result.evidence && typeof result.evidence === "object"
      ? result.evidence as Record<string, unknown>
      : {};
    return Array.isArray(sample.affectedAssets)
      ? sample.affectedAssets.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      : [];
  });
  const unique = new Map<string, Record<string, unknown>>();
  for (const asset of assets) {
    const key = String(asset.assetUrl ?? asset.assetName ?? "");
    if (key && !unique.has(key)) unique.set(key, asset);
  }
  return {
    ...evidence,
    allAffectedPageUrls,
    failedInstances,
    uniqueAssetsAffected: unique.size,
    affectedAssets: [...unique.values()].slice(0, 10)
  };
}

function severityRank(severity: ImageSeoSeverity) {
  return severity === "Critical" ? 4 : severity === "High" ? 3 : severity === "Medium" ? 2 : 1;
}

function boundedSeverity(configured: ImageSeoSeverity, measured: ImageSeoSeverity): ImageSeoSeverity {
  return severityRank(measured) > severityRank(configured) ? configured : measured;
}

export async function runImageSeoAudit(inputUrl: string, html?: string, siteCrawl?: SiteCrawlResult): Promise<ImageSeoAuditResult> {
  const normalized = normalizeUrl(inputUrl);
  const pageHtml = html ?? await fetchHtml(normalized);
  const $ = cheerio.load(pageHtml);
  const crawled = siteCrawl ?? await quickImageCrawl(normalized);
  const pageContexts = crawled?.pages.length
    ? crawled.pages.map((page) => ({ pageUrl: page.finalUrl, html: page.html, $: page.$ }))
    : [{ pageUrl: normalized, html: pageHtml, $ }];
  const allImgRefs = pageContexts.flatMap((page) => page.$("img").toArray().map((el) => ({ ...page, el })));
  const imgRefs = allImgRefs.filter((ref) => {
    const image = ref.$(ref.el);
    const role = (image.attr("role") ?? "").trim().toLowerCase();
    return role !== "presentation" && role !== "none" && (image.attr("aria-hidden") ?? "").trim().toLowerCase() !== "true";
  });
  const meaningfulImgRefs = imgRefs.filter((ref) => !isLikelyDecorativeImage(ref.$, ref.el));
  const decorativeImageCount = allImgRefs.length - meaningfulImgRefs.length;
  const eligibleRasterRefs = pageContexts.flatMap((page) => eligibleRasterImages(page.$).map((el) => ({ ...page, el })));
  const imageUrls = eligibleRasterRefs.map((ref) => imageUrlFrom(ref.$, ref.el)).filter(Boolean);
  const imageCount = imgRefs.length;
  const pictureRefs = pageContexts.flatMap((page) => page.$("picture").toArray().map((el) => ({ ...page, el })));
  const preloadedImages = pageContexts.flatMap((page) => linkElementsByRel(page.$, "preload")
    .filter((el) => (page.$(el).attr("as") ?? "").trim().toLowerCase() === "image")
    .map((el) => page.$(el).attr("href") ?? ""))
    .filter(Boolean);
  const lazyCandidateRefs = pageContexts.flatMap((page) => lazyLoadCandidates(page.$).map((el) => ({ ...page, el })));
  const lazyImages = lazyCandidateRefs.filter((ref) => (ref.$(ref.el).attr("loading") ?? "").toLowerCase() === "lazy");
  const jsLazySignals = lazyCandidateRefs.filter((ref) => (ref.$(ref.el).attr("data-src") || ref.$(ref.el).attr("data-lazy-src") || /lazyload|lazy-load/i.test(ref.$(ref.el).attr("class") ?? "")) && (ref.$(ref.el).attr("loading") ?? "").toLowerCase() !== "lazy");
  const responsiveCandidateRefs = pageContexts.flatMap((page) => eligibleResponsiveImages(page.$).map((el) => ({ ...page, el })));
  const responsiveImages = responsiveCandidateRefs.filter((ref) => Boolean(ref.$(ref.el).attr("srcset") && ref.$(ref.el).attr("sizes")));
  const svgRefs = pageContexts.flatMap((page) => meaningfulSvgs(page.$).map((el) => ({ ...page, el })));
  const jsonLd = pageContexts.flatMap((page) => parseJsonLd(page.$));
  const imageObjects = jsonLd.filter((record) => typesOf(record).includes("ImageObject"));
  const hasAnyImageOnlyTextRisk = pageContexts.some((page) => page.$("img[alt*='$'],img[alt*='%'],img[alt*='price' i],img[alt*='chart' i],img[alt*='table' i],img[alt*='data' i]").length > 0);
  const results: ImageSeoCheckResult[] = [];
  const add = (id: number, state: Parameters<typeof result>[1]) => {
    const def = CHECKS.find((check) => check.id === id);
    if (def) results.push(result(def, state));
  };

  const missingAltRefs = meaningfulImgRefs
    .filter((ref) => !(ref.$(ref.el).attr("alt") ?? "").trim())
    .map((ref) => {
      const suggestedAlt = suggestedAltFromPageContext(ref.$, ref.el);
      return {
        pageUrl: ref.pageUrl,
        imageUrl: absoluteUrl(new URL(ref.pageUrl), imageUrlFrom(ref.$, ref.el) || ref.$(ref.el).attr("src") || ""),
        alt: ref.$(ref.el).attr("alt") ?? "",
        issue: ref.$(ref.el).attr("alt") === undefined ? "Missing alt attribute" as const : "Empty alt text" as const,
        ...(suggestedAlt ? { suggestedAlt } : {})
      };
    });
  const missingAlt = uniqueImageEvidence(missingAltRefs);
  const missingAltCount = missingAltRefs.length;
  const affectedPageCount = new Set(missingAltRefs.map((item) => item.pageUrl)).size;
  const affectedImageCount = new Set(missingAltRefs.map((item) => item.imageUrl).filter(Boolean)).size;
  const meaningfulImageCount = meaningfulImgRefs.length;
  const altCoverage = meaningfulImageCount ? (meaningfulImageCount - missingAltCount) / meaningfulImageCount : 1;
  add(1, {
    passed: missingAltCount === 0,
    warning: altCoverage >= 0.7,
    evidence: {
      summary: `${meaningfulImageCount - missingAltCount}/${meaningfulImageCount} likely meaningful image instances have alt text (${Math.round(altCoverage * 100)}%). ${decorativeImageCount} likely decorative image instance${decorativeImageCount === 1 ? " was" : "s were"} ignored.`,
      imageCount: meaningfulImageCount,
      totalImageCount: allImgRefs.length,
      decorativeImageCount,
      missingAltCount,
      affectedPageCount,
      affectedImageCount,
      altCoverage: Number(altCoverage.toFixed(2)),
      missingAlt
    }
  });

  const modernImages = imageUrls.filter((src) => /\.(?:webp|avif)(?:[?#]|$)/i.test(src)).length;
  const modernRatio = imageUrls.length ? modernImages / imageUrls.length : 1;
  add(2, {
    passed: imageUrls.length === 0 || modernRatio >= 0.7,
    warning: modernRatio >= 0.5,
    evidence: { imageCount: imageUrls.length, modernImages, ratio: Number(modernRatio.toFixed(2)), note: "70%+ eligible meaningful raster images is the target." }
  });

  add(3, {
    skipped: true,
    evidence: { reason: "The true LCP image cannot be identified with 100% accuracy from static HTML alone.", preloadedImages }
  });

  const pictureWithWebpFallback = pictureRefs.filter((picture) => {
    const sources = picture.$(picture.el).find("source").toArray();
    return sources.some((source) => /image\/(?:webp|avif)/i.test(picture.$(source).attr("type") ?? "") || /\.(?:webp|avif)(?:[?#]|$)/i.test(picture.$(source).attr("srcset") ?? "")) && picture.$(picture.el).find("img").length > 0;
  }).length;
  add(4, {
    passed: pictureRefs.length === 0 || pictureWithWebpFallback === pictureRefs.length,
    skipped: pictureRefs.length === 0,
    evidence: { checkedPages: pageContexts.length, pictureCount: pictureRefs.length, pictureWithWebpFallback }
  });

  const unstableUrls = imgRefs.map((ref) => ({
    pageUrl: ref.pageUrl,
    imageUrl: absoluteUrl(new URL(ref.pageUrl), imageUrlFrom(ref.$, ref.el))
  })).filter((item) => {
    try {
      const parsed = new URL(item.imageUrl, "https://example.com");
      return [...parsed.searchParams.keys()].some((key) => /^(v|ver|version|cache|cachebuster|cb|t|time|timestamp|rand|random)$/i.test(key));
    } catch {
      return /[?&](v|ver|version|cache|cachebuster|cb|t|time|timestamp|rand|random)=/i.test(item.imageUrl);
    }
  });
  add(5, {
    passed: unstableUrls.length === 0,
    evidence: { imageCount: imageUrls.length, unstableUrls: unstableUrls.slice(0, 10) }
  });

  add(6, {
    passed: lazyCandidateRefs.length === 0 || lazyImages.length === lazyCandidateRefs.length,
    warning: lazyCandidateRefs.length > 0 && lazyImages.length / lazyCandidateRefs.length >= 0.5,
    evidence: { checkedPages: pageContexts.length, eligibleBelowFoldImages: lazyCandidateRefs.length, nativeLazyImages: lazyImages.length, jsOnlyLazyImages: jsLazySignals.length, missingNativeLazy: lazyCandidateRefs.length - lazyImages.length }
  });

  add(7, {
    passed: responsiveCandidateRefs.length === 0 || responsiveImages.length === responsiveCandidateRefs.length,
    warning: responsiveCandidateRefs.length > 0 && responsiveImages.length / responsiveCandidateRefs.length >= 0.5,
    evidence: { checkedPages: pageContexts.length, imageCount: responsiveCandidateRefs.length, responsiveImages: responsiveImages.length, ratio: responsiveCandidateRefs.length ? Number((responsiveImages.length / responsiveCandidateRefs.length).toFixed(2)) : 1 }
  });

  const firstPartyImageUrls = eligibleRasterRefs
    .map((ref) => ({ pageUrl: ref.pageUrl, imageUrl: absoluteUrl(new URL(ref.pageUrl), imageUrlFrom(ref.$, ref.el)) }))
    .filter((item) => firstPartyImage(item.pageUrl, item.imageUrl));
  const descriptiveCount = firstPartyImageUrls.filter((item) => isDescriptiveFileName(item.imageUrl)).length;
  const descriptiveRatio = firstPartyImageUrls.length ? descriptiveCount / firstPartyImageUrls.length : 1;
  const nonDescriptive = firstPartyImageUrls
    .filter((item) => !isDescriptiveFileName(item.imageUrl))
    .slice(0, 10);
  add(8, {
    passed: nonDescriptive.length === 0,
    warning: descriptiveRatio >= 0.6,
    evidence: { imageCount: firstPartyImageUrls.length, descriptiveCount, nonDescriptiveCount: firstPartyImageUrls.length - descriptiveCount, descriptiveRatio: Number(descriptiveRatio.toFixed(2)), nonDescriptive }
  });

  add(9, {
    skipped: true,
    evidence: { reason: "OCR text extraction is not available in this runtime; parity cannot be verified without guessing." }
  });
  add(10, {
    skipped: !hasAnyImageOnlyTextRisk,
    warning: hasAnyImageOnlyTextRisk,
    evidence: { reason: hasAnyImageOnlyTextRisk ? "Image alt text indicates possible data/chart/table content; OCR is required for exact verification." : "No image-only data signals found in static HTML." }
  });
  add(11, {
    skipped: true,
    evidence: { reason: "Visual overlap/blocking requires layout rendering and pixel inspection; static HTML cannot verify it exactly." }
  });

  const svgMissingTitleDesc = svgRefs.filter((ref) => ref.$(ref.el).find("title").length === 0 || ref.$(ref.el).find("desc").length === 0).length;
  add(12, {
    passed: svgRefs.length === 0 || svgMissingTitleDesc === 0,
    skipped: svgRefs.length === 0,
    evidence: { checkedPages: pageContexts.length, svgCount: svgRefs.length, svgMissingTitleDesc }
  });

  const meaningfulContentImageCount = pageContexts.reduce((total, page) => total + contentImages(page.$).length, 0);
  add(13, {
    passed: meaningfulContentImageCount === 0 || imageObjects.length > 0,
    skipped: meaningfulContentImageCount === 0,
    warning: meaningfulContentImageCount > 0 && imageObjects.length === 0,
    evidence: { meaningfulContentImages: meaningfulContentImageCount, imageObjectCount: imageObjects.length }
  });

  const crawlForAggregation = crawled?.pages.length ? crawled : null;
  const siteWideResults = crawlForAggregation ? results.map((check) => {
    if ([3, 9, 11].includes(check.id)) {
      const evidence = { scope: "homepage-only", pagesCrawled: crawlForAggregation.pages.length, pagesChecked: 1, pagesPassed: check.passed ? 1 : 0, pagesFailed: check.passed ? 0 : 1, passRate: check.passed ? 100 : 0, affectedPages: [], sampleEvidence: [check.evidence], reason: check.evidence.reason };
      return { ...check, evidence, recommendation: imageSeoRecommendation(check.name, check.severity, evidence) };
    }
    const evidence = aggregateImageCheck(crawlForAggregation, check.id);
    const outcome = outcomeForEvidence(evidence);
    const advisory = ADVISORY_CHECK_IDS.has(check.id);
    const severity = advisory ? check.severity : boundedSeverity(check.severity, outcome.severity);
    return {
      ...check,
      severity,
      passed: outcome.passed,
      skipped: outcome.skipped,
      warning: advisory && !outcome.passed && !outcome.skipped ? true : outcome.warning,
      informational: advisory && !outcome.passed && !outcome.skipped ? true : undefined,
      opportunity: advisory && !outcome.passed && !outcome.skipped ? advisoryOpportunity(check.name) : undefined,
      score: outcome.passed ? 1 : 0,
      evidence,
      recommendation: imageSeoRecommendation(check.name, severity, evidence)
    };
  }) : results.map((check) => ({ ...check, recommendation: imageSeoRecommendation(check.name, check.severity, check.evidence) }));
  const categories = summarize(siteWideResults);
  const score = scoreParameterOutcomes(siteWideResults);
  return { score, checkedAt: new Date().toISOString(), categories, checks: siteWideResults };
}
