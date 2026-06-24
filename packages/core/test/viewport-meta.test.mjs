import assert from "node:assert/strict";
import { createServer } from "node:http";
import * as cheerio from "cheerio";
import {
  crawlabilityRecommendation,
  dedupeBrokenLinkEvidence,
  excludedBrokenLinkHref,
  hasImagePreloadHint,
  isBrokenLinkStatus,
  isModernLcpImageUrl,
  isPermanentRedirectStatus,
  linkElementsByRel,
  linkHrefByRel,
  metaContentByName,
  robotsTxtStatusPass,
  sitemapDirectivePass,
  sitemapDirectivesFromRobots,
  technicalBusinessImpact,
  technicalFailureDescription,
  technicalIssueSummary,
  technicalValidationSummary,
  validateBrokenLink,
  viewportMetaDebug
} from "../dist/technical-audit.js";

const cases = [
  {
    name: "passes width=device-width with initial scale",
    html: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head></html>',
    expected: { viewportFound: true, viewportContent: "width=device-width, initial-scale=1", passed: true }
  },
  {
    name: "passes width=device-width only",
    html: '<html><head><meta name="viewport" content="width=device-width"></head></html>',
    expected: { viewportFound: true, viewportContent: "width=device-width", passed: true }
  },
  {
    name: "passes initial-scale and user-scalable without width",
    html: '<html><head><meta name="viewport" content="initial-scale=1,user-scalable=yes"></head></html>',
    expected: { viewportFound: true, viewportContent: "initial-scale=1,user-scalable=yes", passed: true }
  },
  {
    name: "passes uppercase name attribute",
    html: '<html><head><meta NAME="viewport" content="width=device-width"></head></html>',
    expected: { viewportFound: true, viewportContent: "width=device-width", passed: true }
  },
  {
    name: "passes mixed-case viewport value",
    html: '<html><head><meta name="ViewPort" content="initial-scale=1"></head></html>',
    expected: { viewportFound: true, viewportContent: "initial-scale=1", passed: true }
  },
  {
    name: "fails without viewport tag",
    html: "<html><head></head></html>",
    expected: { viewportFound: false, viewportContent: "", passed: false }
  },
  {
    name: "fails with empty content",
    html: '<html><head><meta name="viewport" content="   "></head></html>',
    expected: { viewportFound: true, viewportContent: "", passed: false }
  },
  {
    name: "fails with missing content",
    html: '<html><head><meta name="viewport"></head></html>',
    expected: { viewportFound: true, viewportContent: "", passed: false }
  }
];

for (const item of cases) {
  const result = viewportMetaDebug(cheerio.load(item.html));
  assert.equal(result.viewportFound, item.expected.viewportFound, item.name);
  assert.equal(result.viewportContent, item.expected.viewportContent, item.name);
  assert.equal(result.passed, item.expected.passed, item.name);
  if (item.expected.viewportFound) assert.match(result.rawViewportTag, /<meta/i, item.name);
}

{
  const $ = cheerio.load(`
    <html>
      <head>
        <meta NAME="Description" content="A useful page description">
        <meta name="twitter:CARD" content="summary_large_image">
        <link REL="canonical" href="https://example.com/page/">
        <link rel="preload stylesheet" as="style" href="/app.css">
        <link rel="PRELOAD" as="image" href="/hero.webp">
      </head>
    </html>
  `);

  assert.equal(metaContentByName($, "description"), "A useful page description");
  assert.equal(metaContentByName($, "twitter:card"), "summary_large_image");
  assert.equal(linkHrefByRel($, "canonical"), "https://example.com/page/");
  assert.equal(linkElementsByRel($, "preload").length, 2);
}

{
  const hrefPreload = cheerio.load('<link rel="preload" as="image" href="/hero.webp">');
  const srcsetPreload = cheerio.load('<link rel="preload" as="image" imageSrcSet="/hero-640.png 640w, /hero-1280.png 1280w" fetchPriority="high">');
  const missingSource = cheerio.load('<link rel="preload" as="image">');
  const wrongAs = cheerio.load('<link rel="preload" as="script" href="/app.js">');

  assert.equal(hasImagePreloadHint(hrefPreload), true, "href image preload is valid");
  assert.equal(hasImagePreloadHint(srcsetPreload), true, "imageSrcSet image preload is valid");
  assert.equal(hasImagePreloadHint(missingSource), false, "image preload requires href or imageSrcSet");
  assert.equal(hasImagePreloadHint(wrongAs), false, "preload must be as=image");
}

