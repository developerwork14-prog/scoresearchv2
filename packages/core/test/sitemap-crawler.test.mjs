import assert from "node:assert/strict";
import { crawlSite, fetchSitemapUrls } from "../dist/site-crawler.js";

const originalFetch = globalThis.fetch;

function xmlResponse(body, url) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/xml" }
  });
}

function notFound(url) {
  return new Response("", { status: 404, headers: { "content-type": "text/plain" } });
}

const routes = new Map([
  ["https://example.com/robots.txt", "Sitemap: https://example.com/sitemap_index.xml"],
  ["https://example.com/sitemap_index.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap>
      <sitemap><loc>https://example.com/page-sitemap.xml</loc></sitemap>
    </sitemapindex>`],
  ["https://example.com/post-sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/blog/a</loc></url>
      <url><loc>https://example.com/blog/b?utm_source=test</loc></url>
      <url><loc>https://example.com/image.jpg</loc></url>
    </urlset>`],
  ["https://example.com/page-sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/about</loc></url>
      <url><loc>https://cdn.example.com/offsite</loc></url>
    </urlset>`]
]);

globalThis.fetch = async (url) => {
  const value = typeof url === "string" ? url : url.url;
  const body = routes.get(value);
  return body ? xmlResponse(body, value) : notFound(value);
};

try {
  const result = await fetchSitemapUrls("https://example.com", 1000, 10);
  assert.deepEqual(result.urls.sort(), [
    "https://example.com/about",
    "https://example.com/blog/a"
  ].sort());
  assert.equal(result.summary.discoveryMethod, "robots.txt");
  assert.equal(result.summary.sitemapsFound, 3);
  assert.equal(result.summary.sitemapsDiscovered, 2);

  const limited = await fetchSitemapUrls("https://example.com", 1000, 1);
  assert.deepEqual(limited.urls, []);
  assert.equal(limited.summary.sitemapsFound, 1);

  globalThis.fetch = async (_url, init = {}) => new Promise((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const started = Date.now();
  const bounded = await crawlSite("https://slow.example.com", {
    maxPages: 200,
    timeoutMs: 1000,
    overallTimeoutMs: 40,
    maxSitemapFiles: 100,
    followInternalLinks: true
  });
  assert.ok(Date.now() - started < 500);
  assert.equal(bounded.pages.length, 0);

  console.log("sitemap crawler tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
