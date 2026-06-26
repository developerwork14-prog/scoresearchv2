import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { runOnPageSeoAudit } from "../dist/on-page-seo-audit.js";
import { suggestedAltFromPageContext } from "../dist/image-alt-utils.js";

function page(url, html, status = 200) {
  const $ = cheerio.load(html);
  return {
    url,
    finalUrl: url,
    status,
    headers: new Headers({ "content-type": "text/html" }),
    html,
    responseTimeMs: 10,
    redirectHops: 0,
    depth: 0,
    source: "homepage",
    $,
    wordCount: $("body").text().trim().split(/\s+/).filter(Boolean).length
  };
}

const validHtml = `<!doctype html>
  <html>
    <head><title>Useful page</title></head>
    <body>
      <main>
        <h1>A useful heading for this example page</h1>
        <p>Helpful content with a <a href="/about">contextual internal link</a>.</p>
        <img src="/hero.jpg" alt="A useful product overview">
      </main>
    </body>
  </html>`;

const blockedHtml = `<!doctype html>
  <html>
    <head><title>Just a moment...</title></head>
    <body><h1>Checking your browser</h1><p>Verify you are human to continue.</p></body>
  </html>`;

const mixed = await runOnPageSeoAudit("https://example.com", validHtml, {
  origin: "https://example.com",
  sitemapUrls: [],
  crawlStats: {
    targetUrls: 2,
    attemptedUrls: 2,
    htmlPages: 2,
    failedOrNonHtmlUrls: 0,
    cappedByMaxPages: false
  },
  pages: [
    page("https://example.com", validHtml),
    page("https://example.com/challenge", blockedHtml, 403)
  ]
});

assert.equal(mixed.checks.length, 14);
assert.ok(mixed.checks.every((check) => check.evidence.pagesCrawled === 1));
assert.ok(mixed.checks.every((check) => check.recommendation.issue));
assert.ok(mixed.checks.every((check) => check.recommendation.issueSummary));
assert.ok(mixed.checks.every((check) => check.recommendation.priority));
assert.ok(mixed.checks.every((check) => Number.isFinite(check.recommendation.affectedRate)));
assert.ok(mixed.checks.every((check) => Array.isArray(check.recommendation.affectedPages)));
assert.ok(mixed.checks.every((check) => check.recommendation.whatIsWrong));
assert.ok(mixed.checks.every((check) => check.recommendation.whyItMatters));
assert.ok(mixed.checks.every((check) => check.recommendation.businessImpact));
assert.ok(mixed.checks.every((check) => check.recommendation.aiVisibilityImpact));
assert.ok(mixed.checks.every((check) => check.recommendation.recommendedFix.length >= 1 && check.recommendation.recommendedFix.length <= 3));
assert.ok(mixed.checks.every((check) => check.recommendation.validationSummary));
assert.ok(mixed.checks.every((check) => Array.isArray(check.recommendation.topFixCandidates)));
assert.ok(mixed.checks.every((check) => check.recommendation.technicalEvidence));
assert.ok(mixed.checks.every((check) => check.recommendation.rawEvidence));
assert.ok(mixed.checks.every((check) => check.recommendation.whatWeChecked.length === 6));
assert.ok(mixed.checks.every((check) => check.recommendation.whatWeChecked.every((line) => line.length <= 150)));
assert.ok(mixed.checks.every((check) => check.recommendation.whatWeChecked.every((line) => !/[\[\]{}]|H[1-6]\s*→/i.test(line))));
assert.ok(mixed.checks.every((check) => check.recommendation.whatWeChecked.some((line) => line.startsWith("Affected rate:"))));
assert.ok(mixed.checks.every((check) => check.recommendation.whatWeChecked.some((line) => line.startsWith("Expected outcome:"))));
assert.ok(mixed.checks.every((check) => check.recommendation.howToFix));
assert.ok(mixed.checks.every((check) => check.recommendation.bestPracticeExample));
assert.ok(mixed.checks.every((check) => check.recommendation.developerNotes));
assert.equal(
  new Set(mixed.checks.map((check) => check.recommendation.howToFix)).size,
  mixed.checks.length
);
assert.ok(
  mixed.checks
    .filter((check) => !/title|meta description/i.test(check.name))
    .every((check) => !/rewrite (?:the )?title and meta description/i.test(check.recommendation.howToFix))
);

