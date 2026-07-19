import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { runStructuredDataAudit } from "../dist/structured-data-audit.js";

function check(audit, name) {
  const found = audit.checks.find((item) => item.name === name);
  assert.ok(found, `Expected check: ${name}`);
  return found;
}

function crawledPage(url, html) {
  const $ = cheerio.load(html);
  return {
    url,
    finalUrl: url,
    status: 200,
    headers: new Headers({ "content-type": "text/html" }),
    html,
    responseTimeMs: 10,
    redirectHops: 0,
    depth: url === "https://example.com/" ? 0 : 1,
    source: url === "https://example.com/" ? "homepage" : "internal",
    $,
    wordCount: $("body").text().trim().split(/\s+/).filter(Boolean).length
  };
}

const genericHtml = `<!doctype html>
<html>
  <head><title>Acme financial services</title></head>
  <body>
    <main>
      <h1>Flexible finance for growing businesses</h1>
      <p>Learn about our services and contact our team.</p>
    </main>
  </body>
</html>`;

const generic = await runStructuredDataAudit("https://example.com/services", genericHtml);
for (const name of [
  "Person Schema on Bio Pages",
  "Article: headline",
  "LocalBusiness: GPS",
  "ImageObject on Key Images"
]) {
  const item = check(generic, name);
  assert.equal(item.skipped, false, `${name} should be evaluated`);
  assert.equal(item.passed, false, `${name} should fail when absent`);
  assert.equal(item.evidence.pagesChecked, 1);
  assert.equal(item.evidence.pagesFailed, 1);
  assert.equal(item.evidence.pagesCrawled, 1);
}
for (const name of [
  "Speakable + Valid Selectors",
  "DefinedTerm on Glossary",
  "Dataset on Research",
  "Event on Webinars",
  "SoftwareApp on Tools",
  "ProfilePage on Bio Pages"
]) {
  const item = check(generic, name);
  assert.equal(item.skipped, true, `${name} should be N/A on a generic service page`);
  assert.equal(item.notApplicable, true, `${name} should be marked not applicable`);
  assert.equal(item.passed, true, `${name} should not fail when no applicable page exists`);
  assert.equal(item.evidence.pagesChecked, 0);
  assert.equal(item.evidence.pagesFailed, 0);
}
const genericProfilePage = check(generic, "ProfilePage on Bio Pages");
assert.equal(genericProfilePage.skipped, true);
assert.equal(genericProfilePage.notApplicable, true);
assert.equal(genericProfilePage.passed, true);
assert.equal(genericProfilePage.evidence.pagesFailed, 0);
assert.match(genericProfilePage.evidence.skippedReason, /No public author, expert, founder, or team profile pages/i);

assert.equal(generic.checks.some((item) => item.category === "Product Schema"), false);
assert.equal(generic.checks.some((item) => item.name === "Schema-DOM: Price Match"), false);
assert.equal(generic.checks.some((item) => item.name === "Schema-DOM: Availability Match"), false);

const genericDefinedTerm = check(generic, "DefinedTerm on Glossary");
assert.equal(genericDefinedTerm.severity, "Medium");
assert.ok(genericDefinedTerm.weight > 0);
assert.match(genericDefinedTerm.recommendation, /glossary/i);

assert.equal(genericProfilePage.severity, "Medium");
assert.ok(genericProfilePage.weight > 0);
assert.match(genericProfilePage.recommendation, /ProfilePage JSON-LD/i);

const profileWithoutSchema = await runStructuredDataAudit("https://example.com/team/jane-doe", `
  <html><body>
    <main>
      <h1>Jane Doe</h1>
      <img src="/jane.jpg" alt="Jane Doe profile photo">
      <p>Founder and AI search consultant at Acme. Jane has 12 years of experience.</p>
      <p class="bio">Biography and credentials for Jane Doe.</p>
      <a href="https://www.linkedin.com/in/janedoe">LinkedIn</a>
      <a href="mailto:jane@example.com">Email Jane</a>
    </main>
  </body></html>
`);
const missingProfileSchema = check(profileWithoutSchema, "ProfilePage on Bio Pages");
assert.equal(missingProfileSchema.skipped, false);
assert.equal(missingProfileSchema.passed, false);
assert.match(missingProfileSchema.whatIsWrong, /missing ProfilePage schema/i);

