import * as tls from "node:tls";
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
  [21, "Author & Expertise", "Author Experience Quantified", 2.12, "Medium"],
  [22, "Compliance & Disclosure", "YMYL Disclaimers", 2.65, "High"],
  [23, "Trust Signals & Reviews", "Third-Party Review Widget", 2.12, "Medium"],
  [24, "Trust Signals & Reviews", "Awards/Certifications Page", 1.59, "Medium"],
  [25, "Trust Signals & Reviews", "Industry Certification Badges", 1.59, "Medium"],
  [26, "Trust & Transparency", "About Links to Verification", 2.12, "High"],
  [27, "Trust Signals & Reviews", "reviewedBy Schema", 2.12, "High"],
  [28, "Trust Signals & Reviews", "GBP Review Response Rate", 2.12, "Medium"],
  [29, "Technical Trust", "SSL Certificate OV/EV", 1.59, "Medium"]
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

function jsonLdRecords($: cheerio.CheerioAPI): unknown[] {
  const records: unknown[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        records.push(...parsed);
      } else {
        records.push(parsed);
      }
    } catch {
      // Invalid JSON-LD is covered by the structured data audit.
    }
  });
  return records;
}

function hasPropertyDeep(value: unknown, property: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, property)) return true;
  if (Array.isArray(value)) return value.some((item) => hasPropertyDeep(item, property));
  return Object.values(value as Record<string, unknown>).some((item) => hasPropertyDeep(item, property));
}

function ymylDetected(text: string, url: string) {
  return /\b(doctor|medical|health|clinic|hospital|pharmacy|medicine|symptom|treatment|therapy|legal|lawyer|attorney|tax|loan|mortgage|insurance|investment|finance|financial|wealth|trading|credit|debt|retirement)\b/i.test(`${url} ${text}`);
}

function disclaimerDetected(text: string) {
  return /\b(not (?:medical|legal|financial) advice|informational purposes only|consult (?:a|your) (?:doctor|physician|lawyer|attorney|financial advisor|tax advisor|professional)|risk disclosure|terms apply|eligibility criteria|past performance|licensed professional)\b/i.test(text);
}

function thirdPartyReviewSignals($: cheerio.CheerioAPI, text: string) {
  const providers = new Set<string>();
  const providerPattern = /\b(google reviews?|trustpilot|g2|capterra|clutch|yelp|facebook reviews?|reviews\.io|sitejabber|bbb|glassdoor|tripadvisor|zomato)\b/i;
  if (providerPattern.test(text)) providers.add("text");
  $("script[src],iframe[src],a[href]").each((_, el) => {
    const source = `${$(el).attr("src") ?? ""} ${$(el).attr("href") ?? ""} ${$(el).text()}`;
    const match = source.match(providerPattern);
    if (match?.[1]) providers.add(match[1].toLowerCase());
  });
  return [...providers];
}

function certificationSignals($: cheerio.CheerioAPI, text: string) {
  const matches = new Set<string>();
  const pattern = /\b(iso\s?9001|iso\s?27001|soc\s?2|hipaa|pci\s?dss|gdpr|google partner|microsoft partner|shopify partner|meta business partner|bbb accredited|nabh|nabl|fda registered|certified|licensed|accredited)\b/i;
  const textMatch = text.match(pattern);
  if (textMatch?.[1]) matches.add(textMatch[1]);
  $("img[alt],svg[aria-label],a[href]").each((_, el) => {
    const source = `${$(el).attr("alt") ?? ""} ${$(el).attr("aria-label") ?? ""} ${$(el).attr("href") ?? ""} ${$(el).text()}`;
    const match = source.match(pattern);
    if (match?.[1]) matches.add(match[1]);
  });
  return [...matches];
}