const evidenceHtml = `<!doctype html>
  <html>
    <head>
      <title>Evidence fixture</title>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://example.com/" },
            { "@type": "ListItem", "position": 2, "name": "Loan", "item": "https://example.com/loan/" },
            { "@type": "ListItem", "position": 3, "name": "Personal Loan" }
          ]
        }
      </script>
    </head>
    <body>
      <nav aria-label="Breadcrumb">
        <a href="/">Home</a><a href="/loans/">Loans</a><span>Personal Loans</span>
      </nav>
      <main>
        <h1>Blogs</h1>
        <h3>How to apply for a loan</h3>
        <h4>EMI CALCULATOR</h4>
        <p>Comparison guidance for personal loan plans.</p>
      </main>
    </body>
  </html>`;

const evidenceAudit = await runOnPageSeoAudit("https://example.com/evidence", evidenceHtml, {
  origin: "https://example.com",
  sitemapUrls: [],
  crawlStats: {
    targetUrls: 1,
    attemptedUrls: 1,
    htmlPages: 1,
    failedOrNonHtmlUrls: 0,
    cappedByMaxPages: false
  },
  pages: [page("https://example.com/evidence", evidenceHtml)]
});

const check = (name) => evidenceAudit.checks.find((item) => item.name === name);
const sampleEvidence = (name) => check(name).recommendation.rawEvidence.affectedPages[0].sampleEvidence;

assert.deepEqual(sampleEvidence("Heading Hierarchy No Skips").headingSequence, ["H1", "H3", "H4"]);
assert.equal(check("Heading Hierarchy No Skips").informational, undefined);
assert.equal(check("Heading Hierarchy No Skips").opportunity, undefined);
assert.equal(check("Heading Hierarchy No Skips").passed, false);
assert.equal(sampleEvidence("Heading Hierarchy No Skips").problem, "Skipped H2 between H1 and H3");
assert.equal(check("Heading Hierarchy No Skips").recommendation.whatIsWrong, "Heading levels skip an intermediate level within primary page content.");
assert.doesNotMatch(check("Heading Hierarchy No Skips").recommendation.whatIsWrong, /H1 → H3 → H4|Skipped H2/);

assert.deepEqual(sampleEvidence("Breadcrumb Schema-DOM Match").visibleBreadcrumb, ["Home", "Loans", "Personal Loans"]);
assert.deepEqual(sampleEvidence("Breadcrumb Schema-DOM Match").schemaBreadcrumb, ["Home", "Loan", "Personal Loan"]);
assert.doesNotMatch(check("Breadcrumb Schema-DOM Match").recommendation.whatIsWrong, /"Loans"|"Loan"/);

assert.deepEqual(sampleEvidence("Heading Capitalization Consistent").titleCase, ["Blogs"]);
assert.deepEqual(sampleEvidence("Heading Capitalization Consistent").sentenceCase, ["How to apply for a loan"]);
assert.deepEqual(sampleEvidence("Heading Capitalization Consistent").allCaps, ["EMI CALCULATOR"]);
assert.doesNotMatch(check("Heading Capitalization Consistent").recommendation.whatIsWrong, /EMI CALCULATOR/);

assert.equal(sampleEvidence("H1 Length 20-70 Characters").h1, "Blogs");
assert.equal(sampleEvidence("H1 Length 20-70 Characters").length, 5);
assert.equal(check("H1 Length 20-70 Characters").informational, undefined);
assert.equal(check("H1 Length 20-70 Characters").opportunity, undefined);
assert.equal(check("H1 Length 20-70 Characters").passed, false);
assert.equal(sampleEvidence("H1 Length 20-70 Characters").recommendedRange, "20-70");
assert.deepEqual(check("H1 Length 20-70 Characters").recommendation.affectedPages, ["https://example.com/evidence"]);
assert.doesNotMatch(check("H1 Length 20-70 Characters").recommendation.whatIsWrong, /"Blogs"|5 characters/);

const scopedHeadingHtml = `<!doctype html>
  <html><body>
    <nav><h5>Navigation heading</h5></nav>
    <main>
      <h1>Primary content heading for audit</h1>
      <h2>Visible section</h2>
      <h3>Visible subsection</h3>
      <h2 aria-hidden="true">Hidden heading</h2>
      <details><summary>Closed section</summary><h5>Collapsed heading</h5></details>
      <button aria-expanded="false" aria-controls="collapsed-panel">Collapsed panel</button>
      <section id="collapsed-panel"><h6>Controlled collapsed heading</h6></section>
      <h2>   </h2>
    </main>
    <aside><h6>Sidebar heading</h6></aside>
    <footer><h6>Footer heading</h6></footer>
    <div role="dialog"><h5>Modal heading</h5></div>
  </body></html>`;

