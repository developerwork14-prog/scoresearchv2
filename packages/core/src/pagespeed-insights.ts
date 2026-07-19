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

export interface PageSpeedFetchResult {
  metrics: PageSpeedMetrics | null;
  unavailableReason?: string;
}

export interface PageSpeedSnapshot {
  website: string;
  performanceScore?: number;
  mobilePerformanceScore?: number;
  desktopPerformanceScore?: number;
  mobileLcp?: number;
  desktopLcp?: number;
  cls?: number;
  inp?: number;
  ttfb?: number;
  fcp?: number;
  speedIndex?: number;
  tbt?: number;
  checkedAt: string;
  source?: "PageSpeed Insights" | "Local Browser" | "Crawl Timing";
  unavailableReason?: string;
}

const PAGESPEED_TIMEOUT_MS = 15000;
const LOCAL_PERFORMANCE_TIMEOUT_MS = 18000;

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
  return (await fetchPageSpeedInsightsDetailed(url, strategy)).metrics;
}

function pageSpeedErrorReason(status: number, data: unknown, keyed: boolean) {
  const error = data && typeof data === "object" ? (data as { error?: { status?: string; message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } }).error : undefined;
  const reason = error?.details?.[0]?.reason ?? error?.errors?.[0]?.reason ?? error?.status;
  const message = String(error?.message ?? "").trim();
  if (reason === "API_KEY_INVALID") return "Configured PageSpeed API key is invalid. Update PAGESPEED_API_KEY or GOOGLE_API_KEY.";
  if (/quota|rate/i.test(`${reason} ${message}`)) return `${keyed ? "Configured PageSpeed API key" : "Public PageSpeed fallback"} quota was exceeded.`;
  if (message) return `PageSpeed Insights ${keyed ? "keyed" : "public"} request failed: ${message}`;
  return `PageSpeed Insights ${keyed ? "keyed" : "public"} request failed with HTTP ${status}.`;
}

function combineReasons(reasons: string[]) {
  return [...new Set(reasons.filter(Boolean))].join(" ");
}

function scoreMetric(value: number | undefined, good: number, poor: number) {
  if (value === undefined || !Number.isFinite(value)) return 0.5;
  if (value <= good) return 1;
  if (value >= poor) return 0;
  return 1 - (value - good) / (poor - good);
}

function syntheticPerformanceScore(metrics: Pick<PageSpeedMetrics, "fcp" | "lcp" | "cls" | "tbt" | "speedIndex">) {
  const weighted =
    scoreMetric(metrics.fcp, 1800, 3000) * 0.1
    + scoreMetric(metrics.speedIndex, 3400, 5800) * 0.1
    + scoreMetric(metrics.lcp, 2500, 4000) * 0.25
    + scoreMetric(metrics.tbt, 200, 600) * 0.3
    + scoreMetric(metrics.cls, 0.1, 0.25) * 0.25;
  return Math.max(0, Math.min(100, Math.round(weighted * 100)));
}