const profileWithSchema = await runStructuredDataAudit("https://example.com/team/jane-doe", `
  <html><head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        "url": "https://example.com/team/jane-doe",
        "mainEntity": {
          "@type": "Person",
          "name": "Jane Doe",
          "url": "https://example.com/team/jane-doe",
          "image": "https://example.com/jane.jpg",
          "jobTitle": "Founder and AI search consultant",
          "worksFor": { "@type": "Organization", "name": "Acme" },
          "sameAs": ["https://www.linkedin.com/in/janedoe"],
          "description": "Jane Doe is the founder and AI search consultant at Acme."
        }
      }
    </script>
  </head><body>
    <main>
      <h1>Jane Doe</h1>
      <img src="/jane.jpg" alt="Jane Doe profile photo">
      <p>Founder and AI search consultant at Acme. Jane has 12 years of experience.</p>
      <p class="bio">Biography and credentials for Jane Doe.</p>
      <a href="https://www.linkedin.com/in/janedoe">LinkedIn</a>
    </main>
  </body></html>
`);
const validProfileSchema = check(profileWithSchema, "ProfilePage on Bio Pages");
assert.equal(validProfileSchema.skipped, false);
assert.equal(validProfileSchema.passed, true);

for (const url of [
  "https://tradeucare.in/about",
  "https://tradeucare.in/products",
  "https://tradeucare.in/aml-policy",
  "https://tradeucare.in/privacy-policy"
]) {
  const genericPage = await runStructuredDataAudit(url, `
    <html><body>
      <main>
        <h1>${url.endsWith("/about") ? "About Tradeucare" : url.endsWith("/products") ? "Products" : "Policy"}</h1>
        <p>Tradeucare is a company offering products and services to customers.</p>
        <p>Our company has an experienced team and organization-wide credentials.</p>
      </main>
    </body></html>
  `);
  const profileCheck = check(genericPage, "ProfilePage on Bio Pages");
  assert.equal(profileCheck.skipped, true, `${url} should not be treated as a person profile`);
  assert.equal(profileCheck.notApplicable, true, `${url} should be N/A`);
  assert.equal(profileCheck.evidence.pagesFailed, 0);
  for (const name of ["DefinedTerm on Glossary", "Dataset on Research", "Event on Webinars", "SoftwareApp on Tools"]) {
    const specialistCheck = check(genericPage, name);
    assert.equal(specialistCheck.skipped, true, `${url} should not be treated as ${name}`);
    assert.equal(specialistCheck.notApplicable, true, `${url} should be N/A for ${name}`);
    assert.equal(specialistCheck.evidence.pagesFailed, 0);
  }
}

const organizationHtml = `<!doctype html>
<html>
  <head>
    <title>Acme</title>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Acme",
        "url": "https://example.com",
        "sameAs": ["https://www.linkedin.com/company/acme"]
      }
    </script>
  </head>
  <body><main><h1>Acme</h1></main></body>
</html>`;

const organization = await runStructuredDataAudit("https://example.com", organizationHtml);
const sameAs = check(organization, "Organization sameAs links");
assert.equal(sameAs.passed, true);
assert.equal(sameAs.severity, "Advisory");
assert.equal(sameAs.priorityScore, 15);
assert.match(sameAs.recommendation, /verified profiles exist/i);

const authorityProfile = check(organization, "Organization authority-profile sameAs");
assert.equal(authorityProfile.skipped, false);
assert.equal(authorityProfile.informational, undefined);
assert.equal(authorityProfile.severity, "Advisory");
assert.equal(authorityProfile.evidence.pagesFailed, 1);
assert.match(authorityProfile.recommendation, /Never create a profile/i);

const knowsAbout = check(organization, "Organization knowsAbout topics");
assert.equal(knowsAbout.skipped, false);
assert.equal(knowsAbout.informational, undefined);
assert.equal(knowsAbout.severity, "Advisory");
assert.match(knowsAbout.recommendation, /accurately describe/i);

const webinarWithoutLogistics = await runStructuredDataAudit("https://example.com/webinar", `
  <main><h1>Our webinar resources</h1><p>Read recordings and notes from previous sessions.</p></main>
`);
assert.equal(check(webinarWithoutLogistics, "Event on Webinars").skipped, true);
assert.equal(check(webinarWithoutLogistics, "Event on Webinars").notApplicable, true);

