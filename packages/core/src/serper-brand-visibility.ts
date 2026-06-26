/**
 * serper-brand-visibility.ts
 *
 * Uses the Serper.dev Google Search API (SERPER_API_KEY) to measure how well
 * a brand appears in Google organic results and AI Overviews.
 * Returns a normalized 0-100 score that feeds into the aiSearchVisibility pillar.
 */

export interface SerperBrandResult {
  /** 0-100: how prominently the brand appears in search for its own name */
  brandOrganicScore: number;
  /** 0-100: how well the site appears for category-level searches */
  categoryVisibilityScore: number;
  /** Position (1-10) of the brand's own site in brand-name search, or null if not found */
  brandPosition: number | null;
  /** Whether an AI Overview (SGE) snippet was detected for brand-name search */
  aiOverviewDetected: boolean;
  /** Whether the brand appears in the knowledge panel / rich result */
  knowledgePanelDetected: boolean;
  /** Evidence object for audit trails */
  evidence: Record<string, unknown>;
}

const SERPER_TIMEOUT_MS = 12000;

async function callSerper(query: string, key: string): Promise<unknown | null> {
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ q: query, num: 10, gl: "us", hl: "en" }),
      signal: AbortSignal.timeout(SERPER_TIMEOUT_MS)
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function extractOrganicPosition(data: unknown, domain: string): number | null {
  const organic = (data as { organic?: { link?: string }[] })?.organic ?? [];
  const index = organic.findIndex((r) => {
    const linkDomain = domainOf(r?.link ?? "");
    return linkDomain && linkDomain === domain;
  });
  return index >= 0 ? index + 1 : null;
}

function positionToScore(position: number | null): number {
  if (position === null) return 10;
  if (position === 1) return 100;
  if (position === 2) return 88;
  if (position === 3) return 75;
  if (position <= 5) return 60;
  if (position <= 7) return 45;
  return 30;
}

function detectAiOverview(data: unknown): boolean {
  const d = data as Record<string, unknown>;
  // Serper surfaces AI Overviews in answerBox, knowledgeGraph, or organic sitelinks
  return Boolean(d?.answerBox) || Boolean(d?.aiOverview);
}

function detectKnowledgePanel(data: unknown): boolean {
  return Boolean((data as Record<string, unknown>)?.knowledgeGraph);
}

/**
 * Fetch brand visibility from Serper. Falls back to a neutral 50 if the API
 * key is missing or the request fails — never crashes the main report generation.
 */
export async function fetchBrandVisibility(
  brandName: string,
  websiteUrl: string
): Promise<SerperBrandResult> {
  const key = process.env.SERPER_API_KEY;

  if (!key) {
    return {
      brandOrganicScore: 50,
      categoryVisibilityScore: 50,
      brandPosition: null,
      aiOverviewDetected: false,
      knowledgePanelDetected: false,
      evidence: { skipped: true, reason: "SERPER_API_KEY not configured" }
    };
  }

  const domain = domainOf(websiteUrl);

  // Query 1: brand-name search (e.g. "Acme Corp")
  const brandData = await callSerper(brandName, key);

  // Query 2: brand + "review" to capture brand sentiment / category intent
  const reviewData = await callSerper(`${brandName} review`, key);

  const brandPosition = brandData ? extractOrganicPosition(brandData, domain) : null;
  const reviewPosition = reviewData ? extractOrganicPosition(reviewData, domain) : null;

  const brandOrganicScore = positionToScore(brandPosition);

  // Category visibility: average of brand search score and review search score
  const reviewScore = positionToScore(reviewPosition);
  const categoryVisibilityScore = Math.round((brandOrganicScore * 0.6 + reviewScore * 0.4));

  const aiOverviewDetected = detectAiOverview(brandData) || detectAiOverview(reviewData);
  const knowledgePanelDetected = detectKnowledgePanel(brandData);

  // AI Overview / Knowledge Panel boosts
  let finalBrandScore = brandOrganicScore;
  if (aiOverviewDetected) finalBrandScore = Math.min(100, finalBrandScore + 10);
  if (knowledgePanelDetected) finalBrandScore = Math.min(100, finalBrandScore + 8);

  return {
    brandOrganicScore: Math.round(finalBrandScore),
    categoryVisibilityScore: Math.min(100, categoryVisibilityScore),
    brandPosition,
    aiOverviewDetected,
    knowledgePanelDetected,
    evidence: {
      domain,
      brandQuery: brandName,
      brandPosition,
      reviewPosition,
      aiOverviewDetected,
      knowledgePanelDetected,
      brandOrganicScore: Math.round(finalBrandScore),
      categoryVisibilityScore: Math.min(100, categoryVisibilityScore)
    }
  };
}