assert.equal(isModernLcpImageUrl("/Group1000001631.png"), false);
assert.equal(isModernLcpImageUrl("/hero.jpg"), false);
assert.equal(isModernLcpImageUrl("/hero.jpeg"), false);
assert.equal(isModernLcpImageUrl("/hero.gif"), false);
assert.equal(isModernLcpImageUrl("/hero.webp"), true);
assert.equal(isModernLcpImageUrl("/hero.avif?width=1200"), true);

assert.equal(robotsTxtStatusPass(200), true);
assert.equal(robotsTxtStatusPass(301), true);
assert.equal(robotsTxtStatusPass(403), false);
assert.equal(robotsTxtStatusPass(404), false);
assert.equal(robotsTxtStatusPass(500), false);
assert.equal(robotsTxtStatusPass(undefined), false);

assert.equal(sitemapDirectivePass("https://example.com/sitemap.xml", 200), true);
assert.equal(sitemapDirectivePass("https://example.com/sitemap_index.xml", 200), true);
assert.equal(sitemapDirectivePass("https://example.com/post-sitemap.xml", 200), true);
assert.equal(sitemapDirectivePass("https://example.com/sitemap-index.xml", 200), true);
assert.equal(sitemapDirectivePass("", 200), false);
assert.equal(sitemapDirectivePass("https://example.com/sitemap.xml", 404), false);
assert.equal(sitemapDirectivePass("/sitemap.xml", 200), false);
assert.equal(sitemapDirectivePass("not a url", 200), false);
assert.deepEqual(sitemapDirectivesFromRobots("User-agent: *\nSitemap: https://example.com/sitemap_index.xml\nSitemap: https://example.com/post-sitemap.xml"), [
  "https://example.com/sitemap_index.xml",
  "https://example.com/post-sitemap.xml"
]);

for (const status of [404, 410, 500, 502, 503, 504, "DNS Error", "Connection Error", "Timeout"]) {
  assert.equal(isBrokenLinkStatus(status), true, `${status} is classified as broken`);
}
for (const status of [200, 301, 302, 307, 308, 400, 401, 403, 429, 501, 505, 599]) {
  assert.equal(isBrokenLinkStatus(status), false, `${status} is not classified as broken`);
}
for (const status of [301, 308]) {
  assert.equal(isPermanentRedirectStatus(status), true, `${status} is classified as permanent`);
}
for (const status of [200, 302, 303, 307, 404, undefined]) {
  assert.equal(isPermanentRedirectStatus(status), false, `${status} is not classified as permanent`);
}
for (const href of ["/cdn-cgi/trace", "/wp-admin/", "/wp-content/image.png", "/blog/wp-content/image.png", "/wp-json/posts", "mailto:test@example.com", "tel:+15551234567", "javascript:void(0)", "#contact"]) {
  assert.equal(excludedBrokenLinkHref(href), true, `${href} is excluded`);
}
assert.equal(excludedBrokenLinkHref("/contact-us/"), false);