const datedWebinar = await runStructuredDataAudit("https://example.com/webinars/seo-live", `
  <main>
    <h1>SEO webinar</h1>
    <p>Register now for June 30 at 10:30 AM. Speaker: A. Expert.</p>
  </main>
`);
const event = check(datedWebinar, "Event on Webinars");
assert.equal(event.skipped, false);
assert.equal(event.passed, false);
assert.equal(event.evidence.pagesFailed, 1);
assert.equal(event.evidence.affectedRate, 100);

const appLandingPage = await runStructuredDataAudit("https://example.com/", `
  <!doctype html>
  <html>
    <head>
      <title>Acme | Instant loan app</title>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "name": "Acme",
              "url": "https://example.com/",
              "sameAs": ["https://www.facebook.com/acme"]
            },
            {
              "@type": "Organization",
              "name": "Acme",
              "url": "https://example.com/",
              "sameAs": [
                "https://www.instagram.com/acme/",
                "https://x.com/acme",
                "https://www.youtube.com/@acme"
              ]
            }
          ]
        }
      </script>
    </head>
    <body>
      <h1>Download the Acme loan app</h1>
      <p>Our mobile app offers paperless approval and instant disbursal.</p>
      <a href="https://play.google.com/store/apps/details?id=com.example">Get it on Google Play</a>
      <footer>
        <h6>Finance Glossary</h6>
        <dl class="gallery"><dt><img src="/member.svg" alt="Member"></dt></dl>
      </footer>
    </body>
  </html>
`);

const appSameAs = check(appLandingPage, "Organization sameAs links");
assert.equal(appSameAs.passed, true);
assert.deepEqual(appSameAs.evidence.sameAsUrls, [
  "https://www.facebook.com/acme",
  "https://www.instagram.com/acme/",
  "https://x.com/acme",
  "https://www.youtube.com/@acme"
]);
assert.equal(check(appLandingPage, "Organization LinkedIn sameAs").informational, undefined);
assert.equal(check(appLandingPage, "Organization authority-profile sameAs").informational, undefined);
assert.equal(check(appLandingPage, "Organization knowsAbout topics").informational, undefined);
assert.equal(check(appLandingPage, "DefinedTerm on Glossary").skipped, true);
assert.equal(check(appLandingPage, "DefinedTerm on Glossary").notApplicable, true);

const software = check(appLandingPage, "SoftwareApp on Tools");
assert.equal(software.skipped, false);
assert.equal(software.passed, false);
assert.equal(software.evidence.pagesCrawled, 1);
assert.equal(software.evidence.pagesChecked, 1);
assert.equal(software.evidence.pagesFailed, 1);

const glossaryWithoutSchema = await runStructuredDataAudit("https://example.com/glossary/", `
  <main>
    <h1>Finance glossary</h1>
    <dl>
      <dt>APR</dt><dd>Annual percentage rate.</dd>
      <dt>Net income</dt><dd>Income after deductions.</dd>
      <dt>Collateral</dt><dd>An asset pledged for a loan.</dd>
    </dl>
  </main>
`);
const missingDefinedTerm = check(glossaryWithoutSchema, "DefinedTerm on Glossary");
assert.equal(missingDefinedTerm.skipped, false);
assert.equal(missingDefinedTerm.passed, false);
assert.equal(missingDefinedTerm.evidence.pagesFailed, 1);

const glossaryWithSchema = await runStructuredDataAudit("https://example.com/glossary/", `
  <html><head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "DefinedTerm",
        "name": "APR",
        "description": "Annual percentage rate.",
        "url": "https://example.com/glossary/#apr"
      }
    </script>
  </head><body>
    <main>
      <h1>Finance glossary</h1>
      <dl>
        <dt>APR</dt><dd>Annual percentage rate.</dd>
        <dt>Net income</dt><dd>Income after deductions.</dd>
        <dt>Collateral</dt><dd>An asset pledged for a loan.</dd>
      </dl>
    </main>
  </body></html>
`);
const validDefinedTerm = check(glossaryWithSchema, "DefinedTerm on Glossary");
assert.equal(validDefinedTerm.skipped, false);
assert.equal(validDefinedTerm.passed, true);

