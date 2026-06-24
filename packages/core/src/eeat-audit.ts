import * as cheerio from "cheerio";
import { scoreParameterOutcomes, statusForParameterOutcomes } from "./audit-outcome.js";
import { EeatAuditResult, EeatCategorySummary, EeatCheckResult, EeatSeverity, TechnicalCategoryStatus } from "./types.js";

interface CheckDefinition {
  id: number;
  category: string;
  name: string;
  weight: number;
  severity: EeatSeverity;
}

const CHECKS: CheckDefinition[] = [
  [1, "Author & Expertise", "Author Byline on Every Article", 3.55, "Critical"],
  [2, "Author & Expertise", "Byline Hyperlinked to Bio", 2.65, "High"],
  [3, "Author & Expertise", "Author Bio Page Exists", 3.17, "Critical"],
  [4, "Author & Expertise", "Bio Page >=150 Words", 2.12, "High"],
  [5, "Author & Expertise", "LinkedIn Linked from Bio", 2.65, "High"],
  [6, "Author & Expertise", "Author Content Volume >=3", 2.12, "Medium"],
  [7, "Editorial Standards", "Editorial Policy Page", 2.65, "High"],
  [8, "Trust & Transparency", "Contact Page Physical Address", 2.65, "Critical"],
  [9, "Trust & Transparency", "Contact Page Phone Number", 2.12, "High"],
  [10, "Trust & Transparency", "Contact Page Company Email", 2.12, "High"],
  [11, "Trust & Transparency", "Contact Form Functional", 2.12, "High"],
  [12, "Trust & Transparency", "Privacy Policy Substantive", 2.12, "Medium"],
  [13, "Trust & Transparency", "Terms of Service", 1.59, "Medium"],
  [14, "Trust Signals & Reviews", "Client Logo Section", 1.59, "Medium"],
  [15, "Trust & Transparency", "About Page >=300w Depth", 2.65, "High"],
  [16, "Citations & Evidence", "Outbound .edu/.gov Links", 2.65, "High"],
  [17, "Citations & Evidence", "Inline Source Citations", 2.65, "High"],
  [18, "Citations & Evidence", "Verifiable Claim Ratio", 2.65, "High"],
  [19, "Citations & Evidence", "Case Studies with Metrics", 2.65, "High"],
  [20, "Trust & Transparency", "Team Page Complete", 2.12, "High"],
  [21, "Author & Expertise", "Author Experience Quantified", 2.12, "Medium"]
].map(([id, category, name, weight, severity]) => ({ id, category, name, weight, severity })) as CheckDefinition[];

const CATEGORY_ORDER = [...new Set(CHECKS.map((check) => check.category))];

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeUrl(value: string) {
  return value.startsWith("http") ? value : `https://${value}`;
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function fetchHtml(url: string) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "AIVisibilityAnalyzer/1.0" }
    });
    return response.ok ? { url: response.url, html: await response.text(), status: response.status } : null;
  } catch {
    return null;
  }
}