export async function fetchLocalPerformanceMetrics(url: string, strategy: PageSpeedStrategy = "mobile"): Promise<PageSpeedFetchResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<PageSpeedFetchResult>((resolve) => {
      timeout = setTimeout(() => resolve({ metrics: null, unavailableReason: "Local browser performance fallback timed out." }), LOCAL_PERFORMANCE_TIMEOUT_MS);
    });
    const work = (async (): Promise<PageSpeedFetchResult> => {
      const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
      const lighthouseModule = await dynamicImport("lighthouse") as {
        default: (url: string, flags: Record<string, unknown>, config?: unknown) => Promise<{
          lhr: {
            categories: { performance?: { score?: number | null } };
            audits: Record<string, { numericValue?: number; score?: number; details?: { overallSavingsBytes?: number } }>;
          };
        }>;
        desktopConfig?: unknown;
      };
      const chromeLauncher = await dynamicImport("chrome-launcher") as {
        launch(options: { chromeFlags: string[] }): Promise<{ port: number; kill(): Promise<void> }>;
      };
      const chrome = await chromeLauncher.launch({
        chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"]
      });
      try {
        const result = await lighthouseModule.default(url, {
          port: chrome.port,
          output: "json",
          onlyCategories: ["performance"],
          logLevel: "error",
          maxWaitForLoad: LOCAL_PERFORMANCE_TIMEOUT_MS - 3000
        }, strategy === "desktop" ? lighthouseModule.desktopConfig : undefined);
        const audits = result.lhr.audits ?? {};
        const metric = (name: string) => audits[name]?.numericValue;
        const metrics: PageSpeedMetrics = {
          fcp: metric("first-contentful-paint"),
          lcp: metric("largest-contentful-paint"),
          cls: metric("cumulative-layout-shift"),
          ttfb: metric("server-response-time"),
          speedIndex: metric("speed-index"),
          tbt: metric("total-blocking-time"),
          tti: metric("interactive"),
          performanceScore: result.lhr.categories.performance?.score !== undefined && result.lhr.categories.performance.score !== null
            ? Math.round(result.lhr.categories.performance.score * 100)
            : undefined,
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
        return { metrics };
      } finally {
        await Promise.race([chrome.kill(), new Promise((resolve) => setTimeout(resolve, 1000))]);
      }
    })();
    return await Promise.race([work, timeoutPromise]);
  } catch (error) {
    return { metrics: null, unavailableReason: error instanceof Error ? `Local browser performance fallback failed: ${error.message}` : "Local browser performance fallback failed." };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function fetchPageSpeedInsightsDetailed(url: string, strategy: PageSpeedStrategy = "mobile"): Promise<PageSpeedFetchResult> {
  const key = apiKey("PAGESPEED_API_KEY", "GOOGLE_API_KEY");
  const endpointFor = (includeKey: boolean) => {
    const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("strategy", strategy);
    endpoint.searchParams.set("category", "performance");
    if (includeKey && key) endpoint.searchParams.set("key", key);
    return endpoint;
  };
  const parseResponse = async (endpoint: URL, keyed: boolean): Promise<PageSpeedFetchResult> => {
    let response: Response;
    try {
      response = await fetch(endpoint, { signal: AbortSignal.timeout(PAGESPEED_TIMEOUT_MS) });
    } catch {
      return { metrics: null, unavailableReason: `PageSpeed Insights ${keyed ? "keyed" : "public"} request could not reach Google.` };
    }
    const data = await response.json().catch(() => null) as {
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
    } | null;
    if (!response.ok) {
      return { metrics: null, unavailableReason: pageSpeedErrorReason(response.status, data, keyed) };
    }
    if (!data) return { metrics: null, unavailableReason: "PageSpeed Insights returned an unreadable response." };
    const fieldMetrics = data.loadingExperience?.metrics ?? data.originLoadingExperience?.metrics;
    const audits = data.lighthouseResult?.audits ?? {};
    const lcp = firstNumber(metricPercentile(fieldMetrics, "LARGEST_CONTENTFUL_PAINT_MS"), audits["largest-contentful-paint"]?.numericValue);
    const inp = metricPercentile(fieldMetrics, "INTERACTION_TO_NEXT_PAINT_MS");
    const cls = normalizedCls(firstNumber(metricPercentile(fieldMetrics, "CUMULATIVE_LAYOUT_SHIFT_SCORE"), audits["cumulative-layout-shift"]?.numericValue));
    const fcp = firstNumber(metricPercentile(fieldMetrics, "FIRST_CONTENTFUL_PAINT_MS"), audits["first-contentful-paint"]?.numericValue);
    const ttfb = firstNumber(metricPercentile(fieldMetrics, "EXPERIMENTAL_TIME_TO_FIRST_BYTE"), audits["server-response-time"]?.numericValue);

    return { metrics: {
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
    } };
  };

  const reasons: string[] = [];
  const keyed = key ? await parseResponse(endpointFor(true), true) : null;
  if (keyed?.metrics) return keyed;
  if (keyed?.unavailableReason) reasons.push(keyed.unavailableReason);
  const fallback = await parseResponse(endpointFor(false), false);
  if (fallback.metrics) return fallback;
  if (fallback.unavailableReason) reasons.push(fallback.unavailableReason);
  return { metrics: null, unavailableReason: combineReasons(reasons) || "PageSpeed Insights data unavailable." };
}

export function pageSpeedSnapshot(
  website: string,
  mobile: PageSpeedMetrics | null,
  desktop: PageSpeedMetrics | null,
  fallback: { ttfb?: number; checkedAt?: string; unavailableReason?: string } = {}
): PageSpeedSnapshot | undefined {
  if (!mobile && !desktop) {
    if (fallback.ttfb === undefined) return undefined;
    return {
      website,
      ttfb: fallback.ttfb,
      checkedAt: fallback.checkedAt ?? new Date().toISOString(),
      source: "Crawl Timing",
      unavailableReason: fallback.unavailableReason ?? "PageSpeed Insights data unavailable."
    };
  }
  return {
    website,
    performanceScore: mobile?.performanceScore ?? desktop?.performanceScore,
    mobilePerformanceScore: mobile?.performanceScore,
    desktopPerformanceScore: desktop?.performanceScore,
    mobileLcp: mobile?.lcp,
    desktopLcp: desktop?.lcp,
    cls: mobile?.cls ?? desktop?.cls,
    inp: mobile?.inp ?? desktop?.inp,
    ttfb: mobile?.ttfb ?? desktop?.ttfb,
    fcp: mobile?.fcp ?? desktop?.fcp,
    speedIndex: mobile?.speedIndex ?? desktop?.speedIndex,
    tbt: mobile?.tbt ?? desktop?.tbt,
    checkedAt: mobile?.checkedAt ?? desktop?.checkedAt ?? new Date().toISOString(),
    source: "PageSpeed Insights"
  };
}
