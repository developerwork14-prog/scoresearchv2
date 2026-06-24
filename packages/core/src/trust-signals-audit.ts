import * as cheerio from "cheerio";
import { scoreParameterOutcomes, statusForParameterOutcomes } from "./audit-outcome.js";
import {
  TechnicalCategoryStatus,
  TrustSignalsAuditResult,
  TrustSignalsCategorySummary,
  TrustSignalsCheckResult,
  TrustSignalsSeverity
} from "./types.js";

interface CheckDefinition {
  id: number;
  category: string;
  name: string;
  weight: number;
  severity: TrustSignalsSeverity;
}

interface PageFetch {
  url: string;
  html: string;
  status: number;
  headers: Record<string, string>;
}

const CHECKS: CheckDefinition[] = [
  [1, "NAP & Brand Consistency", "NAP: Footer vs Schema vs Contact", 4.86, "Critical"],
  [2, "NAP & Brand Consistency", "City Name Consistent Sitewide", 3.74, "High"],
  [3, "NAP & Brand Consistency", "Brand Name Consistent Sitewide", 3.74, "High"],
  [4, "NAP & Brand Consistency", "Business Email Company Domain", 2.67, "High"],
  [5, "NAP & Brand Consistency", "Address Matches Schema", 3.74, "Critical"],
  [6, "NAP & Brand Consistency", "Phone Format Consistent", 2.67, "High"],
  [7, "Schema-DOM Parity", "Schema-DOM Price Parity", 4.28, "Critical"],
  [8, "NAP & Brand Consistency", "Schema-DOM Name Parity", 3.21, "High"],
  [9, "NAP & Brand Consistency", "Schema-DOM Phone Parity", 3.74, "Critical"],
  [10, "Schema-DOM Parity", "Schema-DOM Date Parity", 2.67, "High"],
  [11, "Technical Trust", "Contact Form Functional", 2.67, "High"],
  [12, "Technical Trust", "No Outdated Copyright Year", 2.14, "Medium"],
  [13, "Technical Trust", "HTTPS Security Headers", 2.14, "Medium"],
  [14, "Technical Trust", "Legal Registration Number", 0, "Advisory"],
  [15, "Technical Trust", "Privacy Policy <24 Months Old", 2.14, "Medium"]
].map(([id, category, name, weight, severity]) => ({ id, category, name, weight, severity })) as CheckDefinition[];

const CATEGORY_ORDER = [...new Set(CHECKS.map((check) => check.category))];
const ORG_TYPES = new Set(["Organization", "LocalBusiness", "Corporation", "OnlineBusiness", "ProfessionalService", "MedicalOrganization", "NGO", "EducationalOrganization"]);
const LOCAL_TYPES = new Set(["LocalBusiness", "ProfessionalService", "FinancialService", "MedicalBusiness", "Store", "Restaurant", "Dentist", "MedicalClinic", "HealthAndBeautyBusiness"]);

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeUrl(value: string) {
  return value.startsWith("http") ? value : `https://${value}`;
}

async function fetchPage(url: string): Promise<PageFetch | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(7000),
      headers: { "user-agent": "AIVisibilityAnalyzer/1.0" }
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      url: response.url,
      html: response.ok ? await response.text() : "",
      status: response.status,
      headers
    };
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

