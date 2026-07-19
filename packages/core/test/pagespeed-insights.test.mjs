import assert from "node:assert/strict";
import { fetchPageSpeedInsights, fetchPageSpeedInsightsDetailed } from "../dist/pagespeed-insights.js";

const originalFetch = globalThis.fetch;
const originalPageSpeedKey = process.env.PAGESPEED_API_KEY;
const originalGoogleKey = process.env.GOOGLE_API_KEY;

function psiResponse(score = 0.91) {
  return {
    ok: true,
    async json() {
      return {
        lighthouseResult: {
          categories: { performance: { score } },
          audits: {
            "largest-contentful-paint": { numericValue: 2100 },
            "first-contentful-paint": { numericValue: 1200 },
            "cumulative-layout-shift": { numericValue: 0.04 },
            "server-response-time": { numericValue: 180 },
            "speed-index": { numericValue: 2600 },
            "total-blocking-time": { numericValue: 90 }
          }
        }
      };
    }
  };
}

try {
  delete process.env.PAGESPEED_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  const publicCalls = [];
  globalThis.fetch = async (url) => {
    publicCalls.push(String(url));
    return psiResponse();
  };

  const publicResult = await fetchPageSpeedInsights("https://example.com/", "mobile");
  assert.equal(publicResult.performanceScore, 91);
  assert.equal(publicResult.lcp, 2100);
  assert.equal(publicCalls.length, 1);
  assert.equal(publicCalls[0].includes("key="), false);

  process.env.PAGESPEED_API_KEY = "configured-key";
  const fallbackCalls = [];
  globalThis.fetch = async (url) => {
    fallbackCalls.push(String(url));
    return fallbackCalls.length === 1
      ? { ok: false, status: 500, async json() { return { error: { message: "Temporary failure" } }; } }
      : psiResponse(0.84);
  };

  const fallbackResult = await fetchPageSpeedInsights("https://example.com/", "desktop");
  assert.equal(fallbackResult.performanceScore, 84);
  assert.equal(fallbackCalls.length, 2);
  assert.equal(fallbackCalls[0].includes("key=configured-key"), true);
  assert.equal(fallbackCalls[1].includes("key="), false);

  const failedCalls = [];
  globalThis.fetch = async () => {
    failedCalls.push(true);
    return failedCalls.length === 1
      ? {
          ok: false,
          status: 400,
          async json() {
            return { error: { status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } };
          }
        }
      : {
          ok: false,
          status: 429,
          async json() {
            return { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for quota metric 'Queries'.", details: [{ reason: "RATE_LIMIT_EXCEEDED" }] } };
          }
        };
  };

  const failedResult = await fetchPageSpeedInsightsDetailed("https://example.com/", "mobile");
  assert.equal(failedResult.metrics, null);
  assert.match(failedResult.unavailableReason, /API key is invalid/i);
  assert.match(failedResult.unavailableReason, /quota was exceeded/i);
} finally {
  globalThis.fetch = originalFetch;
  if (originalPageSpeedKey === undefined) delete process.env.PAGESPEED_API_KEY;
  else process.env.PAGESPEED_API_KEY = originalPageSpeedKey;
  if (originalGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = originalGoogleKey;
}
