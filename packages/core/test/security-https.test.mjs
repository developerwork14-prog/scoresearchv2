import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import {
  addressFormatQualityEvidence,
  citableContentAccessEvidence,
  contactCompletenessEvidence,
  http200SeverityForPercent,
  industryCategoryConsistencyEvidence,
  locationConsistencyComparisonEvidence,
  mixedContentAssets,
  mobileDomParityEvidence,
  robotsWildcardDisallowEvidence,
  siteSchemaDescriptionConsistencyEvidence
} from "../dist/technical-audit.js";

function page(html) {
  return {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    status: 200,
    headers: new Headers(),
    html,
    responseTimeMs: 100,
    redirectHops: 0,
    $: cheerio.load(html),
    wordCount: 10
  };
}

assert.equal(http200SeverityForPercent(100), "ADVISORY");
assert.equal(http200SeverityForPercent(99), "ADVISORY");
assert.equal(http200SeverityForPercent(95), "ADVISORY");
assert.equal(http200SeverityForPercent(94), "MAJOR");
assert.equal(http200SeverityForPercent(80), "MAJOR");
assert.equal(http200SeverityForPercent(79), "BLOCKER");

const noMixedContent = page(`
  <p>Documentation mentions http://example.com/plain-text-url.</p>
  <pre>{"url":"http://example.com/json-example"}</pre>
  <a href="http://example.com/reference-only">Reference link</a>
  <link rel="canonical" href="http://example.com/canonical">
`);
assert.deepEqual(mixedContentAssets([noMixedContent]), []);

const mixedContent = page(`
  <script src="http://example.com/app.js"></script>
  <link rel="stylesheet" href="http://example.com/style.css">
  <img src="http://example.com/image.jpg">
  <iframe src="https://example.com/embed"></iframe>
`);
assert.deepEqual(mixedContentAssets([mixedContent]).map(({ tag, url }) => ({ tag, url })), [
  { tag: "script", url: "http://example.com/app.js" },
  { tag: "link", url: "http://example.com/style.css" },
  { tag: "img", url: "http://example.com/image.jpg" }
]);

assert.equal(robotsWildcardDisallowEvidence("User-agent: *\nDisallow: /private/\n").pass, true);
assert.equal(robotsWildcardDisallowEvidence("User-agent: *\nDisallow: /*\n").pass, false);
assert.deepEqual(robotsWildcardDisallowEvidence("Disallow: *").broadWildcardRules, ["*"]);

const publicArticle = cheerio.load(`<article><p>${"Useful citable content ".repeat(90)}</p></article>`);
assert.equal(citableContentAccessEvidence(publicArticle, publicArticle.root().text(), "https://example.com/blog/post").pass, true);

const gatedArticle = cheerio.load("<article><p>Subscribe to continue reading this premium content.</p><form action='/login'><input type='password'></form></article>");
assert.equal(citableContentAccessEvidence(gatedArticle, gatedArticle.root().text(), "https://example.com/article/paywalled").pass, false);

assert.equal(mobileDomParityEvidence("<main>Desktop words ".repeat(100), "<main>Desktop words ".repeat(95)).pass, true);
assert.equal(mobileDomParityEvidence("<main>Desktop words ".repeat(100), "<main>Mobile only ").pass, false);

assert.equal(contactCompletenessEvidence("Email hello@example.com Call +1 415 555 1212 Visit 1 Market Street, San Francisco CA 94105").pass, true);
assert.equal(contactCompletenessEvidence("Email hello@example.com").pass, false);

const zeroSchemaDescription = siteSchemaDescriptionConsistencyEvidence("Site description", []);
assert.equal(zeroSchemaDescription.skipped, true);
assert.equal(zeroSchemaDescription.pass, undefined);
assert.match(zeroSchemaDescription.reason, /No Organization schema description found/i);

const emptySchemaDescription = siteSchemaDescriptionConsistencyEvidence("Site description", [{
  "@type": "Organization",
  name: "Example",
  description: ""
}]);
assert.equal(emptySchemaDescription.skipped, true);
assert.match(emptySchemaDescription.reason, /No Organization schema description found/i);

const mismatchedSchemaDescription = siteSchemaDescriptionConsistencyEvidence("Foreign exchange and travel card services for Indian travelers.", [{
  "@type": "Organization",
  name: "Example",
  description: "Enterprise software for developer productivity and cloud deployments."
}]);
assert.equal(mismatchedSchemaDescription.pass, false);
assert.equal(mismatchedSchemaDescription.skipped, undefined);

const duplicateAddress = addressFormatQualityEvidence("Banashankari 2nd stage, B Sk II Stage, Bangalore, Bangalore South, Karnataka");
assert.equal(duplicateAddress.pass, false);
assert.ok(duplicateAddress.duplicateSegments.length > 0);

const duplicateLocationComparison = locationConsistencyComparisonEvidence(
  "Banashankari 2nd stage, B Sk II Stage, Bangalore, Bangalore South, Karnataka",
  "MG Road, Bengaluru, Karnataka",
  "GBP"
);
assert.equal(duplicateLocationComparison.skipped, true);
assert.match(duplicateLocationComparison.reason, /format must be cleaned/i);

const cleanLocationMismatch = locationConsistencyComparisonEvidence(
  "MG Road, Bengaluru, Karnataka",
  "Lower Parel, Mumbai, Maharashtra",
  "GBP"
);
assert.equal(cleanLocationMismatch.pass, false);
assert.equal(cleanLocationMismatch.skipped, undefined);

assert.equal(industryCategoryConsistencyEvidence("Financial Services", "Currency Exchange Service").pass, true);
assert.equal(industryCategoryConsistencyEvidence("Financial Services", "Software Development").pass, false);

console.log("security HTTPS helper tests passed");
