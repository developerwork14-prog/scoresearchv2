import * as cheerio from "cheerio";
import {
  OnPageSeoAuditResult,
  OnPageSeoCategorySummary,
  OnPageSeoCheckResult,
  OnPageSeoSeverity,
  TechnicalCategoryStatus
} from "./types.js";
import { isLikelyDecorativeImage, suggestedAltFromPageContext } from "./image-alt-utils.js";
import type { CrawledPage, SiteCrawlResult } from "./site-crawler.js";
import { scoreParameterOutcomes, statusForParameterOutcomes } from "./audit-outcome.js";
import { aggregatePages, outcomeForEvidence } from "./site-audit-evidence.js";
import { onPageSeoRecommendation } from "./on-page-seo-recommendations.js";

interface CheckDefinition {
  id: number;
  category: string;
  name: string;
  weight: number;
  severity: OnPageSeoSeverity;
}

const CHECKS: CheckDefinition[] = [
  [1, "Headings & Titles", "Heading Hierarchy No Skips", 0, "Low"],
  [2, "Content Signals & Clarity", "Entity Bolding Quality", 0, "Low"],
  [3, "Structured Markup & Lists", "HTML Tables for Comparisons", 0, "Low"],
  [4, "Structured Markup & Lists", "Table Captions", 0, "Low"],
  [5, "Structured Markup & Lists", "<blockquote>+<cite> for Quotes", 0, "Low"],
  [6, "Content Signals & Clarity", "<dfn> for Key Term Definitions", 0, "Low"],
  [7, "Content Signals & Clarity", "<time datetime> on Dates", 0, "Low"],
  [8, "Headings & Titles", "Breadcrumb Schema-DOM Match", 2.17, "High"],
  [9, "Structured Markup & Lists", "See Also Semantic Paths", 0, "Low"],
  [10, "Internal Linking", "Contextual Internal Links", 0, "Low"],
  [11, "Image & Media Optimisation", "Alt Text Non-Empty", 2.72, "High"],
  [12, "Headings & Titles", "Heading Capitalization Consistent", 0, "Low"],
  [13, "Headings & Titles", "H1 Length 20-70 Characters", 0, "Low"],
  [14, "Headings & Titles", "Empty Heading Tags", 2.17, "Medium"]
].map(([id, category, name, weight, severity]) => ({ id, category, name, weight, severity })) as CheckDefinition[];

const CATEGORY_ORDER = [...new Set(CHECKS.map((check) => check.category))];
const ADVISORY_CHECK_IDS = new Set([1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 13]);

function advisoryOpportunity(name: string) {
  return `Optional improvement: apply ${name.toLowerCase()} only where it improves clarity, accessibility, or content extraction.`;
}

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

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isChallengeOrErrorHtml(html: string, status = 200) {
  if (status < 200 || status >= 300) return true;
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  if (!text) return true;
  const title = $("title").text().trim();
  const signalText = `${title} ${text.slice(0, 2500)}`;
  return /captcha|verify you are human|checking your browser|access denied|request blocked|security challenge|cloudflare ray id|temporarily unavailable|service unavailable/i.test(signalText);
}

