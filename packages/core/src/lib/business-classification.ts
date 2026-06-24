import * as cheerio from "cheerio";

export interface RejectedCategory {
  category: string;
  reason: string;
}

export interface BusinessClassification {
  industry: string;
  subIndustry: string;
  businessModel: string;
  confidence: number;
  evidenceKeywords: string[];
  rejectedCategories: RejectedCategory[];
}

type SignalName = "title" | "description" | "h1" | "h2" | "navigation" | "productService" | "schema" | "body" | "domain";

interface WebsiteSignal {
  name: SignalName;
  text: string;
  weight: number;
}

interface TaxonomyItem {
  label: string;
  keywords: string[];
}

interface SubIndustryItem extends TaxonomyItem {
  industry: string;
}

interface BusinessModelItem extends TaxonomyItem {
  allowedIndustries?: string[];
}

interface CategoryScore<T extends TaxonomyItem> {
  item: T;
  score: number;
  strongSignals: Set<SignalName>;
  matchedKeywords: Set<string>;
}

const UNKNOWN_CLASSIFICATION: BusinessClassification = {
  industry: "Unclassified",
  subIndustry: "Insufficient Evidence",
  businessModel: "Unknown",
  confidence: 22,
  evidenceKeywords: [],
  rejectedCategories: []
};

const INDUSTRIES: TaxonomyItem[] = [
  {
    label: "Healthcare",
    keywords: ["healthcare", "health care", "clinic", "hospital", "medical", "doctor", "physician", "patient", "dermatology", "dermatologist", "skin", "hair treatment", "laser treatment", "aesthetic", "cosmetic treatment", "dental", "diagnostic"]
  },
  {
    label: "Financial Services",
    keywords: ["finance", "financial", "loan", "lending", "credit", "nbfc", "emi", "insurance", "investment", "banking", "wallet", "payment", "mortgage", "wealth"]
  },
  {
    label: "Industrial Materials",
    keywords: ["industrial", "raw material", "polymer", "plastic", "resin", "chemical", "granules", "masterbatch", "manufacturing material", "supplier", "procurement", "sourcing"]
  },
  {
    label: "Food and Grocery",
    keywords: ["food", "grocery", "groceries", "fresh produce", "vegetables", "fruits", "organic", "farm fresh", "dairy", "meat", "beverage"]
  },
  {
    label: "Software",
    keywords: ["software", "saas", "cloud", "api", "automation", "workflow", "dashboard", "crm", "analytics", "platform", "developer", "enterprise software"]
  },
  {
    label: "Education",
    keywords: ["education", "learning", "student", "course", "school", "college", "university", "coaching", "training", "edtech", "classroom"]
  },
  {
    label: "Commerce",
    keywords: ["ecommerce", "e-commerce", "online shopping", "shop", "store", "retail", "cart", "product catalog", "marketplace", "seller"]
  },
  {
    label: "Real Estate",
    keywords: ["real estate", "property", "apartment", "villa", "plot", "home buyer", "rental", "broker", "builder", "residential", "commercial property"]
  },
  {
    label: "Travel and Hospitality",
    keywords: ["travel", "hotel", "flight", "tour", "holiday", "resort", "booking", "itinerary", "hospitality", "stay", "vacation"]
  },
  {
    label: "Automotive",
    keywords: ["automotive", "vehicle", "car", "bike", "scooter", "ev", "dealer", "used car", "auto service", "spare parts"]
  },
  {
    label: "Legal Services",
    keywords: ["legal", "lawyer", "advocate", "law firm", "attorney", "compliance", "contract", "trademark", "litigation"]
  },
  {
    label: "Marketing Services",
    keywords: ["marketing agency", "advertising agency", "performance marketing", "digital marketing", "seo agency", "ppc agency", "social media agency", "media buying", "brand campaign"]
  },
  {
    label: "Manufacturing",
    keywords: ["manufacturing", "factory", "machining", "fabrication", "production line", "oem", "industrial equipment", "components", "assembly"]
  }
];