function absolute(base: URL, href: string) {
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

function sameOrigin(base: URL, href: string) {
  try {
    return new URL(href).hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

function findLink($: cheerio.CheerioAPI, base: URL, pattern: RegExp, sameSiteOnly = true) {
  return $("a[href]").toArray()
    .map((el) => ({ href: absolute(base, $(el).attr("href") ?? ""), text: $(el).text().replace(/\s+/g, " ").trim() }))
    .find((link) => link.href && (!sameSiteOnly || sameOrigin(base, link.href)) && (pattern.test(link.href) || pattern.test(link.text)));
}

function result(def: CheckDefinition, state: {
  passed?: boolean;
  skipped?: boolean;
  notApplicable?: boolean;
  warning?: boolean;
  priorityScore?: number;
  recommendation?: string;
  evidence?: Record<string, unknown>;
}): EeatCheckResult {
  const skipped = Boolean(state.skipped);
  const passed = skipped ? true : Boolean(state.passed);
  const warning = !skipped && !passed && Boolean(state.warning);
  return {
    ...def,
    passed,
    skipped,
    ...(state.notApplicable ? { notApplicable: true } : {}),
    warning,
    ...(state.priorityScore !== undefined ? { priorityScore: state.priorityScore } : {}),
    ...(state.recommendation ? { recommendation: state.recommendation } : {}),
    score: skipped ? 0 : passed ? 1 : 0,
    evidence: state.evidence ?? {}
  };
}

function pageEvidence(url: string, failed: boolean, details: Record<string, unknown> = {}) {
  return {
    pagesCrawled: 1,
    pagesChecked: 1,
    pagesFailed: failed ? 1 : 0,
    affectedPages: failed ? [{ url, issueCount: 1 }] : [],
    ...details
  };
}

function skippedEvidence(reason: string, details: Record<string, unknown> = {}) {
  return { reason, ...details };
}

function actualArticlePage(html: string, pageUrl: string) {
  if (!html) return false;
  const page$ = cheerio.load(html);
  const path = new URL(pageUrl).pathname.replace(/\/+$/, "");
  return /\/(?:blogs?|articles?|news|insights?|guides?)\/[^/]+$/i.test(path)
    || (page$("article h1").length > 0 && wordCount(page$("article").text()) >= 150);
}

function summarize(checks: EeatCheckResult[]): EeatCategorySummary[] {
  return CATEGORY_ORDER.map((categoryName) => {
    const categoryChecks = checks.filter((check) => check.category === categoryName);
    const scorable = categoryChecks.filter((check) => !check.skipped);
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

function hasByline($: cheerio.CheerioAPI) {
  return $('[rel="author"],.author,.byline,[class*="author" i],[class*="byline" i]').length > 0 || /\b(by|written by|reviewed by)\s+[A-Z][a-z]+/i.test($("body").text());
}

function bylineBioLink($: cheerio.CheerioAPI, base: URL) {
  return $("a[href]").toArray()
    .map((el) => {
      const node = $(el);
      const href = absolute(base, node.attr("href") ?? "");
      const explicitAuthorLink = /\bauthor\b/i.test(node.attr("rel") ?? "")
        || node.closest("[class*='author' i],[class*='byline' i],[itemprop='author']").length > 0;
      let profilePath = false;
      let validTarget = false;
      try {
        const parsed = new URL(href);
        validTarget = !parsed.hash && !/\/comments?(?:\/|$)/i.test(parsed.pathname);
        profilePath = /\/(?:author|authors|team|people|leadership|bio|profile)(?:\/|$)/i.test(parsed.pathname)
          && !parsed.hash;
      } catch {
        profilePath = false;
      }
      return { href, explicitAuthorLink, profilePath, validTarget };
    })
    .find((link) => link.href && link.validTarget && sameOrigin(base, link.href) && (link.explicitAuthorLink || link.profilePath));
}

function phoneFound(text: string) {
  return (text.match(/\+?\d[\d\s().-]{7,}\d/g) ?? []).some((candidate) => {
    const normalized = candidate.replace(/\D+/g, "");
    if (/\b\d+(?:\.\d+){2,}\b/.test(candidate)) return false;
    if (/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/.test(candidate)) return false;
    if (/^1800\d{6,7}$/.test(normalized)) return true;
    if (/^91[6-9]\d{9}$/.test(normalized)) return true;
    if (/^[6-9]\d{9}$/.test(normalized)) return true;
    if (/^0\d{9,11}$/.test(normalized)) return true;
    return /^[1-9]\d{9,10}$/.test(normalized);
  });
}

function emailFound(text: string) {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
}

function addressFound(text: string) {
  return /\b(street|st\.|road|rd\.|avenue|ave\.|lane|ln\.|suite|floor|building|city|state|zip|postal|india|usa|uk)\b/i.test(text) && /\d{2,}/.test(text);
}

function localTrustApplicable(text: string) {
  return /\b(near me|visit us|clinic|store|restaurant|service area|directions|opening hours|book an appointment|our location)\b/i.test(text)
    && addressFound(text);
}

function authoritativeOutboundLinks(links: string[]) {
  return links.filter((href) => {
    try {
      const host = new URL(href).hostname;
      return /\.(?:edu|gov)(?:\.|$)/i.test(host) || /\b(?:wikipedia|wikidata|who\.int|nih\.gov|cdc\.gov|researchgate|pubmed|schema\.org)\b/i.test(host);
    } catch {
      return false;
    }
  });
}

export async function runEeatAudit(inputUrl: string, html?: string): Promise<EeatAuditResult> {
  const normalized = normalizeUrl(inputUrl);
  const base = new URL(normalized);
  const fetchedHomepage = html === undefined ? await fetchHtml(normalized) : null;
  const homepage = html ?? fetchedHomepage?.html ?? "";
  const $ = cheerio.load(homepage);
  const links = {
    about: findLink($, base, /about/i),
    contact: findLink($, base, /contact|get in touch/i),
    privacy: findLink($, base, /privacy/i, false),
    terms: findLink($, base, /terms|conditions|tos/i, false),
    team: findLink($, base, /team|people|leadership|authors/i),
    editorial: findLink($, base, /editorial|fact.check|review.policy|correction/i),
    caseStudy: findLink($, base, /case.stud|results|customer.story|success.story/i),
    article: findLink($, base, /blog|article|insight|news|guide/i)
  };
  const fetched = await Promise.all(Object.entries(links).map(async ([key, link]) => ({
    key,
    href: link?.href ?? "",
    page: link?.href ? await fetchHtml(link.href) : null
  })));
  const pageFor = (key: string) => fetched.find((item) => item.key === key)?.page?.html ?? "";
  const fetchedUrlFor = (key: string) => fetched.find((item) => item.key === key)?.page?.url ?? "";
  let articleHtml = pageFor("article");
  let articleUrl = fetchedUrlFor("article") || links.article?.href || normalized;
  if (articleHtml && !actualArticlePage(articleHtml, articleUrl)) {
    const listing$ = cheerio.load(articleHtml);
    const detailLink = listing$("a[href]").toArray()
      .map((element) => absolute(new URL(articleUrl), listing$(element).attr("href") ?? ""))
      .find((href) => href && sameOrigin(base, href) && /\/(?:blogs?|articles?|news|insights?|guides?)\/[^/]+\/?$/i.test(new URL(href).pathname));
    if (detailLink) {
      const detailPage = await fetchHtml(detailLink);
      if (detailPage?.html && actualArticlePage(detailPage.html, detailPage.url)) {
        articleHtml = detailPage.html;
        articleUrl = detailPage.url;
      }
    }
  }
  const article$ = cheerio.load(articleHtml || homepage);
  const articleApplicable = actualArticlePage(articleHtml, articleUrl) || actualArticlePage(homepage, normalized);
  const bioLink = bylineBioLink(article$, base) || bylineBioLink($, base);
  const bioPage = bioLink?.href ? await fetchHtml(bioLink.href) : null;
  const bio$ = cheerio.load(bioPage?.html ?? "");
  const bioText = bio$("body").text().replace(/\s+/g, " ").trim();
  const contact$ = cheerio.load(pageFor("contact"));
  const contactText = contact$("body").text().replace(/\s+/g, " ").trim();
  const aboutText = cheerio.load(pageFor("about"))("body").text().replace(/\s+/g, " ").trim();
  const privacyText = cheerio.load(pageFor("privacy"))("body").text().replace(/\s+/g, " ").trim();
  const termsText = cheerio.load(pageFor("terms"))("body").text().replace(/\s+/g, " ").trim();
  const team$ = cheerio.load(pageFor("team"));
  const teamText = team$("body").text().replace(/\s+/g, " ").trim();
  const caseText = cheerio.load(pageFor("caseStudy"))("body").text().replace(/\s+/g, " ").trim();
  const evidencePage$ = articleApplicable ? article$ : $;
  const outboundLinks = evidencePage$("a[href]").toArray()
    .map((el) => absolute(new URL(articleApplicable ? articleUrl : normalized), evidencePage$(el).attr("href") ?? ""))
    .filter((href) => href && !sameOrigin(base, href));
  const authorityLinks = authoritativeOutboundLinks(outboundLinks);
  const sourceCitations = evidencePage$("article a[href],main a[href],cite,blockquote,sup a[href]").toArray()
    .filter((element) => {
      const href = evidencePage$(element).attr("href");
      return !href || !sameOrigin(base, absolute(new URL(articleApplicable ? articleUrl : normalized), href));
    }).length;
  const localIntent = localTrustApplicable(homepage + " " + contactText);
  const hasContactLink = Boolean(links.contact || contactText);
  const results: EeatCheckResult[] = [];
  const add = (id: number, state: Parameters<typeof result>[1]) => {
    const def = CHECKS.find((check) => check.id === id);
    if (def) results.push(result(def, state));
  };

  add(1, {
    passed: articleApplicable && hasByline(article$),
    skipped: !articleApplicable,
    notApplicable: !articleApplicable,
    evidence: !articleApplicable
      ? skippedEvidence("Author bylines are checked only on actual article or blog-detail pages")
      : pageEvidence(articleUrl, !hasByline(article$), { articleDetected: true }),
    recommendation: "Add a visible author or reviewer byline to the affected article page."
  });
  add(2, {
    passed: articleApplicable && Boolean(bioLink),
    skipped: !articleApplicable || !bioLink,
    notApplicable: !articleApplicable,
    evidence: !articleApplicable
      ? skippedEvidence("Byline links are checked only on actual article or blog-detail pages")
      : !bioLink
        ? skippedEvidence("Optional author-profile reinforcement: no verified bio link was detected")
        : pageEvidence(articleUrl, false, { bioLink: bioLink.href })
  });
  add(3, {
    passed: Boolean(bioPage?.html),
    skipped: !bioLink,
    notApplicable: !articleApplicable,
    evidence: !bioLink
      ? skippedEvidence("Author bio-page checks require a detected byline profile link")
      : pageEvidence(articleUrl, !bioPage?.html, { bioUrl: bioLink.href, status: bioPage?.status ?? 0 }),
    recommendation: "Repair the affected author-profile link so it opens a public bio page."
  });
  add(4, {
    passed: wordCount(bioText) >= 150,
    skipped: !bioPage?.html,
    notApplicable: !articleApplicable,
    warning: Boolean(bioPage?.html) && wordCount(bioText) < 150,
    priorityScore: 15,
    evidence: !bioPage?.html
      ? skippedEvidence("Bio depth is checked only when a public author bio page exists")
      : pageEvidence(bioPage.url, wordCount(bioText) < 150, { words: wordCount(bioText) }),
    recommendation: "Expand the author bio only with accurate qualifications, role, and relevant experience."
  });
  add(5, { passed: true, skipped: !bioPage?.html || bio$("a[href*='linkedin.com']").length === 0, notApplicable: !articleApplicable, evidence: skippedEvidence("LinkedIn is optional; add it only when a verified author profile exists", { linkedinLinks: bio$("a[href*='linkedin.com']").length }) });
  add(6, { passed: true, skipped: !bioPage?.html || bio$("a[href*='/blog'],a[href*='/article'],a[href*='/news'],a[href*='/insight']").length < 3, notApplicable: !articleApplicable, evidence: skippedEvidence("Author content-volume links are optional and require a public author archive") });
  add(21, { passed: true, skipped: !bioPage?.html || !/\b\d+\+?\s+(years?|yrs?)\b|\b(since|experience)\s+\d{4}\b/i.test(bioText), notApplicable: !articleApplicable, evidence: skippedEvidence("Quantified experience is optional and should be added only when accurate") });

  add(7, {
    passed: Boolean(pageFor("editorial")) && wordCount(cheerio.load(pageFor("editorial"))("body").text()) >= 100,
    skipped: !articleApplicable || !pageFor("editorial"),
    notApplicable: !articleApplicable,
    evidence: !articleApplicable
      ? skippedEvidence("Editorial-policy checks apply only to article-led publishers")
      : skippedEvidence("Editorial policy is an optional publisher trust signal")
  });
  add(8, { passed: addressFound(contactText), skipped: !localIntent, warning: localIntent && hasContactLink, evidence: { contactUrl: links.contact?.href ?? "", localIntent } });
  add(9, { passed: phoneFound(contactText), skipped: !localIntent && emailFound(contactText), warning: hasContactLink, evidence: { contactUrl: links.contact?.href ?? "", localIntent } });
  add(10, {
    passed: emailFound(contactText),
    skipped: !hasContactLink || (!emailFound(contactText) && phoneFound(contactText)),
    warning: hasContactLink && !emailFound(contactText) && !phoneFound(contactText),
    priorityScore: 15,
    evidence: !hasContactLink
      ? skippedEvidence("No contact page was available for company-email analysis")
      : !emailFound(contactText) && phoneFound(contactText)
        ? skippedEvidence("A company email is optional when a working phone or contact channel is provided")
        : pageEvidence(links.contact?.href ?? normalized, !emailFound(contactText))
  });
  add(11, { skipped: true, evidence: { reason: "Form functionality cannot be verified with 100% accuracy without submitting a form." } });
  add(12, {
    passed: wordCount(privacyText) >= 120,
    skipped: !links.privacy || !pageFor("privacy"),
    evidence: !links.privacy
      ? pageEvidence(normalized, true, { reason: "No privacy-policy link was detected" })
      : !pageFor("privacy")
        ? skippedEvidence("Privacy-policy page could not be retrieved for substantive-content verification", { privacyUrl: links.privacy.href })
        : pageEvidence(links.privacy.href, wordCount(privacyText) < 120, { words: wordCount(privacyText) }),
    recommendation: "Publish or repair a readable privacy policy describing data collection, use, retention, and contact rights."
  });
  add(13, {
    passed: Boolean(pageFor("terms")) && wordCount(termsText) >= 100,
    skipped: !links.terms || !pageFor("terms"),
    evidence: !links.terms
      ? pageEvidence(normalized, true, { reason: "No terms link was detected" })
      : !pageFor("terms")
        ? skippedEvidence("Terms page could not be retrieved for content verification", { termsUrl: links.terms.href })
        : pageEvidence(links.terms.href, wordCount(termsText) < 100, { words: wordCount(termsText) }),
    recommendation: "Publish or repair clear terms and conditions for the service."
  });
  add(15, {
    passed: wordCount(aboutText) >= 120,
    skipped: !pageFor("about"),
    notApplicable: !pageFor("about"),
    warning: Boolean(pageFor("about")) && wordCount(aboutText) < 120,
    priorityScore: 15,
    evidence: !pageFor("about")
      ? skippedEvidence("About-page depth is checked only when an About page is detected")
      : pageEvidence(links.about?.href ?? normalized, wordCount(aboutText) < 120, { words: wordCount(aboutText) }),
    recommendation: "Describe the company, ownership, purpose, and relevant expertise accurately on the About page."
  });
  add(20, {
    passed: Boolean(pageFor("team")) && (team$("img").length >= 2 || team$("a[href*='linkedin.com']").length >= 2 || (teamText.match(/\b(CEO|Founder|Director|Manager|Lead|Head of)\b/g) ?? []).length >= 2),
    skipped: !pageFor("team"),
    notApplicable: !pageFor("team"),
    warning: Boolean(pageFor("team")),
    evidence: !pageFor("team")
      ? skippedEvidence("Team-page completeness is checked only when a Team or Leadership page is detected")
      : pageEvidence(links.team?.href ?? normalized, false, { teamUrl: links.team?.href ?? "" })
  });

  add(14, { passed: /trusted by|clients|customers|partners|featured in/i.test(homepage) && $("img[alt]").length >= 2, skipped: !/clients|customers|partners|featured in|trusted by|case stud/i.test(homepage), warning: /trusted by|clients|customers|partners|featured in/i.test(homepage), evidence: { logoImages: $("img[alt]").length } });
  add(16, { passed: true, skipped: !articleApplicable || authorityLinks.length === 0, notApplicable: !articleApplicable, evidence: skippedEvidence(!articleApplicable ? "Authority-link checks run only on informational article or research pages" : ".edu and .gov links are optional; cite the most relevant authoritative source regardless of domain", { authorityLinks: authorityLinks.slice(0, 10), outboundLinks: outboundLinks.length }) });
  add(17, { passed: articleApplicable && sourceCitations > 0, skipped: !articleApplicable || sourceCitations === 0, notApplicable: !articleApplicable, evidence: skippedEvidence(!articleApplicable ? "Inline citation checks run only on informational article or research pages" : "No claim requiring a validated inline source was established from the sampled page", { sourceCitations, articleDetected: articleApplicable }) });
  add(18, { skipped: true, evidence: { reason: "Verifiable claim ratio requires claim extraction and source validation; static HTML alone cannot verify it exactly." } });
  add(19, {
    passed: Boolean(pageFor("caseStudy")) && /\b\d+(?:\.\d+)?%|\b\d+x\b|\bROI\b|\brevenue\b|\bsaved\b/i.test(caseText),
    skipped: !pageFor("caseStudy"),
    notApplicable: !pageFor("caseStudy"),
    warning: Boolean(pageFor("caseStudy")) && !/\b\d+(?:\.\d+)?%|\b\d+x\b|\bROI\b|\brevenue\b|\bsaved\b/i.test(caseText),
    priorityScore: 15,
    evidence: !pageFor("caseStudy")
      ? skippedEvidence("Case studies are optional and no case-study page was detected")
      : pageEvidence(links.caseStudy?.href ?? normalized, !/\b\d+(?:\.\d+)?%|\b\d+x\b|\bROI\b|\brevenue\b|\bsaved\b/i.test(caseText)),
    recommendation: "Add metrics only to genuine case studies when outcomes can be substantiated."
  });

  const categories = summarize(results);
  const scorable = results.filter((check) => !check.skipped);
  const score = scoreParameterOutcomes(results);
  return { score, checkedAt: new Date().toISOString(), categories, checks: results };
}