function isAuditablePage(page: CrawledPage) {
  return !isChallengeOrErrorHtml(page.html, page.status);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/&nbsp;/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function compact(value: string) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function result(def: CheckDefinition, state: { passed?: boolean; skipped?: boolean; warning?: boolean; evidence?: Record<string, unknown> }): OnPageSeoCheckResult {
  const skipped = Boolean(state.skipped);
  const passed = skipped ? true : Boolean(state.passed);
  const warning = !skipped && !passed && Boolean(state.warning);
  const evidence = state.evidence ?? {};
  return {
    ...def,
    ...(ADVISORY_CHECK_IDS.has(def.id) && !passed && !skipped
      ? { informational: true, opportunity: advisoryOpportunity(def.name) }
      : {}),
    passed,
    skipped,
    warning,
    score: skipped ? 0 : passed ? 1 : 0,
    evidence,
    recommendation: onPageSeoRecommendation(def.name, def.severity, evidence)
  };
}

function summarize(checks: OnPageSeoCheckResult[]): OnPageSeoCategorySummary[] {
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

function primaryContent($: cheerio.CheerioAPI) {
  const source = $("main").first().length
    ? $("main").first()
    : $("[role='main']").first().length
      ? $("[role='main']").first()
      : $("#main,#content,.main-content,.page-content").first().length
        ? $("#main,#content,.main-content,.page-content").first()
        : $("article").first().length
          ? $("article").first()
          : $("body").first();
  const scoped = cheerio.load(source.toString());
  scoped("[aria-expanded='false'][aria-controls]").each((_, trigger) => {
    const controls = scoped(trigger).attr("aria-controls")?.trim().split(/\s+/).filter(Boolean) ?? [];
    controls.forEach((id) => scoped(`#${id.replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, "\\$1")}`).remove());
  });
  scoped(
    "footer,[role='contentinfo'],nav,[role='navigation'],aside,[role='complementary'],"
    + "[role='dialog'],[role='alertdialog'],dialog,[hidden],[inert],[aria-hidden='true'],"
    + "[style*='display:none' i],[style*='display: none' i],[style*='visibility:hidden' i],"
    + "[style*='visibility: hidden' i],details:not([open]),"
    + ".hidden,.modal,.sidebar,.accordion-collapse:not(.show),.collapse:not(.show)"
  ).remove();
  return scoped;
}

function headingAnalysis($: cheerio.CheerioAPI) {
  const scoped = primaryContent($);
  const allHeadingElements = scoped("h1,h2,h3,h4,h5,h6").toArray();
  const emptyHeadings = allHeadingElements
    .filter((el) => !scoped(el).text().replace(/\s+/g, " ").trim())
    .map((el) => ({
      level: el.tagName.toUpperCase(),
      html: scoped(el).toString()
    }));
  const headingElements = allHeadingElements.filter((el) => scoped(el).text().replace(/\s+/g, " ").trim());
  const levels = headingElements.map((el) => Number(el.tagName.slice(1)));
  const headingSequence = levels.map((level) => `H${level}`);
  const headingTexts = headingElements.map((el, index) => ({
    level: headingSequence[index],
    text: scoped(el).text().replace(/\s+/g, " ").trim()
  }));
  const skips: Array<{ from: number; to: number; index: number }> = [];
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index] - levels[index - 1] > 1) skips.push({ from: levels[index - 1], to: levels[index], index });
  }
  const problems = skips.map((skip) => `Skipped H${skip.from + 1} between H${skip.from} and H${skip.to}`);
  return {
    levels,
    headingSequence,
    headingTexts,
    headings: headingTexts.map((heading) => heading.text),
    emptyHeadings,
    skips,
    problems
  };
}

function headingCase(value: string) {
  const words = value.split(/\s+/).filter((word) => /[A-Za-z]/.test(word));
  if (!words.length) return "unknown";
  const titleWords = words.filter((word) => /^[A-Z][a-z0-9]+/.test(word)).length;
  const sentence = /^[A-Z]/.test(value.trim()) && words.slice(1).filter((word) => /^[a-z0-9]/.test(word)).length >= Math.max(1, words.length - 2);
  if (titleWords / words.length >= 0.65) return "title";
  if (sentence) return "sentence";
  if (value === value.toUpperCase() && /[A-Z]/.test(value)) return "upper";
  return "mixed";
}

function headingsByCase(headings: string[]) {
  return headings.reduce<Record<"titleCase" | "sentenceCase" | "allCaps" | "mixed", string[]>>((groups, heading) => {
    const style = headingCase(heading);
    if (style === "title") groups.titleCase.push(heading);
    else if (style === "sentence") groups.sentenceCase.push(heading);
    else if (style === "upper") groups.allCaps.push(heading);
    else if (style === "mixed") groups.mixed.push(heading);
    return groups;
  }, { titleCase: [], sentenceCase: [], allCaps: [], mixed: [] });
}

function parseJsonLd($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const flatten = (value: unknown): Record<string, unknown>[] => {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(flatten);
    const record = value as Record<string, unknown>;
    return [record, ...flatten(record["@graph"])];
  };
  return $("script[type='application/ld+json']").toArray().flatMap((el) => {
    try {
      return flatten(JSON.parse($(el).text()));
    } catch {
      return [];
    }
  });
}

