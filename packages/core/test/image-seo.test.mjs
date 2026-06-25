import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { runImageSeoAudit } from "../dist/image-seo-audit.js";
import { imageSeoRecommendation } from "../dist/image-seo-recommendations.js";

function page(url, html) {
  const $ = cheerio.load(html);
  return {
    url,
    finalUrl: url,
    status: 200,
    headers: new Headers({ "content-type": "text/html" }),
    html,
    responseTimeMs: 10,
    redirectHops: 0,
    depth: 0,
    source: "sitemap",
    $,
    wordCount: $("body").text().trim().split(/\s+/).filter(Boolean).length
  };
}

const html = `<!doctype html>
  <html>
    <head><title>Personal loan guide</title></head>
    <body>
      <header>
        <img class="site-logo" src="/logo.png" width="24" height="24" alt="Brand">
        <img class="social-icon" src="https://facebook.com/avatar.png" width="24" height="24">
      </header>
      <main>
        <h1>Personal loan application guide</h1>
        <img class="hero-image" src="/hero-photo.jpg" width="1200" height="600" alt="Borrower reviewing a personal loan application">
        <figure>
          <img src="/Component-1-6.png" width="800" height="500">
          <figcaption>Borrower completing a personal loan application on a mobile phone</figcaption>
        </figure>
        <img src="/loan-documents.jpg" width="800" height="500" alt="Documents required for a personal loan">
        <svg class="menu-icon" width="24" height="24"><path d="M0 0h10v10z"></path></svg>
        <svg class="loan-process-diagram" width="600" height="300"><path d="M0 0h10v10z"></path></svg>
      </main>
    </body>
  </html>`;

const crawl = {
  origin: "https://example.com",
  sitemapUrls: ["https://example.com/blog/guide-a", "https://example.com/blog/guide-b"],
  crawlStats: {
    targetUrls: 2,
    attemptedUrls: 2,
    htmlPages: 2,
    failedOrNonHtmlUrls: 0,
    cappedByMaxPages: false
  },
  pages: [
    page("https://example.com/blog/guide-a", html),
    page("https://example.com/blog/guide-b", html)
  ]
};

const audit = await runImageSeoAudit("https://example.com/guide", html, crawl);
const check = (name) => audit.checks.find((item) => item.name === name);

assert.equal(audit.checks.length, 13);
assert.ok(audit.checks.every((item) => item.recommendation));
assert.equal(new Set(audit.checks.map((item) => item.recommendation.howToFix)).size, 13);
assert.ok(audit.checks.every((item) => item.recommendation.whatIsWrong));
assert.ok(audit.checks.every((item) => item.recommendation.developerNotes));
assert.ok(audit.checks.every((item) => item.recommendation.detectionConfidence));
assert.ok(audit.checks.every((item) => item.recommendation.whatWeChecked.length === 7));
assert.ok(audit.checks.every((item) => !/failed on one or more/i.test(item.recommendation.whatIsWrong)));

const alt = check("Meaningful Images Have Alt Text");
assert.equal(alt.severity, "High");
assert.match(alt.recommendation.whatIsWrong, /\d+ meaningful image instances are missing alt text/);
assert.ok(alt.recommendation.recommendedFix.some((step) => /alt=""/.test(step)));
assert.equal(alt.recommendation.validationSummary.pagesAffected, 2);
assert.equal(alt.recommendation.uniqueAssetsAffected, 1);
assert.equal(alt.recommendation.affectedPages.length, 2);
assert.deepEqual(alt.recommendation.affectedAssets, ["Component-1-6.png"]);
assert.ok(alt.recommendation.rootCause.includes("CMS image library does not require alt values"));
assert.deepEqual(alt.recommendation.likelyTemplates, ["Blog Post Template"]);
assert.ok(alt.recommendation.priorityScore >= 0 && alt.recommendation.priorityScore <= 100);
assert.equal(alt.recommendation.overallAiVisibilityImpact.level, "Moderate");
assert.ok(alt.recommendation.priorityScore >= 60 && alt.recommendation.priorityScore <= 80);
assert.equal(alt.recommendation.validationSummary.uniqueAssetsAffected, 1);
assert.equal(alt.recommendation.estimatedFixScope.level, "Template-level fix");
assert.match(alt.recommendation.estimatedFixScope.description, /2 affected pages/);