const SUB_INDUSTRIES: SubIndustryItem[] = [
  {
    label: "Aesthetic Dermatology",
    industry: "Healthcare",
    keywords: ["aesthetic clinic", "skin clinic", "laser treatment", "laser hair removal", "hair treatment", "hair transplant", "cosmetic dermatology", "dermatology", "dermatologist", "skin treatment", "acne treatment", "anti aging", "anti ageing", "botox", "fillers", "trichology", "skin care"]
  },
  {
    label: "Digital Healthcare",
    industry: "Healthcare",
    keywords: ["telemedicine", "online doctor", "doctor appointment", "medicine delivery", "health app", "diagnostics booking", "patient records", "virtual consultation"]
  },
  {
    label: "Personal Loans",
    industry: "Financial Services",
    keywords: ["personal loan", "instant loan", "salary loan", "digital loan", "loan app", "credit line", "borrow money", "emi", "paperless loan", "instant approval"]
  },
  {
    label: "Digital Insurance",
    industry: "Financial Services",
    keywords: ["health insurance", "life insurance", "motor insurance", "insurance policy", "insurance quote", "claim settlement", "policy renewal", "premium"]
  },
  {
    label: "Polymers and Plastic Raw Materials",
    industry: "Industrial Materials",
    keywords: ["polymer", "plastic raw material", "plastic resin", "resin", "hdpe", "ldpe", "lldpe", "pp granules", "pvc", "pet resin", "masterbatch", "elastomer", "polycarbonate", "abs plastic", "commodity polymers"]
  },
  {
    label: "Industrial Chemicals",
    industry: "Industrial Materials",
    keywords: ["industrial chemical", "specialty chemical", "solvent", "additive", "chemical supplier", "bulk chemical", "chemical distributor"]
  },
  {
    label: "Organic Grocery",
    industry: "Food and Grocery",
    keywords: ["organic grocery", "organic food", "organic vegetables", "organic fruits", "chemical free", "farm fresh", "natural produce", "fresh groceries"]
  },
  {
    label: "Dairy and Fresh Foods",
    industry: "Food and Grocery",
    keywords: ["milk", "dairy", "curd", "paneer", "fresh food", "farm milk", "eggs", "meat delivery"]
  },
  {
    label: "SaaS",
    industry: "Software",
    keywords: ["saas", "software as a service", "cloud software", "crm", "hrms", "billing software", "workflow automation", "analytics dashboard", "subscription software"]
  },
  {
    label: "Developer Tools",
    industry: "Software",
    keywords: ["api", "sdk", "developer platform", "documentation", "integration", "webhook", "database", "deployment", "monitoring"]
  },
  {
    label: "Online Education",
    industry: "Education",
    keywords: ["online learning", "online course", "live class", "test prep", "coaching", "upskilling", "certification", "learning app"]
  },
  {
    label: "Ecommerce",
    industry: "Commerce",
    keywords: ["ecommerce", "online store", "online shopping", "product catalog", "checkout", "cart", "delivery", "seller marketplace"]
  },
  {
    label: "Property Search",
    industry: "Real Estate",
    keywords: ["property search", "buy property", "rent property", "apartment", "villa", "plot", "real estate listing", "broker"]
  },
  {
    label: "Travel Booking",
    industry: "Travel and Hospitality",
    keywords: ["flight booking", "hotel booking", "holiday packages", "travel booking", "tour package", "itinerary", "resort booking"]
  },
  {
    label: "Vehicle Marketplace",
    industry: "Automotive",
    keywords: ["used car", "new car", "vehicle listing", "car dealer", "bike dealer", "electric scooter", "auto marketplace"]
  },
  {
    label: "Online Legal Services",
    industry: "Legal Services",
    keywords: ["legal advice", "online lawyer", "company registration", "trademark", "legal documents", "contract review", "compliance filing"]
  },
  {
    label: "Digital Marketing",
    industry: "Marketing Services",
    keywords: ["digital marketing", "seo", "performance marketing", "social media marketing", "ppc", "content marketing", "media buying", "influencer marketing"]
  },
  {
    label: "Industrial Component Manufacturing",
    industry: "Manufacturing",
    keywords: ["component manufacturing", "precision machining", "fabrication", "casting", "forging", "cnc", "assembly", "oem manufacturing"]
  }
];

