import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { http200SeverityForPercent, mixedContentAssets } from "../dist/technical-audit.js";

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

console.log("security HTTPS helper tests passed");