function schemaTypes(record: Record<string, unknown>) {
  const type = record["@type"];
  return (Array.isArray(type) ? type : type ? [type] : []).map(String);
}

function breadcrumbSchemaNames(records: Record<string, unknown>[]) {
  const breadcrumb = records.find((record) => schemaTypes(record).some((type) => type === "BreadcrumbList"));
  const items = Array.isArray(breadcrumb?.itemListElement) ? breadcrumb.itemListElement : [];
  return items.map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const nested = record.item && typeof record.item === "object" ? record.item as Record<string, unknown> : {};
    return String(record.name ?? nested.name ?? "").trim();
  }).filter(Boolean);
}

function domBreadcrumbNames($: cheerio.CheerioAPI) {
  const selectors = [
    "nav[aria-label*='breadcrumb' i] a, nav[aria-label*='breadcrumb' i] span",
    "[class*='breadcrumb' i] a, [class*='breadcrumb' i] span",
    "[id*='breadcrumb' i] a, [id*='breadcrumb' i] span"
  ];
  return selectors.flatMap((selector) => $(selector).toArray().map((el) => $(el).text().replace(/\s+/g, " ").trim())).filter(Boolean);
}

function hasDefinitionPattern(text: string) {
  return /\b[A-Z][A-Za-z0-9 -]{2,}\s+(?:is|are|means|refers to|is defined as)\b/.test(text);
}

function hasComparisonIntent($: cheerio.CheerioAPI, body: string) {
  return $("table").length > 0 || /\b(compare|comparison|versus| vs\.? |features|pricing|plans|pros and cons)\b/i.test(body);
}

function isSeeAlsoLinkText(value: string) {
  return /\b(see also|related|learn more|next|recommended|further reading|resources)\b/i.test(value);
}

function absoluteUrl(root: URL, value: string) {
  try {
    return new URL(value, root).toString();
  } catch {
    return value || "";
  }
}