function findLink($: cheerio.CheerioAPI, base: URL, pattern: RegExp) {
  return $("a[href]").toArray()
    .map((el) => ({ href: absolute(base, $(el).attr("href") ?? ""), text: $(el).text().replace(/\s+/g, " ").trim() }))
    .find((link) => link.href && sameOrigin(base, link.href) && (pattern.test(link.href) || pattern.test(link.text)));
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function typesOf(record: Record<string, unknown>) {
  return asArray(record["@type"] as string | string[] | undefined).map(String);
}

function flattenSchema(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(flattenSchema);
  const record = value as Record<string, unknown>;
  const current = record["@type"] ? [record] : [];
  return [...current, ...flattenSchema(record["@graph"])];
}

function parseJsonLd($: cheerio.CheerioAPI) {
  return $("script[type='application/ld+json']").toArray().flatMap((el) => {
    try {
      return flattenSchema(JSON.parse($(el).text()));
    } catch {
      return [];
    }
  });
}

function findByType(records: Record<string, unknown>[], predicate: (type: string) => boolean) {
  return records.filter((record) => typesOf(record).some(predicate));
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return textValue(record.name) || textValue(record.url) || textValue(record["@id"]);
  }
  return "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizedText(value: string) {
  return value.toLowerCase().replace(/&nbsp;/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function compact(value: string) {
  return normalizedText(value).replace(/\s+/g, " ");
}

function digits(value: string) {
  return value.replace(/\D+/g, "");
}

function normalizedPhoneDigits(value: string) {
  const valueDigits = digits(value);
  return valueDigits.length === 12 && valueDigits.startsWith("91") ? valueDigits.slice(2) : valueDigits;
}

function isLikelyPhone(value: string) {
  const valueDigits = normalizedPhoneDigits(value);
  if (/\b\d+(?:\.\d+){2,}\b/.test(value)) return false;
  if (/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/.test(value)) return false;
  if (/\b(?:19|20)\d{2}\b/.test(value) && /[-/.]/.test(value)) return false;
  if (/^1800\d{6,7}$/.test(valueDigits)) return true;
  if (/^[6-9]\d{9}$/.test(valueDigits)) return true;
  if (/^0\d{9,11}$/.test(valueDigits)) return true;
  return /^[1-9]\d{9,10}$/.test(valueDigits);
}

export function phoneCandidates(text: string) {
  return Array.from(new Set((text.match(/\+?\d[\d\s().-]{7,}\d/g) ?? [])
    .map((phone) => phone.trim())
    .filter(isLikelyPhone)));
}

function emailCandidates(text: string) {
  return Array.from(new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []));
}

function domainFromEmail(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function rootDomain(hostname: string) {
  const parts = hostname.replace(/^www\./, "").toLowerCase().split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : parts.join(".");
}

function schemaAddress(record: Record<string, unknown> | undefined) {
  const address = objectValue(record?.address);
  const parts = [
    textValue(address.streetAddress),
    textValue(address.addressLocality),
    textValue(address.addressRegion),
    textValue(address.postalCode),
    textValue(address.addressCountry)
  ].filter(Boolean);
  return {
    full: parts.join(", "),
    city: textValue(address.addressLocality),
    region: textValue(address.addressRegion),
    postalCode: textValue(address.postalCode)
  };
}

function schemaDates(records: Record<string, unknown>[]) {
  return records.flatMap((record) => [textValue(record.datePublished), textValue(record.dateModified), textValue(record.uploadDate), textValue(record.startDate), textValue(record.endDate)]).filter(Boolean);
}

function visibleDateCandidates($: cheerio.CheerioAPI) {
  return Array.from(new Set(
    $("time[datetime],[itemprop='datePublished'],[itemprop='dateModified'],[class*='published' i],[class*='updated' i],[class*='modified' i]")
      .toArray()
      .flatMap((element) => [$(element).attr("datetime") ?? "", $(element).text().replace(/\s+/g, " ").trim()])
      .filter((value) => /\b(?:19|20)\d{2}\b/.test(value))
  ));
}

function comparableDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return value.match(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/)?.[0] ?? compact(value);
}

function schemaPrices(records: Record<string, unknown>[]) {
  return records.flatMap((record) => {
    const offerRecords = asArray(record.offers as Record<string, unknown> | Record<string, unknown>[] | undefined).map(objectValue);
    return offerRecords.flatMap((offer) => [textValue(offer.price), textValue(offer.lowPrice), textValue(offer.highPrice)]).filter(Boolean);
  });
}

function schemaPhones(record: Record<string, unknown> | undefined) {
  return [textValue(record?.telephone), ...asArray(record?.contactPoint as Record<string, unknown> | Record<string, unknown>[] | undefined).map((item) => textValue(objectValue(item).telephone))].filter(Boolean);
}

export function addressCandidates(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const candidates = [
    cleaned.match(/\b(?:office\s+address|address|location)\b\s*:?\s*(.{20,260}?\b\d{5,6}\b)/i)?.[1] ?? "",
    cleaned.match(/(.{0,80}\b(?:floor|court|block|road|rd\.|street|st\.|avenue|lane|koramangala|bangalore|bengaluru|karnataka|india)\b.{20,180}?\b\d{5,6}\b)/i)?.[1] ?? ""
  ].map((candidate) =>
    candidate
      .replace(/\b(?:our\s+email|email|call\s+center|phone|telephone|mobile)\b[\s\S]*$/i, "")
      .replace(/\s+/g, " ")
      .trim()
  ).filter((candidate) => candidate.length >= 20 && /\b\d{5,6}\b/.test(candidate));
  return Array.from(new Set(candidates));
}

function containsExactText(haystack: string, needle: string) {
  const normalizedNeedle = compact(needle);
  return Boolean(normalizedNeedle) && compact(haystack).includes(normalizedNeedle);
}

function footerText($: cheerio.CheerioAPI) {
  const footer = $("footer").text().replace(/\s+/g, " ").trim();
  return footer || $("[class*='footer' i],[id*='footer' i]").text().replace(/\s+/g, " ").trim();
}

function result(def: CheckDefinition, state: {
  passed?: boolean;
  skipped?: boolean;
  notApplicable?: boolean;
  warning?: boolean;
  priorityScore?: number;
  recommendation?: string;
  severity?: TrustSignalsSeverity;
  evidence?: Record<string, unknown>;
}): TrustSignalsCheckResult {
  const skipped = Boolean(state.skipped);
  const warning = !skipped && Boolean(state.warning);
  const passed = skipped ? true : Boolean(state.passed);
  return {
    ...def,
    severity: state.severity ?? def.severity,
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

function summarize(checks: TrustSignalsCheckResult[]): TrustSignalsCategorySummary[] {
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

function copyrightYears(text: string) {
  return Array.from(new Set((text.match(/(?:copyright|\u00a9|\(c\))\s*(?:\d{4}\s*[-\u2013]\s*)?(\d{4})/gi) ?? [])
    .map((match) => Number(match.match(/(\d{4})(?!.*\d{4})/)?.[1] ?? 0))
    .filter((year) => year >= 1990 && year <= new Date().getFullYear() + 1)));
}

function legalRegistrationNumbers(text: string) {
  const patterns = [
    /\b(?:GSTIN|GST|VAT|EIN|TIN|CIN|LLPIN|Company Registration(?: Number)?|Registration(?: Number)?|Reg\.?\s*No\.?)[:#\s-]*[A-Z0-9-]{6,25}\b/gi
  ];
  return Array.from(new Set(patterns.flatMap((pattern) => text.match(pattern) ?? [])));
}

function policyDate(text: string) {
  const direct = text.match(/\b(?:last updated|last modified|effective date|updated on|effective)\s*:?\s*([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1];
  if (!direct) return null;
  const parsed = new Date(direct);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addMonths(date: Date, months: number) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

export async function runTrustSignalsAudit(inputUrl: string, html?: string, brandName = "", businessEmail = ""): Promise<TrustSignalsAuditResult> {
  const normalized = normalizeUrl(inputUrl);
  const base = new URL(normalized);
  const fetchedHomepagePromise = fetchPage(normalized);
  const fetchedHomepage = html === undefined ? await fetchedHomepagePromise : null;
  const homepage = html ?? fetchedHomepage?.html ?? "";
  const $ = cheerio.load(homepage);
  const records = parseJsonLd($);
  const org = findByType(records, (type) => ORG_TYPES.has(type))[0];
  const local = findByType(records, (type) => LOCAL_TYPES.has(type))[0];
  const entity = local ?? org;
  const schemaName = textValue(entity?.name);
  const address = schemaAddress(entity);
  const schemaPhoneValues = schemaPhones(entity);
  const productRecords = findByType(records, (type) => type === "Product");
  const pageDates = schemaDates(records);
  const visibleDates = visibleDateCandidates($);
  const prices = schemaPrices(productRecords);
  const footer = footerText($);
  const body = $("body").text().replace(/\s+/g, " ").trim();
  const contactLink = findLink($, base, /contact|get in touch/i);
  const privacyLink = findLink($, base, /privacy/i);
  const [headerPage, contactPage, privacyPage] = await Promise.all([
    html === undefined ? Promise.resolve(fetchedHomepage) : fetchedHomepagePromise,
    contactLink?.href ? fetchPage(contactLink.href) : Promise.resolve(null),
    privacyLink?.href ? fetchPage(privacyLink.href) : Promise.resolve(null)
  ]);
  const headers = headerPage?.headers ?? {};
  const contactText = cheerio.load(contactPage?.html ?? "")("body").text().replace(/\s+/g, " ").trim();
  const privacyText = cheerio.load(privacyPage?.html ?? "")("body").text().replace(/\s+/g, " ").trim();
  const allText = [body, footer, contactText, privacyText].join(" ");
  const footerPhones = phoneCandidates(footer);
  const contactPhones = phoneCandidates(contactText);
  const footerAddresses = addressCandidates(footer);
  const contactAddresses = addressCandidates(contactText);
  const visibleAddress = contactAddresses[0] ?? footerAddresses[0] ?? "";
  const allPhones = Array.from(new Set([...phoneCandidates(body), ...footerPhones, ...contactPhones]));
  const allPhoneDigits = Array.from(new Set(allPhones.map(normalizedPhoneDigits).filter(Boolean)));
  const schemaPhoneDigits = Array.from(new Set(schemaPhoneValues.map(normalizedPhoneDigits).filter(Boolean)));
  const visiblePhoneDigits = Array.from(new Set([...footerPhones, ...contactPhones].map(normalizedPhoneDigits).filter(Boolean)));
  const schemaAddressMatchesVisible = Boolean(address.full && (containsExactText(body, address.full) || containsExactText(contactText, address.full) || containsExactText(footer, address.full)));
  const visibleNapPresent = Boolean(visibleAddress && visiblePhoneDigits.length);
  const schemaPhoneMatchesVisible = schemaPhoneDigits.length > 0 && schemaPhoneDigits.some((phone) => visiblePhoneDigits.includes(phone));
  const allEmails = emailCandidates(allText);
  const brandCandidate = brandName || schemaName;
  const currentYear = new Date().getFullYear();
  const comparisonReady = Boolean(entity && address.full && schemaPhoneDigits.length > 0 && visibleAddress && visiblePhoneDigits.length > 0);
  const contact$ = cheerio.load(contactPage?.html ?? "");
  const contactFormExists = contact$("form").length > 0;
  const supportChannelExists = contactFormExists
    || visiblePhoneDigits.length > 0
    || contact$("a[href^='mailto:'],a[href*='whatsapp' i],a[href*='chat' i],[class*='support' i]").length > 0;
  const expectedEmailDomain = businessEmail ? rootDomain(domainFromEmail(businessEmail)) : rootDomain(base.hostname);
  const conflictingEmails = allEmails.filter((email) => rootDomain(domainFromEmail(email)) !== expectedEmailDomain);
  const regulatedIndustry = /\b(financial|finance|loan|credit|bank|insurance|healthcare|medical|clinic|investment|mortgage)\b/i.test(allText);
  const checks: TrustSignalsCheckResult[] = [];
  const add = (id: number, state: Parameters<typeof result>[1]) => {
    const def = CHECKS.find((check) => check.id === id);
    if (def) checks.push(result(def, state));
  };

  add(1, {
    passed: Boolean(schemaAddressMatchesVisible && schemaPhoneMatchesVisible),
    skipped: !comparisonReady,
    evidence: !comparisonReady
      ? skippedEvidence("Insufficient evidence.", { schemaExists: Boolean(entity), schemaAddress: address.full, schemaPhones: schemaPhoneValues, visibleAddress, visiblePhones: allPhones })
      : pageEvidence(normalized, !(schemaAddressMatchesVisible && schemaPhoneMatchesVisible), { schemaAddress: address.full, schemaPhones: schemaPhoneValues, contactUrl: contactLink?.href ?? "", visibleAddress, footerAddresses, contactAddresses, footerPhones, contactPhones }),
    recommendation: "Make the verified business address and phone match across schema, footer, and contact page."
  });
  add(2, {
    passed: Boolean(address.city && [body, footer, contactText].every((text) => !text || containsExactText(text, address.city))),
    skipped: !comparisonReady || !address.city,
    evidence: !comparisonReady || !address.city
      ? skippedEvidence("Insufficient evidence.")
      : pageEvidence(normalized, ![body, footer, contactText].every((text) => !text || containsExactText(text, address.city)), { city: address.city, checkedSurfaces: ["homepage", "footer", "contact"] }),
    recommendation: "Use the verified city name consistently across schema, footer, and contact information."
  });
  add(3, {
    passed: Boolean(brandCandidate && containsExactText(body, brandCandidate) && (!schemaName || compact(schemaName) === compact(brandCandidate)) && (!contactText || containsExactText(contactText, brandCandidate))),
    skipped: !comparisonReady || !brandCandidate,
    evidence: !comparisonReady || !brandCandidate
      ? skippedEvidence("Insufficient evidence.")
      : pageEvidence(normalized, !(containsExactText(body, brandCandidate) && compact(schemaName) === compact(brandCandidate) && (!contactText || containsExactText(contactText, brandCandidate))), { inputBrand: brandName, schemaName, contactUrl: contactLink?.href ?? "" }),
    recommendation: "Use the verified brand name consistently in schema, homepage, and contact information."
  });
  add(4, {
    passed: conflictingEmails.length === 0 && (allEmails.length > 0 || supportChannelExists),
    warning: conflictingEmails.length === 0 && !allEmails.length && !supportChannelExists,
    priorityScore: conflictingEmails.length ? 65 : 15,
    evidence: pageEvidence(normalized, conflictingEmails.length > 0 || (!allEmails.length && !supportChannelExists), {
      emails: allEmails,
      conflictingEmails,
      expectedDomain: expectedEmailDomain,
      contactFormExists,
      phoneExists: visiblePhoneDigits.length > 0,
      supportChannelExists
    }),
    recommendation: conflictingEmails.length
      ? "Replace the conflicting public email with an address that clearly belongs to the verified business identity."
      : "Provide at least one reliable business contact method, such as a phone number, support form, or verified email."
  });
  add(5, {
    passed: schemaAddressMatchesVisible,
    skipped: !comparisonReady,
    evidence: !comparisonReady
      ? skippedEvidence("Insufficient evidence.")
      : pageEvidence(normalized, !schemaAddressMatchesVisible, { schemaAddress: address.full, visibleAddress, footerAddresses, contactAddresses, contactUrl: contactLink?.href ?? "" }),
    recommendation: "Correct the proven address mismatch between visible contact details and organization schema."
  });
  add(6, {
    passed: allPhoneDigits.length === 1,
    skipped: allPhoneDigits.length === 0,
    evidence: allPhoneDigits.length === 0
      ? skippedEvidence("Insufficient evidence.")
      : pageEvidence(normalized, allPhoneDigits.length > 1, { phones: allPhones, normalizedPhones: allPhoneDigits }),
    recommendation: "Use one verified phone number format consistently across public contact surfaces."
  });
  add(7, {
    passed: prices.length > 0 && prices.every((price) => containsExactText(body, price)),
    skipped: prices.length === 0,
    notApplicable: prices.length === 0,
    evidence: prices.length === 0
      ? skippedEvidence("Price parity is not applicable because no schema price was detected.")
      : pageEvidence(normalized, !prices.every((price) => containsExactText(body, price)), { schemaPrices: prices }),
    recommendation: "Make schema prices match the prices visibly displayed on the affected page."
  });
  add(8, {
    passed: Boolean(schemaName && containsExactText(body, schemaName)),
    skipped: !schemaName,
    evidence: !schemaName
      ? skippedEvidence("Insufficient evidence.")
      : pageEvidence(normalized, !containsExactText(body, schemaName), { schemaName }),
    recommendation: "Make the organization name in schema match the visible brand name."
  });
  add(9, {
    passed: schemaPhoneDigits.length > 0 && schemaPhoneDigits.every((phone) => allPhoneDigits.includes(phone)),
    skipped: !comparisonReady,
    evidence: !comparisonReady
      ? skippedEvidence("Insufficient evidence.")
      : pageEvidence(normalized, !schemaPhoneDigits.every((phone) => allPhoneDigits.includes(phone)), { schemaPhones: schemaPhoneValues, domPhones: allPhones }),
    recommendation: "Correct the proven phone-number mismatch between visible contact details and organization schema."
  });
  add(10, {
    passed: pageDates.some((schemaDate) => visibleDates.some((visibleDate) => comparableDate(schemaDate) === comparableDate(visibleDate))),
    skipped: pageDates.length === 0 || visibleDates.length === 0,
    notApplicable: pageDates.length === 0,
    evidence: pageDates.length === 0
      ? skippedEvidence("Date parity is not applicable because no comparable schema date was detected.")
      : visibleDates.length === 0
        ? skippedEvidence("Insufficient evidence: no comparable visible date was detected.")
        : pageEvidence(normalized, !pageDates.some((schemaDate) => visibleDates.some((visibleDate) => comparableDate(schemaDate) === comparableDate(visibleDate))), { schemaDates: pageDates, visibleDates }),
    recommendation: "Make schema dates match the visible dates on the affected page."
  });
  add(11, { skipped: true, evidence: { reason: "Form functionality cannot be verified with 100% accuracy without submitting the form." } });
  add(12, {
    passed: copyrightYears(allText).some((year) => year >= currentYear),
    skipped: copyrightYears(allText).length === 0,
    evidence: copyrightYears(allText).length === 0
      ? skippedEvidence("Unable to verify a visible copyright year.")
      : pageEvidence(normalized, !copyrightYears(allText).some((year) => year >= currentYear), { copyrightYears: copyrightYears(allText), currentYear }),
    recommendation: `Update the visible copyright year to ${currentYear} when the footer displays an older year.`
  });
  const requiredSecurityHeaders = {
    "Strict-Transport-Security": headers["strict-transport-security"] ?? "",
    "X-Content-Type-Options": headers["x-content-type-options"] ?? "",
    "X-Frame-Options": headers["x-frame-options"] ?? "",
    "Referrer-Policy": headers["referrer-policy"] ?? "",
    "Permissions-Policy": headers["permissions-policy"] ?? ""
  };
  const missingSecurityHeaders = Object.entries(requiredSecurityHeaders).filter(([, value]) => !value).map(([name]) => name);
  add(13, {
    passed: base.protocol === "https:" && missingSecurityHeaders.length === 0,
    skipped: !headerPage,
    evidence: !headerPage ? skippedEvidence("Unable to retrieve response headers for security verification.") : pageEvidence(normalized, base.protocol !== "https:" || missingSecurityHeaders.length > 0, {
      protocol: base.protocol,
      headers: requiredSecurityHeaders,
      missingSecurityHeaders
    }),
    recommendation: missingSecurityHeaders.length
      ? `Configure the missing HTTPS security headers: ${missingSecurityHeaders.join(", ")}.`
      : "Serve the site over HTTPS with HSTS, framing, MIME-sniffing, referrer, and permissions protections."
  });
  add(14, {
    passed: legalRegistrationNumbers(allText).length > 0,
    skipped: !regulatedIndustry,
    notApplicable: !regulatedIndustry,
    warning: regulatedIndustry && legalRegistrationNumbers(allText).length === 0,
    severity: "Advisory",
    priorityScore: 10,
    evidence: !regulatedIndustry
      ? skippedEvidence("Legal registration disclosure is not applicable to the detected business type.")
      : legalRegistrationNumbers(allText).length === 0
        ? pageEvidence(normalized, true, { reason: "Optional regulated-industry trust signal: no verifiable registration number was detected." })
        : pageEvidence(normalized, false, { legalRegistrationNumbers: legalRegistrationNumbers(allText).slice(0, 5) }),
    recommendation: "For regulated services, display a verified legal or regulatory registration number when one legitimately applies."
  });
  const privacyUpdated = policyDate(privacyText);
  add(15, {
    passed: Boolean(privacyUpdated && addMonths(privacyUpdated, 24) >= new Date()),
    skipped: !privacyUpdated,
    evidence: !privacyUpdated
      ? skippedEvidence("Unable to verify policy update date.", { privacyUrl: privacyLink?.href ?? "", status: privacyPage?.status ?? 0 })
      : pageEvidence(privacyLink?.href ?? normalized, addMonths(privacyUpdated, 24) < new Date(), { lastUpdated: privacyUpdated.toISOString() }),
    recommendation: "Review and visibly update the privacy policy when its verified update date is older than 24 months."
  });

  for (const check of checks) {
    if (check.passed || check.skipped) continue;
    const pagesChecked = Number(check.evidence.pagesChecked);
    const pagesFailed = Number(check.evidence.pagesFailed);
    const affectedPages = Array.isArray(check.evidence.affectedPages) ? check.evidence.affectedPages : [];
    if (!(pagesChecked > 0 && pagesFailed > 0 && affectedPages.some((page) =>
      page && typeof page === "object" && typeof (page as Record<string, unknown>).url === "string"
    ))) {
      check.passed = true;
      check.skipped = true;
      check.warning = false;
      check.score = 0;
      check.evidence = skippedEvidence("Insufficient evidence.");
    }
  }

  const categories = summarize(checks);
  const scorable = checks.filter((check) => !check.skipped);
  const score = scoreParameterOutcomes(checks);
  return { score, checkedAt: new Date().toISOString(), categories, checks };
}
