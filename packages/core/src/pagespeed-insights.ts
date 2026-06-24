export type PageSpeedStrategy = "mobile" | "desktop";

export interface PageSpeedMetrics {
  lcp?: number;
  inp?: number;
  cls?: number;
  fcp?: number;
  speedIndex?: number;
  tbt?: number;
  ttfb?: number;
  performanceScore?: number;
  tti?: number;
  tapTargetsPass?: boolean;
  lcpElementFound?: boolean;
  lcpElementUrl?: string;
  lcpLazyLoadedPass?: boolean;
  modernImagePass?: boolean;
  optimizedImagePass?: boolean;
  unusedJsSavingsBytes?: number;
  unusedCssSavingsBytes?: number;
  thirdPartyBlockingTime?: number;
  checkedAt: string;
}

export interface PageSpeedSnapshot {
  website: string;
  performanceScore?: number;
  mobileLcp?: number;
  desktopLcp?: number;
  cls?: number;
  inp?: number;
  ttfb?: number;
  fcp?: number;
  speedIndex?: number;
  tbt?: number;
  checkedAt: string;
}

const PAGESPEED_TIMEOUT_MS = 45000;

function apiKey(...names: string[]) {
  return names.map((name) => process.env[name]).find(Boolean);
}

function metricPercentile(metrics: Record<string, { percentile?: number }> | undefined, name: string) {
  const value = metrics?.[name]?.percentile;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizedCls(value?: number) {
  if (value === undefined) return undefined;
  return value > 1 ? value / 100 : value;
}

function firstNumber(...values: Array<number | undefined>) {
  return values.find((value) => typeof value === "number" && Number.isFinite(value));
}

function lcpElementUrl(details: unknown) {
  if (!details || typeof details !== "object") return undefined;
  const items = (details as { items?: unknown[] }).items;
  const first = items?.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
  if (!first) return undefined;
  const directUrl = String(first.url ?? first.currentSrc ?? "").trim();
  if (/^https?:\/\//i.test(directUrl)) return directUrl;
  const node = first.node && typeof first.node === "object" ? first.node as Record<string, unknown> : {};
  const snippet = String(node.snippet ?? first.snippet ?? "");
  const match = snippet.match(/\s(?:src|href)=["']([^"']+)["']/i);
  const candidate = String(node.lhId ?? match?.[1] ?? "").trim();
  return /^https?:\/\//i.test(candidate) ? candidate : undefined;
}

export async function fetchPageSpeedInsights(url: string, strategy: PageSpeedStrategy = "mobile"): Promise<PageSpeedMetrics | null> {
  const key = apiKey("PAGESPEED_API_KEY", "GOOGLE_API_KEY");
  if (!key) return null;
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("category", "performance");
  endpoint.searchParams.set("key", key);

  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(PAGESPEED_TIMEOUT_MS) });
    if (!response.ok) return null;
    const data = await response.json() as {
      loadingExperience?: {
        metrics?: Record<string, { percentile?: number }>;
      };
      originLoadingExperience?: {
        metrics?: Record<string, { percentile?: number }>;
      };
      lighthouseResult?: {
        categories?: { performance?: { score?: number } };
        audits?: Record<string, { numericValue?: number; score?: number; details?: { overallSavingsBytes?: number } }>;
      };
    };
    const fieldMetrics = data.loadingExperience?.metrics ?? data.originLoadingExperience?.metrics;
    const audits = data.lighthouseResult?.audits ?? {};
    const lcp = firstNumber(metricPercentile(fieldMetrics, "LARGEST_CONTENTFUL_PAINT_MS"), audits["largest-contentful-paint"]?.numericValue);
    const inp = metricPercentile(fieldMetrics, "INTERACTION_TO_NEXT_PAINT_MS");
    const cls = normalizedCls(firstNumber(metricPercentile(fieldMetrics, "CUMULATIVE_LAYOUT_SHIFT_SCORE"), audits["cumulative-layout-shift"]?.numericValue));
    const fcp = firstNumber(metricPercentile(fieldMetrics, "FIRST_CONTENTFUL_PAINT_MS"), audits["first-contentful-paint"]?.numericValue);
    const ttfb = firstNumber(metricPercentile(fieldMetrics, "EXPERIMENTAL_TIME_TO_FIRST_BYTE"), audits["server-response-time"]?.numericValue);

    return {
      lcp,
      inp,
      cls,
      fcp,
      ttfb,
      speedIndex: audits["speed-index"]?.numericValue,
      tbt: audits["total-blocking-time"]?.numericValue,
      tti: audits.interactive?.numericValue,
      performanceScore: data.lighthouseResult?.categories?.performance?.score !== undefined
        ? Math.round(data.lighthouseResult.categories.performance.score * 100)
        : undefined,
      tapTargetsPass: audits["tap-targets"]?.score === undefined ? undefined : audits["tap-targets"]?.score === 1,
      lcpElementFound: audits["largest-contentful-paint-element"] === undefined ? undefined : audits["largest-contentful-paint-element"]?.score !== 0,
      lcpElementUrl: lcpElementUrl(audits["largest-contentful-paint-element"]?.details),
      lcpLazyLoadedPass: audits["lcp-lazy-loaded"]?.score === undefined ? undefined : audits["lcp-lazy-loaded"]?.score === 1,
      modernImagePass: audits["uses-webp-images"]?.score === undefined ? undefined : audits["uses-webp-images"]?.score === 1,
      optimizedImagePass: audits["uses-optimized-images"]?.score === undefined ? undefined : audits["uses-optimized-images"]?.score === 1,
      unusedJsSavingsBytes: audits["unused-javascript"]?.details?.overallSavingsBytes,
      unusedCssSavingsBytes: audits["unused-css-rules"]?.details?.overallSavingsBytes,
      thirdPartyBlockingTime: audits["third-party-summary"]?.numericValue,
      checkedAt: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

export function pageSpeedSnapshot(website: string, mobile: PageSpeedMetrics | null, desktop: PageSpeedMetrics | null): PageSpeedSnapshot | undefined {
  if (!mobile && !desktop) return undefined;
  return {
    website,
    performanceScore: mobile?.performanceScore ?? desktop?.performanceScore,
    mobileLcp: mobile?.lcp,
    desktopLcp: desktop?.lcp,
    cls: mobile?.cls ?? desktop?.cls,
    inp: mobile?.inp ?? desktop?.inp,
    ttfb: mobile?.ttfb ?? desktop?.ttfb,
    fcp: mobile?.fcp ?? desktop?.fcp,
    speedIndex: mobile?.speedIndex ?? desktop?.speedIndex,
    tbt: mobile?.tbt ?? desktop?.tbt,
    checkedAt: mobile?.checkedAt ?? desktop?.checkedAt ?? new Date().toISOString()
  };
}