function evaluateOnPageCheck(page: CrawledPage, id: number) {
  const $ = page.$;
  const body = $("body").text().replace(/\s+/g, " ").trim();
  const totalWords = wordCount(body);
  const hierarchy = headingAnalysis($);
  const headings = hierarchy.headings;
  const boldPhrases = $("strong,b").toArray().map((el) => $(el).text().replace(/\s+/g, " ").trim()).filter(Boolean);
  const boldWords = boldPhrases.reduce((sum, phrase) => sum + wordCount(phrase), 0);
  const boldDensity = totalWords ? (boldWords / totalWords) * 100 : 0;
  const maxBoldDensity = totalWords < 250 ? 15 : 8;
  const qualityBold = boldPhrases.filter((phrase) => {
    const words = phrase.split(/\s+/).filter(Boolean);
    return words.length <= 6 && (/[A-Z][a-z]+/.test(phrase) || /\b[A-Z]{2,}\b/.test(phrase) || /\b(?:service|product|platform|brand|company|software|audit|seo|ai)\b/i.test(phrase));
  }).length;
  const tables = $("table").toArray();
  const comparisonTables = tables.filter((table) => /\b(compare|comparison|feature|price|plan|versus|vs|pros|cons)\b/i.test($(table).text()));
  const records = parseJsonLd($);
  const schemaBreadcrumbs = breadcrumbSchemaNames(records);
  const domBreadcrumbs = domBreadcrumbNames($);
  const paragraphLinks = $("main p a[href],article p a[href],body p a[href]").toArray().filter((el) => {
    try {
      return new URL($(el).attr("href") ?? "", page.finalUrl).hostname.replace(/^www\./, "") === new URL(page.finalUrl).hostname.replace(/^www\./, "");
    } catch {
      return false;
    }
  });
  const allImages = $("img").toArray();
  const meaningfulImages = allImages.filter((img) => !isLikelyDecorativeImage($, img));
  const missingAlt = meaningfulImages.filter((img) => !($(img).attr("alt") ?? "").trim());
  const headingCases = headings.map(headingCase).filter((item) => item !== "unknown");
  const capitalizationConflicts = headingsByCase(headings);
  const dominantCase = headingCases.reduce((best, current) => headingCases.filter((item) => item === current).length > headingCases.filter((item) => item === best).length ? current : best, headingCases[0] ?? "unknown");
  const dateTextCount = (body.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) ?? []).length;
  const blockquotes = $("blockquote").toArray();
  const applicable = (() => {
    if (id === 4) return tables.length > 0;
    if (id === 5) return blockquotes.length > 0 || /[“”"']/.test(body);
    if (id === 6) return hasDefinitionPattern(body);
    if (id === 8) return schemaBreadcrumbs.length > 0 || domBreadcrumbs.length > 0;
    if (id === 9) return totalWords >= 300;
    return true;
  })();
  if (!applicable) return { applicable: false, passed: true };

  switch (id) {
    case 1: return {
      applicable,
      passed: hierarchy.skips.length === 0,
      evidence: {
        url: page.finalUrl,
        headingSequence: hierarchy.headingSequence,
        headings: hierarchy.headingTexts,
        problem: hierarchy.problems.join("; ") || (hierarchy.levels.length ? "No skipped heading levels detected" : "No headings extracted")
      }
    };
    case 2: return { applicable, passed: boldPhrases.length === 0 || (boldDensity <= maxBoldDensity && (qualityBold / Math.max(boldPhrases.length, 1)) >= 0.6), evidence: { boldDensity: Number(boldDensity.toFixed(2)), boldPhrases: boldPhrases.length } };
    case 3: return { applicable, passed: !hasComparisonIntent($, body) || comparisonTables.length > 0, evidence: { comparisonIntent: hasComparisonIntent($, body), tables: tables.length } };
    case 4: return { applicable, passed: tables.every((table) => $(table).find("caption").first().text().trim().length > 0), evidence: { tables: tables.length, captions: $("table caption").length } };
    case 5: return { applicable, passed: blockquotes.length > 0 && blockquotes.every((quote) => $(quote).find("cite").length > 0 || $(quote).next("cite").length > 0), evidence: { blockquotes: blockquotes.length } };
    case 6: return { applicable, passed: $("dfn").filter((_, el) => $(el).text().trim().length > 0).length > 0, evidence: { definitions: $("dfn").length } };
    case 7: return { applicable, passed: dateTextCount === 0 || $("time[datetime]").length >= Math.ceil(dateTextCount * 0.5), evidence: { dateTextCount, timeDatetimeCount: $("time[datetime]").length } };
    case 8: {
      const normalizedSchema = schemaBreadcrumbs.map(compact);
      const normalizedDom = domBreadcrumbs.map(compact);
      const exactMatch = normalizedSchema.length === normalizedDom.length
        && normalizedSchema.every((name, index) => name === normalizedDom[index]);
      const breadcrumbIssue = domBreadcrumbs.length === 0
        ? "Visible Breadcrumb Missing"
        : "Breadcrumb Schema-DOM Mismatch";
      return {
        applicable,
        passed: domBreadcrumbs.length > 0 && schemaBreadcrumbs.length > 0 && exactMatch,
        evidence: {
          url: page.finalUrl,
          issue: breadcrumbIssue,
          visibleBreadcrumb: domBreadcrumbs,
          schemaBreadcrumb: schemaBreadcrumbs
        }
      };
    }
    case 9: return { applicable, passed: $("a[href]").toArray().some((link) => isSeeAlsoLinkText($(link).text()) || isSeeAlsoLinkText($(link).parent().text())), evidence: { totalWords } };
    case 10: return { applicable, passed: totalWords < 300 ? paragraphLinks.length >= 1 : paragraphLinks.length >= 2, evidence: { contextualInternalLinks: paragraphLinks.length } };
    case 11: return {
      applicable,
      passed: missingAlt.length === 0,
      issueCount: missingAlt.length,
      evidence: {
        meaningfulImages: meaningfulImages.length,
        missingAlt: missingAlt.length,
        missingAltImages: missingAlt.map((img) => {
          const suggestedAlt = suggestedAltFromPageContext($, img);
          return {
            pageUrl: page.finalUrl,
            imageUrl: absoluteUrl(new URL(page.finalUrl), $(img).attr("src") || $(img).attr("data-src") || ""),
            alt: $(img).attr("alt") ?? "",
            issue: $(img).attr("alt") === undefined ? "Missing alt attribute" : "Empty alt text",
            ...(suggestedAlt ? { suggestedAlt } : {})
          };
        }).slice(0, 10)
      }
    };
    case 12: return {
      applicable,
      passed: headingCases.length <= 1 || headingCases.filter((item) => item === dominantCase).length / headingCases.length >= 0.8,
      evidence: {
        url: page.finalUrl,
        ...capitalizationConflicts,
        dominantCase
      }
    };
    case 13: {
      const h1 = hierarchy.headingTexts.find((heading) => heading.level === "H1")?.text ?? "";
      return {
        applicable,
        passed: h1.length >= 20 && h1.length <= 70,
        evidence: {
          url: page.finalUrl,
          h1,
          length: h1.length,
          h1Count: hierarchy.headingTexts.filter((heading) => heading.level === "H1").length,
          recommendedRange: "20-70"
        }
      };
    }
    case 14: return {
      applicable,
      passed: hierarchy.emptyHeadings.length === 0,
      issueCount: hierarchy.emptyHeadings.length,
      evidence: {
        url: page.finalUrl,
        emptyHeadingCount: hierarchy.emptyHeadings.length,
        emptyHeadings: hierarchy.emptyHeadings
      }
    };
    default: return { applicable, passed: true };
  }
}