{
  let slowFinalRequests = 0;
  let transientServerErrorRequests = 0;
  const server = createServer((request, response) => {
    const redirectStatus = request.url?.match(/^\/redirect-(301|302|307|308)\/$/)?.[1];
    if (redirectStatus) {
      response.writeHead(Number(redirectStatus), { location: "/grievance/" }).end();
      return;
    }
    if (request.url === "/grievance/") {
      response.writeHead(200).end("ok");
      return;
    }
    if (request.url === "/old-contact/") {
      response.writeHead(302, { location: "/missing/" }).end();
      return;
    }
    if (request.url === "/slow-redirect/") {
      response.writeHead(301, { location: "/slow-final/" }).end();
      return;
    }
    if (request.url === "/slow-final/") {
      slowFinalRequests += 1;
      if (slowFinalRequests === 1) {
        setTimeout(() => response.writeHead(200).end("ok"), 80);
        return;
      }
      response.writeHead(200).end("ok");
      return;
    }
    if (request.url === "/transient-server-error/") {
      transientServerErrorRequests += 1;
      response.writeHead(transientServerErrorRequests === 1 ? 500 : 200).end();
      return;
    }
    if (request.url === "/persistent-server-error/") {
      response.writeHead(500).end();
      return;
    }
    response.writeHead(404).end("missing");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    for (const status of [301, 302, 307, 308]) {
      const redirectedPass = await validateBrokenLink(`${origin}/redirect-${status}/`);
      assert.equal(redirectedPass.broken, false, `${status} → 200 passes`);
      assert.equal(redirectedPass.finalUrl, `${origin}/grievance/`);
      assert.equal(redirectedPass.finalStatus, 200);
      assert.equal(redirectedPass.redirectHops, 1);
    }

    const redirectedFailure = await validateBrokenLink(`${origin}/old-contact/`);
    assert.equal(redirectedFailure.broken, true);
    assert.equal(redirectedFailure.finalUrl, `${origin}/missing/`);
    assert.equal(redirectedFailure.finalStatus, 404);
    assert.equal(redirectedFailure.redirectHops, 1);

    const directFailure = await validateBrokenLink(`${origin}/missing/`);
    assert.equal(directFailure.broken, true);
    assert.equal(directFailure.finalUrl, `${origin}/missing/`);
    assert.equal(directFailure.finalStatus, 404);
    assert.equal(directFailure.redirectHops, 0);

    const recoveredServerError = await validateBrokenLink(`${origin}/transient-server-error/`);
    assert.equal(recoveredServerError.broken, false);
    assert.equal(recoveredServerError.finalStatus, 200);

    const confirmedServerError = await validateBrokenLink(`${origin}/persistent-server-error/`);
    assert.equal(confirmedServerError.broken, true);
    assert.equal(confirmedServerError.finalStatus, 500);

    const confirmedAfterTransientTimeout = await validateBrokenLink(`${origin}/slow-redirect/`, 20);
    assert.equal(confirmedAfterTransientTimeout.broken, false);
    assert.equal(confirmedAfterTransientTimeout.finalUrl, `${origin}/slow-final/`);
    assert.equal(confirmedAfterTransientTimeout.finalStatus, 200);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

assert.deepEqual(dedupeBrokenLinkEvidence([
  { brokenUrl: "https://example.com/missing/", sourcePage: "https://example.com/", location: "navigation" },
  { brokenUrl: "https://example.com/missing/", sourcePage: "https://example.com/", location: "navigation" },
  { brokenUrl: "https://example.com/missing/", sourcePage: "https://example.com/about/", location: "navigation" }
]), [
  { brokenUrl: "https://example.com/missing/", sourcePage: "https://example.com/", location: "navigation" },
  { brokenUrl: "https://example.com/missing/", sourcePage: "https://example.com/about/", location: "navigation" }
]);

assert.equal(crawlabilityRecommendation(10), "Allow public access to robots.txt and return HTTP 200.");
assert.match(crawlabilityRecommendation(35), /broken internal link/i);
assert.match(crawlabilityRecommendation(132), /accessible without interaction/i);
assert.doesNotMatch(crawlabilityRecommendation(35), /check the evidence|run the audit again/i);
for (const id of [10, 11, 12, 13, 14, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 96, 97, 98, 99, 114, 122, 123, 125, 130, 131, 132, 140, 141, 217]) {
  assert.ok(crawlabilityRecommendation(id), `crawlability check ${id} has a dedicated recommendation`);
}

assert.equal(
  technicalFailureDescription(10, JSON.stringify({ sampleEvidence: [{ status: 403 }] })),
  "robots.txt returned HTTP 403."
);
assert.match(
  technicalFailureDescription(11, JSON.stringify({ sampleEvidence: [{ directive: "https://example.com/sitemap.xml", status: 404 }] })),
  /detected Sitemap directive is unreachable/
);
assert.match(
  technicalFailureDescription(11, JSON.stringify({ sampleEvidence: [{ directive: "/sitemap.xml", status: "Malformed URL", malformed: true }] })),
  /Sitemap directive is malformed/
);
assert.match(
  technicalFailureDescription(35, JSON.stringify({ sampleEvidence: [{ brokenUrl: "https://example.com/missing", sourcePage: "https://example.com/" }] })),
  /https:\/\/example\.com\/missing.*https:\/\/example\.com\//
);
assert.equal(
  technicalIssueSummary(35, true, JSON.stringify({ brokenLinks: 0 })),
  "No broken internal links found."
);
assert.equal(
  technicalIssueSummary(35, false, JSON.stringify({ brokenLinks: 3 })),
  "3 unique broken internal URLs detected."
);
assert.equal(
  technicalIssueSummary(35, false, JSON.stringify({ brokenLinks: 1 })),
  "1 unique broken internal URL detected."
);
assert.doesNotMatch(
  technicalIssueSummary(35, false, JSON.stringify({ brokenLinks: 2 })),
  /requires corrective action/i
);
const robotsEvidence = JSON.stringify({
  pagesCrawled: 10,
  pagesChecked: 1,
  pagesFailed: 1,
  sampleEvidence: [{
    requestedUrl: "https://example.com/robots.txt",
    observed: 403,
    expected: "HTTP 200",
    status: 403
  }]
});
assert.deepEqual(technicalValidationSummary(10, false, robotsEvidence).slice(3, 6), [
  "Requested URL: https://example.com/robots.txt",
  "Observed Status: 403",
  "Expected Status: 200"
]);
assert.equal(
  technicalFailureDescription(10, JSON.stringify({ sampleEvidence: [{ status: "Timeout" }] })),
  "robots.txt failed: Timeout."
);
assert.match(technicalBusinessImpact(10), /Crawler access risk/);
assert.match(technicalBusinessImpact(11), /URL discovery risk/);
assert.match(technicalBusinessImpact(35), /dead-end user journeys/);
assert.match(technicalBusinessImpact(140), /index less content than users see/);

const repeatedBrokenLinkEvidence = JSON.stringify({
  pagesCrawled: 157,
  pagesChecked: 157,
  pagesFailed: 157,
  passRate: 0,
  uniqueBrokenUrls: 1,
  brokenLinks: 1,
  brokenUrlGroups: [{
    brokenUrl: "https://example.com/contact-us/",
    affectedPages: 157,
    locations: ["shared navigation"],
    sampleAffectedPages: ["https://example.com/"]
  }],
  sampleEvidence: [{
    brokenUrl: "https://example.com/contact-us/",
    affectedPages: 157,
    locations: ["shared navigation"]
  }]
});
assert.equal(
  technicalIssueSummary(35, false, repeatedBrokenLinkEvidence),
  "1 unique broken internal URL detected across 157 affected pages."
);
assert.ok(technicalValidationSummary(35, false, repeatedBrokenLinkEvidence).includes("Unique Broken URLs: 1"));
assert.ok(technicalValidationSummary(35, false, repeatedBrokenLinkEvidence).includes("Affected Pages: 157"));
assert.ok(technicalValidationSummary(35, false, repeatedBrokenLinkEvidence).includes("Root Cause: Shared navigation menu"));
assert.equal(technicalValidationSummary(35, false, repeatedBrokenLinkEvidence).some((line) => /Broken URL Sample/.test(line)), false);

const multipleBrokenLinkEvidence = JSON.stringify({
  pagesCrawled: 20,
  pagesChecked: 20,
  pagesFailed: 8,
  passRate: 60,
  uniqueBrokenUrls: 7,
  brokenLinks: 7,
  brokenUrlGroups: [
    "contact-us",
    "grievance",
    "loan-status",
    "apply-now",
    "old-page",
    "offers",
    "support"
  ].map((slug) => ({
    brokenUrl: `https://example.com/${slug}/`,
    affectedPages: 2,
    locations: ["page content"],
    sampleAffectedPages: ["https://example.com/"]
  })),
  sampleEvidence: [{
    brokenUrl: "https://example.com/contact-us/",
    affectedPages: 2,
    locations: ["page content"]
  }]
});
const multipleBrokenLinkSummary = technicalValidationSummary(35, false, multipleBrokenLinkEvidence);
assert.ok(multipleBrokenLinkSummary.includes("Unique Broken URLs: 7"));
assert.ok(multipleBrokenLinkSummary.includes("Broken URL Sample 1: https://example.com/contact-us/"));
assert.ok(multipleBrokenLinkSummary.includes("Broken URL Sample 5: https://example.com/old-page/"));
assert.ok(multipleBrokenLinkSummary.includes("Additional broken URLs not shown: 2"));
assert.ok(multipleBrokenLinkSummary.includes("Affected Pages: 8"));
assert.equal(
  technicalIssueSummary(35, false, multipleBrokenLinkEvidence),
  "7 unique broken internal URLs detected across 8 affected pages."
);

const renderedEvidence = JSON.stringify({
  pagesCrawled: 10,
  pagesChecked: 1,
  pagesFailed: 1,
  sampleEvidence: [{
    rawHtmlWords: 1250,
    renderedDomWords: 2980,
    differencePercent: 138,
    reason: "Key content loads only after JavaScript execution."
  }]
});
assert.match(technicalFailureDescription(140, renderedEvidence), /1250 words.*2980 words.*138%/);
assert.ok(technicalValidationSummary(140, false, renderedEvidence).includes("Raw HTML: 1250 words"));
assert.ok(technicalValidationSummary(140, false, renderedEvidence).includes("Rendered DOM: 2980 words"));
assert.ok(technicalValidationSummary(140, false, renderedEvidence).includes("Content difference: 138%"));

console.log(`technical helper tests passed (${cases.length + 42})`);