const articleHtml = `
  <!doctype html>
  <html>
    <head>
      <title>How credit eligibility works</title>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": "How credit eligibility works",
          "author": {"@type": "Person", "name": "A. Expert"},
          "datePublished": "2026-06-20",
          "image": "https://example.com/credit.jpg",
          "publisher": {"@type": "Organization", "name": "Acme"}
        }
      </script>
    </head>
    <body>
      <article>
        <h1>How credit eligibility works</h1>
        <p>Published 2026-06-20 by A. Expert.</p>
      </article>
    </body>
  </html>
`;

const crawled = await runStructuredDataAudit("https://example.com/", `
  <!doctype html><html><head><title>Acme loan app</title></head>
  <body><h1>Download the Acme loan app</h1><a href="https://play.google.com/store/apps/details?id=com.example">Google Play</a></body></html>
`, {
  origin: "https://example.com",
  sitemapUrls: ["https://example.com/blog/credit"],
  crawlStats: {
    targetUrls: 2,
    attemptedUrls: 2,
    htmlPages: 2,
    failedOrNonHtmlUrls: 0,
    cappedByMaxPages: false
  },
  pages: [
    crawledPage("https://example.com/", `
      <!doctype html><html><head><title>Acme loan app</title></head>
      <body><h1>Download the Acme loan app</h1><a href="https://play.google.com/store/apps/details?id=com.example">Google Play</a></body></html>
    `),
    crawledPage("https://example.com/blog/credit", articleHtml)
  ]
});

const crawledSoftware = check(crawled, "SoftwareApp on Tools");
assert.equal(crawledSoftware.evidence.pagesCrawled, 2);
assert.equal(crawledSoftware.evidence.pagesChecked, 1);
assert.equal(crawledSoftware.evidence.pagesFailed, 1);

const crawledArticle = check(crawled, "Article: headline");
assert.equal(crawledArticle.passed, false);
assert.equal(crawledArticle.evidence.pagesCrawled, 2);
assert.equal(crawledArticle.evidence.pagesChecked, 2);
assert.equal(crawledArticle.evidence.pagesFailed, 1);

const graphContext = await runStructuredDataAudit("https://example.com/", `
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {"@type": "WebSite", "@id": "https://example.com/#website", "url": "https://example.com/"},
        {"@type": "Organization", "@id": "https://example.com/#org", "name": "Acme", "url": "https://example.com/"}
      ]
    }
  </script>
  <h1>Acme</h1>
`);
assert.equal(check(graphContext, "Schema Versioning").passed, true);

const conflictingEntities = await runStructuredDataAudit("https://example.com/", `
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {"@type": "Organization", "@id": "https://example.com/#org", "name": "Acme", "url": "https://example.com/"},
        {"@type": "Organization", "@id": "https://example.com/#org", "name": "Different Company", "url": "https://example.com/"}
      ]
    }
  </script>
  <h1>Acme</h1>
`);
const conflict = check(conflictingEntities, "No Conflicting Duplicate Entities");
assert.equal(conflict.passed, false);
assert.deepEqual(conflict.evidence.conflictingIds, ["https://example.com/#org"]);

const localBusinessWithoutSchema = await runStructuredDataAudit("https://example.com/locations/mumbai", `
  <main>
    <h1>Visit our Mumbai location</h1>
    <address>123 Example Road, Mumbai</address>
    <a href="tel:+910000000000">Call us</a>
    <p>Business hours: Monday to Friday, 9 AM to 6 PM.</p>
  </main>
`);
const missingLocalBusiness = check(localBusinessWithoutSchema, "LocalBusiness Schema Present with Valid @type");
assert.equal(missingLocalBusiness.skipped, false);
assert.equal(missingLocalBusiness.passed, false);
assert.equal(missingLocalBusiness.warning, false);

const invalidJsonLd = await runStructuredDataAudit("https://example.com/", `
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization",}</script>
  <h1>Acme</h1>
`);
const syntax = check(invalidJsonLd, "JSON-LD Syntax Valid");
assert.equal(syntax.skipped, false);
assert.equal(syntax.passed, false);
assert.equal(syntax.warning, false);
assert.equal(syntax.evidence.pagesFailed, 1);
assert.ok(syntax.evidence.parseErrors.length > 0);