function externalVerificationLinks($: cheerio.CheerioAPI, base: URL) {
  return $("a[href]").toArray()
    .map((el) => absolute(base, $(el).attr("href") ?? ""))
    .filter((href) => href && !sameOrigin(base, href))
    .filter((href) => /\b(linkedin\.com|crunchbase\.com|wikidata\.org|wikipedia\.org|google\.com\/maps|maps\.app\.goo\.gl|bbb\.org|trustpilot\.com|g2\.com|clutch\.co|schema\.org|iso\.org|soc2|aicpa|pci|hipaa|gov|edu)\b/i.test(href))
    .slice(0, 10);
}

async function sslCertificateOrganization(url: URL) {
  if (url.protocol !== "https:") {
    return { checked: true, organization: "", issuer: "", validTo: "", error: "URL is not served over HTTPS." };
  }
  return new Promise<{ checked: boolean; organization: string; issuer: string; validTo: string; error?: string }>((resolve) => {
    const socket = tls.connect({
      host: url.hostname,
      port: Number(url.port || 443),
      servername: url.hostname,
      timeout: 5000,
      rejectUnauthorized: false
    }, () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      const subject = certificate.subject ?? {};
      const issuer = certificate.issuer ?? {};
      resolve({
        checked: true,
        organization: typeof subject.O === "string" ? subject.O : "",
        issuer: typeof issuer.O === "string" ? issuer.O : "",
        validTo: certificate.valid_to ?? ""
      });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ checked: false, organization: "", issuer: "", validTo: "", error: "TLS certificate lookup timed out." });
    });
    socket.on("error", (error) => {
      resolve({ checked: false, organization: "", issuer: "", validTo: "", error: error.message });
    });
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
    certification: findLink($, base, /awards?|certifications?|accredit|credentials?|recognition|press|security|compliance/i),
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
  const about$ = cheerio.load(pageFor("about"));
  const aboutText = about$("body").text().replace(/\s+/g, " ").trim();
  const privacyText = cheerio.load(pageFor("privacy"))("body").text().replace(/\s+/g, " ").trim();
  const termsText = cheerio.load(pageFor("terms"))("body").text().replace(/\s+/g, " ").trim();
  const team$ = cheerio.load(pageFor("team"));
  const teamText = team$("body").text().replace(/\s+/g, " ").trim();
  const caseText = cheerio.load(pageFor("caseStudy"))("body").text().replace(/\s+/g, " ").trim();
  const certification$ = cheerio.load(pageFor("certification"));
  const certificationText = certification$("body").text().replace(/\s+/g, " ").trim();
  const evidencePage$ = articleApplicable ? article$ : $;
  const evidenceUrl = articleApplicable ? articleUrl : normalized;
  const evidenceText = evidencePage$("body").text().replace(/\s+/g, " ").trim();
  const fullSiteText = [homepage, contactText, aboutText, teamText, certificationText].join(" ");
  const allJsonLd = [
    ...jsonLdRecords($),
    ...(articleApplicable ? jsonLdRecords(article$) : []),
    ...(pageFor("about") ? jsonLdRecords(about$) : [])
  ];
  const outboundLinks = evidencePage$("a[href]").toArray()
    .map((el) => absolute(new URL(evidenceUrl), evidencePage$(el).attr("href") ?? ""))
    .filter((href) => href && !sameOrigin(base, href));
  const authorityLinks = authoritativeOutboundLinks(outboundLinks);
  const sourceCitations = evidencePage$("article a[href],main a[href],cite,blockquote,sup a[href]").toArray()
    .filter((element) => {
      const href = evidencePage$(element).attr("href");
      return !href || !sameOrigin(base, absolute(new URL(evidenceUrl), href));
    }).length;
  const localIntent = localTrustApplicable(homepage + " " + contactText);
  const hasContactLink = Boolean(links.contact || contactText);
  const ymyl = ymylDetected(evidenceText || fullSiteText, evidenceUrl);
  const disclaimer = disclaimerDetected(evidenceText) || disclaimerDetected(fullSiteText);
  const thirdPartyReviews = thirdPartyReviewSignals($, fullSiteText);
  const certifications = certificationSignals($, fullSiteText);
  const certificationPageCertifications = certificationSignals(certification$, certificationText);
  const verificationLinks = pageFor("about") ? externalVerificationLinks(about$, base) : [];
  const reviewedBySchema = allJsonLd.some((record) => hasPropertyDeep(record, "reviewedBy"));
  const sslOrganization = await sslCertificateOrganization(base);
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
    skipped: !articleApplicable,
    notApplicable: !articleApplicable,
    evidence: !articleApplicable
      ? skippedEvidence("Byline links are checked only on actual article or blog-detail pages")
      : !bioLink
        ? pageEvidence(articleUrl, true, { reason: "No public author bio/profile link was detected from the article byline." })
        : pageEvidence(articleUrl, false, { bioLink: bioLink.href })
  });
  add(3, {
    passed: articleApplicable && Boolean(bioLink && bioPage?.html),
    skipped: !articleApplicable,
    notApplicable: !articleApplicable,
    evidence: !articleApplicable
      ? skippedEvidence("Author bio-page checks apply only to actual article or blog-detail pages")
      : !bioLink
        ? pageEvidence(articleUrl, true, { reason: "No author bio/profile link was detected to verify." })
        : pageEvidence(articleUrl, !bioPage?.html, { bioUrl: bioLink.href, status: bioPage?.status ?? 0 }),
    recommendation: "Repair the affected author-profile link so it opens a public bio page."
  });
  add(4, {
    passed: articleApplicable && Boolean(bioPage?.html) && wordCount(bioText) >= 150,
    skipped: !articleApplicable,
    notApplicable: !articleApplicable,
    warning: Boolean(bioPage?.html) && wordCount(bioText) < 150,
    priorityScore: 15,
    evidence: !articleApplicable
      ? skippedEvidence("Bio depth is checked only on actual article or blog-detail pages")
      : !bioPage?.html
        ? pageEvidence(articleUrl, true, { reason: "No public author bio page was available for depth verification." })
      : pageEvidence(bioPage.url, wordCount(bioText) < 150, { words: wordCount(bioText) }),
    recommendation: "Expand the author bio only with accurate qualifications, role, and relevant experience."
  });
  add(5, {
    passed: articleApplicable && Boolean(bioPage?.html) && bio$("a[href*='linkedin.com']").length > 0,
    skipped: !articleApplicable,
    notApplicable: !articleApplicable,
    warning: articleApplicable,
    evidence: !articleApplicable
      ? skippedEvidence("LinkedIn profile checks apply only when an article author is detected")
      : pageEvidence(bioLink?.href ?? articleUrl, !(bioPage?.html && bio$("a[href*='linkedin.com']").length > 0), { linkedinLinks: bio$("a[href*='linkedin.com']").length })
  });
  add(6, {
    passed: articleApplicable && Boolean(bioPage?.html) && bio$("a[href*='/blog'],a[href*='/article'],a[href*='/news'],a[href*='/insight']").length >= 3,
    skipped: !articleApplicable,
    notApplicable: !articleApplicable,
    warning: articleApplicable,
    evidence: !articleApplicable
      ? skippedEvidence("Author archive checks apply only when an article author is detected")
      : pageEvidence(bioLink?.href ?? articleUrl, !(bioPage?.html && bio$("a[href*='/blog'],a[href*='/article'],a[href*='/news'],a[href*='/insight']").length >= 3), { contentLinks: bio$("a[href*='/blog'],a[href*='/article'],a[href*='/news'],a[href*='/insight']").length })
  });
  add(21, {
    passed: articleApplicable && Boolean(bioPage?.html) && /\b\d+\+?\s+(years?|yrs?)\b|\b(since|experience)\s+\d{4}\b/i.test(bioText),
    skipped: !articleApplicable,
    notApplicable: !articleApplicable,
    warning: articleApplicable,
    evidence: !articleApplicable
      ? skippedEvidence("Quantified experience checks apply only when an article author is detected")
      : pageEvidence(bioLink?.href ?? articleUrl, !(bioPage?.html && /\b\d+\+?\s+(years?|yrs?)\b|\b(since|experience)\s+\d{4}\b/i.test(bioText)), { words: wordCount(bioText) })
  });

  add(7, {
    passed: Boolean(pageFor("editorial")) && wordCount(cheerio.load(pageFor("editorial"))("body").text()) >= 100,
    skipped: !articleApplicable,
    notApplicable: !articleApplicable,
    evidence: !articleApplicable
      ? skippedEvidence("Editorial-policy checks apply only to article-led publishers")
      : pageEvidence(links.editorial?.href ?? normalized, !pageFor("editorial") || wordCount(cheerio.load(pageFor("editorial"))("body").text()) < 100, {
        reason: !pageFor("editorial") ? "No editorial, fact-check, correction, or review-policy page was detected." : undefined,
        words: wordCount(cheerio.load(pageFor("editorial"))("body").text())
      })
  });
  add(8, {
    passed: addressFound(contactText),
    warning: hasContactLink,
    evidence: pageEvidence(links.contact?.href ?? normalized, !addressFound(contactText), { contactUrl: links.contact?.href ?? "", localIntent, reason: contactText ? undefined : "No contact page text was available." })
  });
  add(9, {
    passed: phoneFound(contactText),
    warning: hasContactLink && !phoneFound(contactText),
    evidence: pageEvidence(links.contact?.href ?? normalized, !phoneFound(contactText), { contactUrl: links.contact?.href ?? "", localIntent, reason: contactText ? undefined : "No contact page text was available." })
  });
  add(10, {
    passed: emailFound(contactText),
    warning: hasContactLink && !emailFound(contactText) && !phoneFound(contactText),
    priorityScore: 15,
    evidence: !hasContactLink
      ? pageEvidence(normalized, true, { reason: "No contact page was available for company-email analysis." })
      : pageEvidence(links.contact?.href ?? normalized, !emailFound(contactText), { phoneDetected: phoneFound(contactText) })
  });
  add(11, { skipped: true, evidence: { reason: "Form functionality cannot be verified with 100% accuracy without submitting a form." } });
  add(12, {
    passed: wordCount(privacyText) >= 120,
    evidence: !links.privacy
      ? pageEvidence(normalized, true, { reason: "No privacy-policy link was detected" })
      : !pageFor("privacy")
        ? pageEvidence(links.privacy.href, true, { reason: "Privacy-policy page could not be retrieved for substantive-content verification", privacyUrl: links.privacy.href })
        : pageEvidence(links.privacy.href, wordCount(privacyText) < 120, { words: wordCount(privacyText) }),
    recommendation: "Publish or repair a readable privacy policy describing data collection, use, retention, and contact rights."
  });
  add(13, {
    passed: Boolean(pageFor("terms")) && wordCount(termsText) >= 100,
    evidence: !links.terms
      ? pageEvidence(normalized, true, { reason: "No terms link was detected" })
      : !pageFor("terms")
        ? pageEvidence(links.terms.href, true, { reason: "Terms page could not be retrieved for content verification", termsUrl: links.terms.href })
        : pageEvidence(links.terms.href, wordCount(termsText) < 100, { words: wordCount(termsText) }),
    recommendation: "Publish or repair clear terms and conditions for the service."
  });
  add(15, {
    passed: wordCount(aboutText) >= 120,
    warning: Boolean(pageFor("about")) && wordCount(aboutText) < 120,
    priorityScore: 15,
    evidence: !pageFor("about")
      ? pageEvidence(links.about?.href ?? normalized, true, { reason: "No readable About page was detected." })
      : pageEvidence(links.about?.href ?? normalized, wordCount(aboutText) < 120, { words: wordCount(aboutText) }),
    recommendation: "Describe the company, ownership, purpose, and relevant expertise accurately on the About page."
  });
  add(20, {
    passed: Boolean(pageFor("team")) && (team$("img").length >= 2 || team$("a[href*='linkedin.com']").length >= 2 || (teamText.match(/\b(CEO|Founder|Director|Manager|Lead|Head of)\b/g) ?? []).length >= 2),
    warning: true,
    evidence: !pageFor("team")
      ? pageEvidence(links.team?.href ?? normalized, true, { reason: "No Team, People, Leadership, or Authors page was detected." })
      : pageEvidence(links.team?.href ?? normalized, !(team$("img").length >= 2 || team$("a[href*='linkedin.com']").length >= 2 || (teamText.match(/\b(CEO|Founder|Director|Manager|Lead|Head of)\b/g) ?? []).length >= 2), { teamUrl: links.team?.href ?? "" })
  });
  add(26, {
    passed: verificationLinks.length > 0,
    warning: Boolean(pageFor("about")),
    evidence: !pageFor("about")
      ? pageEvidence(links.about?.href ?? normalized, true, { reason: "No readable About page was available for verification-link analysis." })
      : pageEvidence(links.about?.href ?? normalized, verificationLinks.length === 0, { verificationLinks }),
    recommendation: "Link the About page to verifiable company, founder, certification, review, or public profile sources."
  });

  add(14, { passed: /trusted by|clients|customers|partners|featured in/i.test(homepage) && $("img[alt]").length >= 2, warning: true, evidence: pageEvidence(normalized, !(/trusted by|clients|customers|partners|featured in/i.test(homepage) && $("img[alt]").length >= 2), { logoImages: $("img[alt]").length, trustSectionDetected: /clients|customers|partners|featured in|trusted by|case stud/i.test(homepage) }) });
  add(23, {
    passed: thirdPartyReviews.length > 0,
    warning: true,
    evidence: pageEvidence(normalized, thirdPartyReviews.length === 0, {
      providersDetected: thirdPartyReviews,
      reason: thirdPartyReviews.length === 0 ? "No embedded or linked third-party review platform was detected on the crawled page." : undefined
    }),
    recommendation: "Add a visible third-party review source such as Google reviews, Trustpilot, G2, Capterra, Clutch, or another relevant platform."
  });
  add(24, {
    passed: Boolean(pageFor("certification")) && (wordCount(certificationText) >= 80 || certificationPageCertifications.length > 0),
    warning: true,
    evidence: !links.certification
      ? pageEvidence(normalized, true, { reason: "No Awards, Certifications, Accreditation, Recognition, Security, or Compliance page link was detected." })
      : !pageFor("certification")
        ? pageEvidence(links.certification.href, true, { reason: "The detected awards/certifications page could not be retrieved." })
        : pageEvidence(links.certification.href, !(wordCount(certificationText) >= 80 || certificationPageCertifications.length > 0), {
          words: wordCount(certificationText),
          certifications: certificationPageCertifications
        }),
    recommendation: "Create a public awards/certifications page only for credentials that can be substantiated."
  });
  add(25, {
    passed: certifications.length > 0,
    warning: true,
    evidence: pageEvidence(normalized, certifications.length === 0, {
      certifications,
      reason: certifications.length === 0 ? "No visible industry certification badge, credential, accreditation, or partner badge was detected." : undefined
    }),
    recommendation: "Show genuine certification or accreditation badges with links to verification where possible."
  });
  add(27, {
    passed: reviewedBySchema,
    skipped: !articleApplicable && !ymyl,
    notApplicable: !articleApplicable && !ymyl,
    warning: articleApplicable || ymyl,
    evidence: !articleApplicable && !ymyl
      ? skippedEvidence("reviewedBy schema applies to article, expert, or YMYL pages.")
      : pageEvidence(evidenceUrl, !reviewedBySchema, { jsonLdBlocks: allJsonLd.length, reviewedBySchema }),
    recommendation: "Add accurate reviewedBy schema only when a real reviewer has reviewed the content."
  });
  add(28, {
    skipped: true,
    notApplicable: !localIntent,
    evidence: skippedEvidence(
      "GBP review response rate requires connected, verified Google Business Profile data. Public crawls cannot access owner-response metrics for arbitrary audited sites.",
      { localIntentDetected: localIntent, googleReviewSignals: thirdPartyReviews.filter((provider) => /google/i.test(provider)) }
    )
  });
  add(16, {
    passed: articleApplicable && authorityLinks.length > 0,
    skipped: !articleApplicable,
    notApplicable: !articleApplicable,
    warning: articleApplicable,
    evidence: !articleApplicable
      ? skippedEvidence("Authority-link checks run only on informational article or research pages")
      : pageEvidence(articleUrl, authorityLinks.length === 0, { authorityLinks: authorityLinks.slice(0, 10), outboundLinks: outboundLinks.length })
  });
  add(17, {
    passed: articleApplicable && sourceCitations > 0,
    skipped: !articleApplicable,
    notApplicable: !articleApplicable,
    evidence: !articleApplicable
      ? skippedEvidence("Inline citation checks run only on informational article or research pages")
      : pageEvidence(articleUrl, sourceCitations === 0, { sourceCitations, articleDetected: articleApplicable })
  });
  add(18, { skipped: true, evidence: { reason: "Verifiable claim ratio requires claim extraction and source validation; static HTML alone cannot verify it exactly." } });
  add(19, {
    passed: Boolean(pageFor("caseStudy")) && /\b\d+(?:\.\d+)?%|\b\d+x\b|\bROI\b|\brevenue\b|\bsaved\b/i.test(caseText),
    warning: true,
    priorityScore: 15,
    evidence: !pageFor("caseStudy")
      ? pageEvidence(links.caseStudy?.href ?? normalized, true, { reason: "No case-study, results, customer-story, or success-story page was detected." })
      : pageEvidence(links.caseStudy?.href ?? normalized, !/\b\d+(?:\.\d+)?%|\b\d+x\b|\bROI\b|\brevenue\b|\bsaved\b/i.test(caseText)),
    recommendation: "Add metrics only to genuine case studies when outcomes can be substantiated."
  });
  add(22, {
    passed: ymyl && disclaimer,
    skipped: !ymyl,
    notApplicable: !ymyl,
    evidence: !ymyl
      ? skippedEvidence("YMYL disclaimer checks apply only when health, legal, finance, insurance, tax, or similar YMYL intent is detected.")
      : pageEvidence(evidenceUrl, !disclaimer, { ymylDetected: ymyl, disclaimerDetected: disclaimer }),
    recommendation: "Add a clear YMYL disclaimer near relevant content and route users to qualified professionals when appropriate."
  });
  add(29, {
    passed: sslOrganization.checked && Boolean(sslOrganization.organization),
    skipped: !sslOrganization.checked,
    warning: sslOrganization.checked,
    evidence: !sslOrganization.checked
      ? skippedEvidence("TLS certificate details could not be inspected in this runtime.", sslOrganization)
      : pageEvidence(normalized, !sslOrganization.organization, {
        organization: sslOrganization.organization,
        issuer: sslOrganization.issuer,
        validTo: sslOrganization.validTo,
        note: "OV/EV is inferred from an organization field on the public TLS certificate. Some clients no longer expose a distinct EV indicator."
      }),
    recommendation: "Use an organization-validated certificate only when the business case requires visible organization identity; otherwise keep a valid HTTPS certificate in place."
  });

  const categories = summarize(results);
  const scorable = results.filter((check) => !check.skipped);
  const score = scoreParameterOutcomes(results);
  return { score, checkedAt: new Date().toISOString(), categories, checks: results };
}