const BUSINESS_MODELS: BusinessModelItem[] = [
  {
    label: "Multi-Specialty Skin Clinic",
    allowedIndustries: ["Healthcare"],
    keywords: ["clinic", "skin clinic", "hair clinic", "aesthetic clinic", "multi specialty", "multi-specialty", "treatment", "consultation", "dermatologist", "laser"]
  },
  {
    label: "Healthcare Platform",
    allowedIndustries: ["Healthcare"],
    keywords: ["platform", "app", "online consultation", "booking", "medicine delivery", "diagnostics", "patient portal"]
  },
  {
    label: "Digital Lending Platform",
    allowedIndustries: ["Financial Services"],
    keywords: ["loan app", "digital lending", "online loan", "instant approval", "paperless", "credit line", "emi calculator", "apply online"]
  },
  {
    label: "Insurance Marketplace",
    allowedIndustries: ["Financial Services"],
    keywords: ["compare insurance", "insurance marketplace", "quote", "buy policy", "renew policy", "claim support"]
  },
  {
    label: "B2B Marketplace",
    allowedIndustries: ["Industrial Materials", "Manufacturing"],
    keywords: ["b2b", "marketplace", "supplier", "suppliers", "buyer", "buyers", "sourcing", "procurement", "rfq", "quote", "trade", "distributor"]
  },
  {
    label: "D2C Delivery",
    allowedIndustries: ["Food and Grocery", "Commerce"],
    keywords: ["delivery", "home delivery", "subscription", "direct to consumer", "d2c", "order online", "same day delivery"]
  },
  {
    label: "Online Marketplace",
    allowedIndustries: ["Commerce", "Automotive", "Real Estate"],
    keywords: ["marketplace", "seller", "listing", "catalog", "checkout", "buy", "sell", "cart", "vendor"]
  },
  {
    label: "Subscription Software",
    allowedIndustries: ["Software"],
    keywords: ["subscription", "saas", "cloud platform", "enterprise", "self serve", "dashboard", "workflow", "integrations"]
  },
  {
    label: "EdTech Platform",
    allowedIndustries: ["Education"],
    keywords: ["edtech", "learning platform", "live classes", "course platform", "subscription", "students", "teachers"]
  },
  {
    label: "Online Travel Agency",
    allowedIndustries: ["Travel and Hospitality"],
    keywords: ["booking", "ota", "online travel", "deals", "packages", "reservation", "itinerary"]
  },
  {
    label: "Agency Services",
    allowedIndustries: ["Marketing Services"],
    keywords: ["agency", "services", "consulting", "campaigns", "retainer", "creative", "media planning"]
  },
  {
    label: "Service Provider",
    keywords: ["services", "consultation", "provider", "support", "solutions", "book appointment", "contact us"]
  }
];