const sharedFooter = `
  <footer>
    <a href="https://play.google.com/store/apps/details?id=com.example">Download our app</a>
    <a href="/glossary/">Finance Glossary</a>
  </footer>
`;
const organizationSchema = `
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": "https://example.com/#org",
      "name": "Acme",
      "url": "https://example.com/"
    }
  </script>
`;
const articleSchema = (dateModified = "2026-06-20") => `
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": "Responsible borrowing guide",
      "author": {"@type": "Person", "name": "A. Expert"},
      "datePublished": "2026-06-01",
      "dateModified": "${dateModified}",
      "image": "https://example.com/guide.jpg",
      "publisher": {"@type": "Organization", "name": "Acme"}
    }
  </script>
`;
const faqSchema = `
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        {"@type": "Question", "name": "Who can apply?", "acceptedAnswer": {"@type": "Answer", "text": "Eligible adults can apply."}},
        {"@type": "Question", "name": "How does repayment work?", "acceptedAnswer": {"@type": "Answer", "text": "Repayment follows the agreed schedule."}}
      ]
    }
  </script>
`;

const productionFixturePages = [
  crawledPage("https://example.com/", `
    <html><head><title>Acme loan app</title>${organizationSchema}</head>
    <body><main><h1>Download the Acme loan app</h1><a href="https://play.google.com/store/apps/details?id=com.example">Download the app</a></main>${sharedFooter}</body></html>
  `),
  crawledPage("https://example.com/feedback/", `
    <html><head><title>Customer feedback</title>${organizationSchema}</head>
    <body><main><h1>Customer feedback</h1><p>Tell us about your experience.</p></main>${sharedFooter}</body></html>
  `),
  crawledPage("https://example.com/blogs/", `
    <html><head><title>Latest blogs</title>${organizationSchema}</head>
    <body><main><h1>Latest blogs</h1><article><h2>Guide one</h2><p>Published June 1, 2026</p></article><article><h2>Guide two</h2></article></main>${sharedFooter}</body></html>
  `),
  crawledPage("https://example.com/blogs/responsible-borrowing/", `
    <html><head><title>Responsible borrowing guide</title>${organizationSchema}${articleSchema()}</head>
    <body><article><h1>Responsible borrowing guide</h1><p>Written by A. Expert. Published June 1, 2026.</p><p>This article explains how to compare borrowing options without presenting a step-by-step process.</p></article>${sharedFooter}</body></html>
  `),
  crawledPage("https://example.com/blogs/date-mismatch/", `
    <html><head><title>Responsible borrowing guide</title>${organizationSchema}${articleSchema("2026-06-20")}</head>
    <body><article><h1>Responsible borrowing guide</h1><p>Written by A. Expert.</p><time datetime="2026-06-10">Updated June 10, 2026</time></article>${sharedFooter}</body></html>
  `),
  crawledPage("https://example.com/faqs/", `
    <html><head><title>Frequently asked questions</title>${organizationSchema}${faqSchema}</head>
    <body><main><h1>Frequently asked questions</h1><section class="faq"><h2>Who can apply?</h2><p>Eligible adults can apply.</p><h2>How does repayment work?</h2><p>Repayment follows the agreed schedule.</p></section></main>${sharedFooter}</body></html>
  `),
  crawledPage("https://example.com/glossary/", `
    <html><head><title>Finance glossary</title>${organizationSchema}</head><body><main><h1>Finance glossary</h1><a href="/glossary/net-income/">Net income</a></main>${sharedFooter}</body></html>
  `),
  crawledPage("https://example.com/glossary/net-income/", `
    <html><head><title>Net income definition</title>${organizationSchema}</head><body><main><h1>Net income</h1><p>Definition of net income.</p><h2>Download the loan app</h2><a href="https://play.google.com/store/apps/details?id=com.example">Download app</a></main>${sharedFooter}</body></html>
  `),
  crawledPage("https://example.com/blogs/invalid-schema/", `
    <html><head><title>Invalid schema article</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Article",}</script></head>
    <body><article><h1>Invalid schema article</h1><p>Written by A. Expert. Published June 1, 2026.</p></article>${sharedFooter}</body></html>
  `)
];

const productionFixture = await runStructuredDataAudit("https://example.com/", productionFixturePages[0].html, {
  origin: "https://example.com",
  sitemapUrls: productionFixturePages.map((page) => page.finalUrl),
  crawlStats: {
    targetUrls: productionFixturePages.length,
    attemptedUrls: productionFixturePages.length,
    htmlPages: productionFixturePages.length,
    failedOrNonHtmlUrls: 0,
    cappedByMaxPages: false
  },
  pages: productionFixturePages
});