export async function runOnPageSeoAudit(inputUrl: string, html?: string, siteCrawl?: SiteCrawlResult): Promise<OnPageSeoAuditResult> {
  const normalized = normalizeUrl(inputUrl);
  const url = new URL(normalized);
  const pageHtml = html ?? await fetchHtml(normalized);
  const auditablePages = siteCrawl?.pages.filter(isAuditablePage) ?? [];
  if (!auditablePages.length && isChallengeOrErrorHtml(pageHtml)) {
    return {
      score: 100,
      checkedAt: new Date().toISOString(),
      categories: [],
      checks: []
    };
  }
  const $ = cheerio.load(pageHtml);
  const body = $("body").text().replace(/\s+/g, " ").trim();
  const hierarchy = headingAnalysis($);
  const headings = hierarchy.headings;
  const h1Text = hierarchy.headingTexts.find((heading) => heading.level === "H1")?.text ?? "";
  const boldPhrases = $("strong,b").toArray().map((el) => $(el).text().replace(/\s+/g, " ").trim()).filter(Boolean);
  const totalWords = wordCount(body);
  const boldWords = boldPhrases.reduce((sum, phrase) => sum + wordCount(phrase), 0);
  const boldDensity = totalWords ? (boldWords / totalWords) * 100 : 0;
  const maxBoldDensity = totalWords < 250 ? 15 : 8;
  const qualityBold = boldPhrases.filter((phrase) => {
    const words = phrase.split(/\s+/).filter(Boolean);
    return words.length <= 6 && (/[A-Z][a-z]+/.test(phrase) || /\b[A-Z]{2,}\b/.test(phrase) || /\b(?:service|product|platform|brand|company|software|audit|seo|ai)\b/i.test(phrase));
  }).length;
  const boldQualityRatio = boldPhrases.length ? qualityBold / boldPhrases.length : 0;
  const tables = $("table").toArray();
  const comparisonTables = tables.filter((table) => /\b(compare|comparison|feature|price|plan|versus|vs|pros|cons)\b/i.test($(table).text()));
  const blockquotes = $("blockquote").toArray();
  const blockquotesWithCite = blockquotes.filter((quote) => $(quote).find("cite").length > 0 || $(quote).next("cite").length > 0);
  const dfnCount = $("dfn").filter((_, el) => $(el).text().trim().length > 0).length;
  const dateTextCount = (body.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) ?? []).length;
  const timeDatetimeCount = $("time[datetime]").filter((_, el) => Boolean($(el).attr("datetime")?.trim())).length;
  const records = parseJsonLd($);
  const schemaBreadcrumbs = breadcrumbSchemaNames(records);
  const domBreadcrumbs = domBreadcrumbNames($);
  const seeAlsoLinks = $("section,article,main,aside,footer").toArray().flatMap((section) =>
    $(section).find("a[href]").toArray().filter((link) => isSeeAlsoLinkText($(link).text()) || isSeeAlsoLinkText($(link).parent().text()))
  );
  const paragraphLinks = $("main p a[href],article p a[href],body p a[href]").toArray().map((el) => {
    try {
      return new URL($(el).attr("href") ?? "", url).toString();
    } catch {
      return "";
    }
  }).filter((href) => {
    try {
      if (!href) return false;
      const parsed = new URL(href);
      return parsed.hostname.replace(/^www\./, "") === url.hostname.replace(/^www\./, "");
    } catch {
      return false;
    }
  });
  const allImages = $("img").toArray();
  const images = allImages.filter((img) => !isLikelyDecorativeImage($, img));
  const imagesMissingAlt = images.filter((img) => !($(img).attr("alt") ?? "").trim());
  const headingCases = headings.map(headingCase).filter((item) => item !== "unknown");
  const capitalizationConflicts = headingsByCase(headings);
  const dominantCase = headingCases.reduce((best, current) => headingCases.filter((item) => item === current).length > headingCases.filter((item) => item === best).length ? current : best, headingCases[0] ?? "unknown");
  const caseConsistency = headingCases.length ? headingCases.filter((item) => item === dominantCase).length / headingCases.length : 1;
  const checks: OnPageSeoCheckResult[] = [];
  const add = (id: number, state: Parameters<typeof result>[1]) => {
    const def = CHECKS.find((check) => check.id === id);
    if (def) checks.push(result(def, { ...state, evidence: { pageUrl: normalized, ...(state.evidence ?? {}) } }));
  };
  const missingAltImages = imagesMissingAlt.map((img) => {
    const suggestedAlt = suggestedAltFromPageContext($, img);
    return {
      pageUrl: normalized,
      imageUrl: absoluteUrl(url, $(img).attr("src") || $(img).attr("data-src") || ""),
      alt: $(img).attr("alt") ?? "",
      issue: $(img).attr("alt") === undefined ? "Missing alt attribute" : "Empty alt text",
      ...(suggestedAlt ? { suggestedAlt } : {})
    };
  }).slice(0, 10);

  add(1, {
    passed: hierarchy.skips.length === 0,
    evidence: {
      url: normalized,
      headingSequence: hierarchy.headingSequence,
      headings: hierarchy.headingTexts,
      problem: hierarchy.problems.join("; ") || (hierarchy.levels.length ? "No skipped heading levels detected" : "No headings extracted")
    }
  });
  add(2, {
    passed: boldPhrases.length === 0 || (boldDensity <= maxBoldDensity && boldQualityRatio >= 0.6),
    warning: boldPhrases.length > 0 && (boldDensity > maxBoldDensity || boldQualityRatio < 0.6),
    evidence: { boldPhrases: boldPhrases.length, boldDensity: Number(boldDensity.toFixed(2)), maxBoldDensity, qualityRatio: Number(boldQualityRatio.toFixed(2)), sample: boldPhrases.slice(0, 8) }
  });
  add(3, {
    passed: !hasComparisonIntent($, body) || comparisonTables.length > 0,
    warning: hasComparisonIntent($, body) && tables.length === 0,
    evidence: { comparisonIntent: hasComparisonIntent($, body), tables: tables.length, comparisonTables: comparisonTables.length }
  });
  add(4, {
    passed: tables.length > 0 && tables.every((table) => $(table).find("caption").first().text().trim().length > 0),
    skipped: tables.length === 0,
    evidence: { tables: tables.length, captions: $("table caption").length }
  });
  add(5, {
    passed: blockquotes.length > 0 && blockquotesWithCite.length === blockquotes.length,
    skipped: blockquotes.length === 0 && !/[“”"']/.test(body),
    evidence: { blockquotes: blockquotes.length, blockquotesWithCite: blockquotesWithCite.length }
  });
  add(6, {
    passed: dfnCount > 0,
    skipped: !hasDefinitionPattern(body),
    evidence: { dfnCount, definitionPatternDetected: hasDefinitionPattern(body) }
  });
  add(7, {
    passed: dateTextCount === 0 || timeDatetimeCount >= Math.ceil(dateTextCount * 0.5),
    warning: dateTextCount > 0 && timeDatetimeCount > 0 && timeDatetimeCount < dateTextCount,
    evidence: { dateTextCount, timeDatetimeCount }
  });
  add(8, {
    passed: domBreadcrumbs.length > 0
      && schemaBreadcrumbs.length > 0
      && schemaBreadcrumbs.map(compact).length === domBreadcrumbs.map(compact).length
      && schemaBreadcrumbs.map(compact).every((name, index) => name === domBreadcrumbs.map(compact)[index]),
    skipped: schemaBreadcrumbs.length === 0 && domBreadcrumbs.length === 0,
    evidence: {
      url: normalized,
      issue: domBreadcrumbs.length === 0 ? "Visible Breadcrumb Missing" : "Breadcrumb Schema-DOM Mismatch",
      visibleBreadcrumb: domBreadcrumbs,
      schemaBreadcrumb: schemaBreadcrumbs
    }
  });
  add(9, {
    passed: seeAlsoLinks.length > 0,
    skipped: totalWords < 300,
    warning: seeAlsoLinks.length === 0 && $("a[href]").length > 0,
    evidence: { seeAlsoLinks: seeAlsoLinks.length }
  });
  add(10, {
    passed: totalWords < 300 ? paragraphLinks.length >= 1 : paragraphLinks.length >= 2,
    warning: totalWords >= 300 && paragraphLinks.length === 1,
    evidence: { contextualInternalLinks: paragraphLinks.length, sampleUrls: paragraphLinks.slice(0, 8) }
  });
  add(11, {
    passed: images.length === 0 || imagesMissingAlt.length === 0,
    evidence: { images: images.length, totalImages: allImages.length, decorativeImagesIgnored: allImages.length - images.length, missingAlt: imagesMissingAlt.length, missingAltImages }
  });
  add(12, {
    passed: headingCases.length <= 1 || caseConsistency >= 0.8,
    evidence: {
      url: normalized,
      ...capitalizationConflicts,
      dominantCase,
      consistency: Number(caseConsistency.toFixed(2))
    }
  });
  add(13, {
    passed: h1Text.length >= 20 && h1Text.length <= 70,
    warning: h1Text.length >= 10 && h1Text.length <= 90,
    evidence: {
      url: normalized,
      h1: h1Text,
      length: h1Text.length,
      h1Count: hierarchy.headingTexts.filter((heading) => heading.level === "H1").length,
      recommendedRange: "20-70"
    }
  });
  add(14, {
    passed: hierarchy.emptyHeadings.length === 0,
    evidence: {
      url: normalized,
      emptyHeadingCount: hierarchy.emptyHeadings.length,
      emptyHeadings: hierarchy.emptyHeadings
    }
  });

  const siteWideChecks = auditablePages.length ? checks.map((check) => {
    const applicablePages = auditablePages.filter((page) => evaluateOnPageCheck(page, check.id).applicable);
    if (!applicablePages.length) return { ...check, passed: true, skipped: true, warning: false, score: 0, evidence: { scope: "page-level-site-wide", pagesCrawled: auditablePages.length, pagesChecked: 0, pagesPassed: 0, pagesFailed: 0, passRate: 100, affectedPages: [], sampleEvidence: [] } };
    const evidence = aggregatePages({ pages: applicablePages }, (page) => evaluateOnPageCheck(page, check.id));
    evidence.pagesCrawled = auditablePages.length;
    const outcome = outcomeForEvidence(evidence);
    const advisory = ADVISORY_CHECK_IDS.has(check.id);
    const severity: OnPageSeoSeverity = advisory ? check.severity : outcome.severity;
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
      recommendation: onPageSeoRecommendation(check.name, severity, evidence)
    };
  }) : checks;
  const categories = summarize(siteWideChecks);
  const score = scoreParameterOutcomes(siteWideChecks);
  return { score, checkedAt: new Date().toISOString(), categories, checks: siteWideChecks };
}