function domainFromUrl(value: string) {
  try {
    return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function keywordRegex(keyword: string) {
  const normalized = normalizeText(keyword);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|\\b)${escaped}(\\b|$)`, "gi");
}

function keywordPresence(text: string, keyword: string) {
  if (keyword.length < 3) return 0;
  return text.match(keywordRegex(keyword))?.length ?? 0;
}

function extractStructuredDataText($: cheerio.CheerioAPI) {
  const values: string[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).text();
    try {
      values.push(JSON.stringify(JSON.parse(raw) as unknown));
    } catch {
      values.push(raw);
    }
  });
  return values.join(" ");
}

function extractProductServiceText($: cheerio.CheerioAPI) {
  const selectors = [
    "[class*='service']",
    "[id*='service']",
    "[class*='product']",
    "[id*='product']",
    "[class*='treatment']",
    "[id*='treatment']",
    "[class*='solution']",
    "[id*='solution']"
  ];
  return selectors.map((selector) => $(selector).text()).join(" ");
}

function extractWebsiteSignals(url: string, htmlContent: string): WebsiteSignal[] {
  const $ = cheerio.load(htmlContent || "");
  const metaDescription = $("meta").toArray()
    .find((element) => ($(element).attr("name") ?? "").trim().toLowerCase() === "description");
  const signals: WebsiteSignal[] = [
    { name: "title", text: $("title").first().text(), weight: 8 },
    { name: "description", text: metaDescription ? ($(metaDescription).attr("content") ?? "") : "", weight: 7 },
    { name: "h1", text: $("h1").first().text(), weight: 7 },
    { name: "h2", text: $("h2").map((_, element) => $(element).text()).get().join(" "), weight: 5 },
    { name: "navigation", text: $("nav, header").find("a, button").map((_, element) => $(element).text()).get().join(" "), weight: 4 },
    { name: "productService", text: extractProductServiceText($), weight: 6 },
    { name: "schema", text: extractStructuredDataText($), weight: 5 },
    { name: "body", text: $("body").text().replace(/\s+/g, " ").slice(0, 18000), weight: 1.2 },
    { name: "domain", text: domainFromUrl(url).replace(/[.-]/g, " "), weight: 0.35 }
  ];
  return signals.map((signal) => ({ ...signal, text: normalizeText(signal.text) }));
}

function scoreItem<T extends TaxonomyItem>(item: T, signals: WebsiteSignal[]): CategoryScore<T> {
  const strongSignals = new Set<SignalName>();
  const matchedKeywords = new Set<string>();
  let score = 0;

  for (const signal of signals) {
    if (!signal.text) continue;
    let signalScore = 0;
    for (const keyword of item.keywords) {
      const count = keywordPresence(signal.text, keyword);
      if (!count) continue;
      const phraseBonus = keyword.includes(" ") ? 1.35 : 1;
      const weightedCount = Math.min(count, signal.name === "body" ? 3 : 2);
      signalScore += weightedCount * signal.weight * phraseBonus;
      matchedKeywords.add(keyword);
    }
    if (signalScore > 0 && signal.name !== "domain" && signal.weight >= 4) strongSignals.add(signal.name);
    score += signalScore;
  }

  return { item, score, strongSignals, matchedKeywords };
}

function bestScores<T extends TaxonomyItem>(items: T[], signals: WebsiteSignal[]) {
  return items.map((item) => scoreItem(item, signals)).sort((a, b) => b.score - a.score);
}

function hasEnoughEvidence<T extends TaxonomyItem>(score: CategoryScore<T>, minimumScore: number, minimumSignals: number) {
  return score.score >= minimumScore && score.strongSignals.size >= minimumSignals && score.matchedKeywords.size >= 2;
}

function rejectedCategory<T extends TaxonomyItem>(score: CategoryScore<T>, winner: string, reason: string): RejectedCategory {
  return {
    category: score.item.label,
    reason: `${reason}. Selected ${winner} instead. Evidence: ${[...score.matchedKeywords].slice(0, 5).join(", ") || "weak"}`
  };
}

function confidenceFor(
  industryScore: CategoryScore<TaxonomyItem>,
  subIndustryScore: CategoryScore<SubIndustryItem>,
  businessModelScore: CategoryScore<BusinessModelItem>,
  secondIndustryScore: number,
  secondSubIndustryScore: number,
  secondBusinessModelScore: number
) {
  const evidenceSignals = new Set<SignalName>([
    ...industryScore.strongSignals,
    ...subIndustryScore.strongSignals,
    ...businessModelScore.strongSignals
  ]);
  const evidenceKeywords = new Set<string>([
    ...industryScore.matchedKeywords,
    ...subIndustryScore.matchedKeywords,
    ...businessModelScore.matchedKeywords
  ]);
  const scoreTotal = industryScore.score + subIndustryScore.score + businessModelScore.score;
  const margin =
    Math.max(0, industryScore.score - secondIndustryScore) +
    Math.max(0, subIndustryScore.score - secondSubIndustryScore) +
    Math.max(0, businessModelScore.score - secondBusinessModelScore);

  let confidence = Math.round(24 + Math.min(34, scoreTotal * 0.45) + Math.min(22, margin * 0.55) + evidenceSignals.size * 4 + Math.min(10, evidenceKeywords.size));

  if (evidenceSignals.size < 2 || evidenceKeywords.size < 3) confidence = Math.min(confidence, 48);
  if (evidenceSignals.size < 3) confidence = Math.min(confidence, 68);
  if (evidenceSignals.size < 4 || evidenceKeywords.size < 5) confidence = Math.min(confidence, 84);
  if (confidence > 90 && (evidenceSignals.size < 5 || evidenceKeywords.size < 5)) confidence = 90;

  return Math.max(22, Math.min(96, confidence));
}

export function classifyBusiness(url: string, htmlContent: string): BusinessClassification {
  const signals = extractWebsiteSignals(url, htmlContent);
  const rejectedCategories: RejectedCategory[] = [];
  const industryScores = bestScores(INDUSTRIES, signals);
  const subIndustryScores = bestScores(SUB_INDUSTRIES, signals);
  const businessModelScores = bestScores(BUSINESS_MODELS, signals);

  let selectedIndustry = industryScores[0];
  let selectedSubIndustry = subIndustryScores[0];

  if (!hasEnoughEvidence(selectedIndustry, 7, 1) && !hasEnoughEvidence(selectedSubIndustry, 9, 1)) {
    return {
      ...UNKNOWN_CLASSIFICATION,
      rejectedCategories: industryScores.slice(0, 3).filter((score) => score.score > 0).map((score) => ({
        category: score.item.label,
        reason: `Rejected because page evidence was too weak: ${[...score.matchedKeywords].slice(0, 5).join(", ")}`
      }))
    };
  }

  if (hasEnoughEvidence(selectedSubIndustry, 10, 1) && selectedIndustry.item.label !== selectedSubIndustry.item.industry) {
    const parentIndustry = industryScores.find((score) => score.item.label === selectedSubIndustry.item.industry);
    const industryConflictIsWeak = selectedIndustry.score < selectedSubIndustry.score * 0.75 || selectedIndustry.strongSignals.size < selectedSubIndustry.strongSignals.size;
    if (parentIndustry && industryConflictIsWeak) {
      rejectedCategories.push(rejectedCategory(selectedIndustry, parentIndustry.item.label, "Rejected broad industry because sub-industry page evidence pointed elsewhere"));
      selectedIndustry = parentIndustry;
    } else {
      const alignedSubIndustry = subIndustryScores.find((score) => score.item.industry === selectedIndustry.item.label && hasEnoughEvidence(score, 8, 1));
      if (alignedSubIndustry) {
        rejectedCategories.push(rejectedCategory(selectedSubIndustry, alignedSubIndustry.item.label, "Rejected sub-industry because it conflicted with stronger industry evidence"));
        selectedSubIndustry = alignedSubIndustry;
      }
    }
  }

  const competingIndustries = industryScores
    .slice(1, 5)
    .filter((score) => score.score >= selectedIndustry.score * 0.55 && score.strongSignals.size > 0 && score.item.label !== selectedIndustry.item.label);
  rejectedCategories.push(...competingIndustries.map((score) =>
    rejectedCategory(score, selectedIndustry.item.label, "Rejected because evidence was weaker or less specific")
  ));

  const competingSubIndustries = subIndustryScores
    .slice(1, 5)
    .filter((score) => score.score >= selectedSubIndustry.score * 0.55 && score.strongSignals.size > 0 && score.item.label !== selectedSubIndustry.item.label);
  rejectedCategories.push(...competingSubIndustries.map((score) =>
    rejectedCategory(score, selectedSubIndustry.item.label, "Rejected because sub-industry evidence was weaker or conflicted with final industry")
  ));

  const selectedBusinessModel = businessModelScores.find((score) =>
    !score.item.allowedIndustries?.length || score.item.allowedIndustries.includes(selectedIndustry.item.label)
  ) ?? businessModelScores[0];

  const confidence = confidenceFor(
    selectedIndustry,
    selectedSubIndustry,
    selectedBusinessModel,
    industryScores.find((score) => score.item.label !== selectedIndustry.item.label)?.score ?? 0,
    subIndustryScores.find((score) => score.item.label !== selectedSubIndustry.item.label)?.score ?? 0,
    businessModelScores.find((score) => score.item.label !== selectedBusinessModel.item.label)?.score ?? 0
  );
  const evidenceKeywords = uniqueValues([
    ...selectedSubIndustry.matchedKeywords,
    ...selectedBusinessModel.matchedKeywords,
    ...selectedIndustry.matchedKeywords
  ]).slice(0, 16);

  return {
    industry: selectedIndustry.item.label,
    subIndustry: selectedSubIndustry.item.label,
    businessModel: selectedBusinessModel.item.label,
    confidence,
    evidenceKeywords,
    rejectedCategories: rejectedCategories.slice(0, 8)
  };
}