const foundingDate = check(productionFixture, "Org: foundingDate");
assert.equal(foundingDate.skipped, false);
assert.equal(foundingDate.informational, undefined);
assert.ok(foundingDate.evidence.pagesChecked > 0);

const productionArticle = check(productionFixture, "Article: headline");
assert.equal(productionArticle.skipped, false);
assert.ok(productionArticle.evidence.pagesChecked > 0);

const productionFaq = check(productionFixture, "FAQPage When FAQ in DOM");
assert.equal(productionFaq.skipped, false);
assert.ok(productionFaq.evidence.pagesChecked > 0);
const faqParity = check(productionFixture, "Schema-DOM: FAQ Match");
assert.equal(faqParity.skipped, false);
assert.ok(faqParity.evidence.pagesChecked > 0);

const productionHowTo = check(productionFixture, "HowTo on Step-by-Step");
assert.equal(productionHowTo.skipped, false);
assert.ok(productionHowTo.evidence.pagesChecked > 0);

const productionProfile = check(productionFixture, "ProfilePage on Bio Pages");
assert.equal(productionProfile.skipped, true);
assert.equal(productionProfile.notApplicable, true);
assert.match(productionProfile.evidence.skippedReason, /No public author, expert, founder, or team profile pages/i);

const productionSoftware = check(productionFixture, "SoftwareApp on Tools");
assert.ok(productionSoftware.evidence.pagesChecked > 0);
assert.ok(productionSoftware.evidence.affectedPages.length > 0);

const productionDefinedTerm = check(productionFixture, "DefinedTerm on Glossary");
assert.ok(productionDefinedTerm.evidence.pagesChecked > 0);
assert.ok(productionDefinedTerm.evidence.affectedPages.length > 0);

const dateMismatch = check(productionFixture, "Article: dateModified Matches Visible Date");
assert.ok(dateMismatch.evidence.pagesFailed >= 1);
assert.equal(dateMismatch.warning, false);
const mismatchEvidence = dateMismatch.evidence.affectedPages.find((page) => page.url.endsWith("/date-mismatch/")).evidence;
assert.equal(mismatchEvidence.schemaDateModified, "2026-06-20");
assert.deepEqual(mismatchEvidence.visibleDateCandidates, ["2026-06-10", "Updated June 10, 2026"]);
assert.equal(mismatchEvidence.explicitConflict, true);

const noVisibleModifiedDate = await runStructuredDataAudit("https://example.com/blogs/no-visible-update/", `
  <html>
    <head><title>Responsible borrowing guide</title>${articleSchema("2026-06-20")}</head>
    <body><article><h1>Responsible borrowing guide</h1><p>Written by A. Expert. Published June 1, 2026.</p></article></body>
  </html>
`);
const unverifiedDate = check(noVisibleModifiedDate, "Article: dateModified Matches Visible Date");
assert.equal(unverifiedDate.passed, true);
assert.equal(unverifiedDate.skipped, false);
assert.equal(unverifiedDate.warning, false);
assert.equal(unverifiedDate.severity, "Advisory");
assert.equal(unverifiedDate.weight, 0);
assert.equal(unverifiedDate.priorityScore, 15);
assert.equal(unverifiedDate.evidence.explicitConflict, false);

const productionSyntax = check(productionFixture, "JSON-LD Syntax Valid");
assert.equal(productionSyntax.evidence.pagesFailed, 1);
assert.ok(productionSyntax.evidence.affectedPages[0].evidence.parseErrors.length > 0);
assert.match(productionSyntax.whatIsWrong, /JSON-LD parsing failed/i);

const faqWordingMismatch = await runStructuredDataAudit("https://example.com/faqs/", `
  <html>
    <head><title>Frequently asked questions</title>${faqSchema}</head>
    <body>
      <main>
        <h1>Frequently asked questions</h1>
        <section class="faq">
          <h2>Who is eligible to apply?</h2><p>Adults who meet the eligibility rules can submit an application.</p>
          <h2>How are repayments completed?</h2><p>Use the repayment schedule provided in the app.</p>
        </section>
      </main>
    </body>
  </html>
`);
assert.equal(check(faqWordingMismatch, "FAQPage acceptedAnswer completeness").passed, true);
const singleFaqMismatch = check(faqWordingMismatch, "Schema-DOM: FAQ Match");
assert.equal(singleFaqMismatch.passed, false);
assert.equal(singleFaqMismatch.severity, "High");

console.log("structured data audit tests passed");