const scopedAudit = await runOnPageSeoAudit("https://example.com/scoped", scopedHeadingHtml, {
  origin: "https://example.com",
  sitemapUrls: [],
  crawlStats: {
    targetUrls: 1,
    attemptedUrls: 1,
    htmlPages: 1,
    failedOrNonHtmlUrls: 0,
    cappedByMaxPages: false
  },
  pages: [page("https://example.com/scoped", scopedHeadingHtml)]
});
const scopedCheck = (name) => scopedAudit.checks.find((item) => item.name === name);
const scopedSample = (name) => scopedCheck(name).evidence.affectedPages?.[0]?.sampleEvidence ?? scopedCheck(name).evidence.sampleEvidence?.[0];

assert.equal(scopedCheck("Heading Hierarchy No Skips").passed, true);
assert.deepEqual(scopedCheck("Heading Hierarchy No Skips").evidence.sampleEvidence, []);
assert.equal(scopedCheck("Empty Heading Tags").passed, false);
assert.equal(scopedSample("Empty Heading Tags").emptyHeadingCount, 1);
assert.deepEqual(scopedSample("Empty Heading Tags").emptyHeadings.map((item) => item.level), ["H2"]);

const breadcrumbMissingHtml = `<!doctype html>
  <html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
      {"@type":"ListItem","position":1,"name":"Home","item":"https://example.com/"},
      {"@type":"ListItem","position":2,"name":"Services"}
    ]}
  </script></head><body><main><h1>Breadcrumb evidence page</h1></main></body></html>`;
const breadcrumbMissingAudit = await runOnPageSeoAudit("https://example.com/no-visible-breadcrumb", breadcrumbMissingHtml, {
  origin: "https://example.com",
  sitemapUrls: [],
  crawlStats: {
    targetUrls: 1,
    attemptedUrls: 1,
    htmlPages: 1,
    failedOrNonHtmlUrls: 0,
    cappedByMaxPages: false
  },
  pages: [page("https://example.com/no-visible-breadcrumb", breadcrumbMissingHtml)]
});
const breadcrumbMissingCheck = breadcrumbMissingAudit.checks.find((item) => item.name === "Breadcrumb Schema-DOM Match");
assert.equal(breadcrumbMissingCheck.passed, false);
assert.equal(breadcrumbMissingCheck.recommendation.issue, "Visible Breadcrumb Missing");
assert.match(breadcrumbMissingCheck.recommendation.whatIsWrong, /visible breadcrumb/i);
assert.notEqual(breadcrumbMissingCheck.recommendation.issue, "Breadcrumb Schema-DOM Mismatch");

const unavailable = await runOnPageSeoAudit("https://example.com", blockedHtml, {
  origin: "https://example.com",
  sitemapUrls: [],
  crawlStats: {
    targetUrls: 1,
    attemptedUrls: 1,
    htmlPages: 1,
    failedOrNonHtmlUrls: 0,
    cappedByMaxPages: false
  },
  pages: [page("https://example.com", blockedHtml, 403)]
});

assert.deepEqual(unavailable.categories, []);
assert.deepEqual(unavailable.checks, []);

const contextualImageHtml = `<!doctype html>
  <html>
    <head><title>PayRupik personal loan application</title></head>
    <body>
      <main>
        <h1>Apply for a personal loan using the PayRupik mobile app</h1>
        <figure>
          <img src="/assets/Group-48097742.png">
          <figcaption>Personal loan application process in the PayRupik mobile app</figcaption>
        </figure>
      </main>
    </body>
  </html>`;
const contextual$ = cheerio.load(contextualImageHtml);
const contextualImage = contextual$("img").get(0);
const suggestedAlt = suggestedAltFromPageContext(contextual$, contextualImage);
assert.equal(suggestedAlt, "Personal loan application process in the PayRupik mobile app");
assert.ok(suggestedAlt.split(/\s+/).length >= 5 && suggestedAlt.split(/\s+/).length <= 15);
assert.doesNotMatch(suggestedAlt, /Group-48097742/i);

const contextualAudit = await runOnPageSeoAudit("https://example.com/apply", contextualImageHtml, {
  origin: "https://example.com",
  sitemapUrls: [],
  crawlStats: {
    targetUrls: 1,
    attemptedUrls: 1,
    htmlPages: 1,
    failedOrNonHtmlUrls: 0,
    cappedByMaxPages: false
  },
  pages: [page("https://example.com/apply", contextualImageHtml)]
});
const contextualAltCheck = contextualAudit.checks.find((item) => item.name === "Alt Text Non-Empty");
const contextualAltExample = contextualAltCheck.evidence.affectedPages[0].sampleEvidence.missingAltImages[0];
assert.equal(contextualAltExample.issue, "Missing alt attribute");
assert.equal(contextualAltExample.suggestedAlt, suggestedAlt);
assert.match(contextualAltExample.imageUrl, /Group-48097742\.png$/);

console.log("on-page SEO tests passed");