const modern = check("WebP/AVIF >=70%");
assert.match(modern.recommendation.whatIsWrong, /Only 0%/);
assert.doesNotMatch(modern.recommendation.howToFix, /alt text|title and meta/i);
assert.equal(modern.evidence.affectedPages[0].sampleEvidence.images, 3);
assert.equal(modern.recommendation.uniqueAssetsAffected, 3);
assert.ok(modern.recommendation.priorityScore >= 50 && modern.recommendation.priorityScore <= 75);
assert.equal(modern.recommendation.overallAiVisibilityImpact.level, "Low");
assert.equal(modern.recommendation.estimatedFixScope.level, "Infrastructure-level fix");

const lazy = check("Native Lazy Loading (Not JS)");
assert.equal(lazy.informational, undefined);
assert.equal(lazy.opportunity, undefined);
assert.equal(lazy.warning, true);
assert.equal(lazy.evidence.affectedPages[0].sampleEvidence.eligibleBelowFoldImages, 1);
assert.equal(lazy.evidence.affectedPages[0].sampleEvidence.missingNativeLazy, 1);
assert.doesNotMatch(lazy.recommendation.howToFix, /alt text/i);

const responsive = check("Responsive srcset+sizes");
assert.equal(responsive.evidence.affectedPages[0].sampleEvidence.images, 3);
assert.equal(responsive.evidence.affectedPages[0].sampleEvidence.responsive, 0);
assert.match(responsive.recommendation.whatIsWrong, /6 eligible image instances/);

const filenames = check("Descriptive File Names");
assert.equal(filenames.severity, "Low");
assert.ok(filenames.evidence.affectedPages[0].sampleEvidence.nonDescriptive.some((value) => /Component-1-6\.png/.test(value)));
assert.ok(filenames.evidence.affectedPages[0].sampleEvidence.nonDescriptive.every((value) => !/facebook\.com/.test(value)));
assert.doesNotMatch(filenames.recommendation.howToFix, /alt text/i);
assert.ok(filenames.recommendation.priorityScore >= 10 && filenames.recommendation.priorityScore <= 40);
assert.equal(filenames.recommendation.overallAiVisibilityImpact.level, "Low");

const svg = check("SVG <title>+<desc>");
assert.equal(svg.evidence.affectedPages[0].sampleEvidence.svgs, 1);
assert.equal(svg.evidence.affectedPages[0].sampleEvidence.missingTitleOrDescription, 1);
assert.doesNotMatch(svg.recommendation.howToFix, /meta description|title tag/i);
assert.ok(svg.recommendation.priorityScore >= 30 && svg.recommendation.priorityScore <= 60);

const imageObject = check("ImageObject Schema");
assert.equal(imageObject.informational, undefined);
assert.equal(imageObject.opportunity, undefined);
assert.equal(imageObject.warning, true);
assert.equal(imageObject.evidence.affectedPages[0].sampleEvidence.meaningfulContentImages, 3);
assert.match(imageObject.recommendation.whatIsWrong, /2 content pages/);
assert.equal(imageObject.recommendation.validationSummary.pagesAffected, 2);
assert.ok(imageObject.recommendation.priorityScore >= 30 && imageObject.recommendation.priorityScore <= 60);
assert.equal(imageObject.recommendation.overallAiVisibilityImpact.level, "Moderate");
assert.equal(imageObject.recommendation.estimatedFixScope.level, "Schema generator fix");

assert.ok(alt.recommendation.detectionConfidence.score > lazy.recommendation.detectionConfidence.score);
assert.match(lazy.recommendation.detectionConfidence.reason, /Strong evidence|Moderate evidence|Manual verification recommended/);
assert.ok(lazy.recommendation.detectionConfidence.score < 95);
assert.ok(svg.recommendation.detectionConfidence.score < 95);
assert.ok(imageObject.recommendation.detectionConfidence.score < 95);

const inconsistentAssets = Array.from({ length: 95 }, (_, index) => ({
  assetUrl: `https://example.com/assets/image-${index}.jpg`,
  assetName: `image-${index}.jpg`
}));
const validated = imageSeoRecommendation("Meaningful Images Have Alt Text", "High", {
  pagesCrawled: 100,
  pagesChecked: 100,
  pagesFailed: 60,
  failedInstances: 60,
  uniqueAssetsAffected: 95,
  affectedAssets: inconsistentAssets,
  affectedPages: Array.from({ length: 10 }, (_, index) => ({
    url: `https://example.com/page-${index}`,
    issueCount: 6,
    sampleEvidence: { missingAlt: 6 }
  }))
});
assert.equal(validated.uniqueAssetsAffected, 60);
assert.equal(validated.validationSummary.uniqueAssetsAffected, 60);

console.log("image SEO tests passed");
