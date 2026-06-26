import assert from "node:assert/strict";
import http from "node:http";
import { runGeoAeoAudit } from "../dist/geo-aeo-audit.js";

function check(audit, id) {
  const found = audit.checks.find((item) => item.id === id);
  assert.ok(found, `Expected GEO/AEO check ${id}`);
  return found;
}

const guideCopy = Array.from({ length: 35 }, () =>
  "This guide explains responsible borrowing choices with clear examples for readers."
).join(" ");

const server = http.createServer((request, response) => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const userAgent = String(request.headers["user-agent"] ?? "");
  response.setHeader("content-type", "text/html; charset=utf-8");

  if (request.url === "/robots.txt") {
    response.setHeader("content-type", "text/plain");
    response.end("User-agent: *\nAllow: /\n");
    return;
  }
  if (request.url === "/llms.txt") {
    response.setHeader("content-type", "text/plain");
    response.end(`# Acme\n\nAbout Acme\n\n${"Service and policy information. ".repeat(30)}\n\n[Contact](${origin}/contact)`);
    return;
  }
  if (request.url === "/guide") {
    response.end(`<!doctype html>
      <html>
        <head><title>Guide to responsible borrowing</title></head>
        <body>
          <article>
            <h1>Guide to responsible borrowing</h1>
            <p>Written by A. Expert</p>
            <a href="/author/a-expert">Author bio</a>
            <h2>What should borrowers review?</h2>
            <p>${guideCopy}</p>
            <section class="faq">
              <h2>Frequently asked questions</h2>
              <h3>How should repayment be planned?</h3>
              <p>Review income and expenses before choosing a repayment schedule.</p>
              <h3>Why does eligibility matter?</h3>
              <p>Eligibility helps a borrower understand suitable options.</p>
            </section>
          </article>
        </body>
      </html>`);
    return;
  }
  if (request.url === "/author/a-expert") {
    response.end("<main><h1>A. Expert</h1><p>Certified financial educator.</p></main>");
    return;
  }
  if (request.url === "/blocked-and-paywalled") {
    if (/GPTBot|OAI-SearchBot|ChatGPT-User/i.test(userAgent)) {
      response.statusCode = 403;
      response.end("<html><body><h1>Attention required</h1><p>Cloudflare challenge: bot blocked.</p></body></html>");
      return;
    }
    response.end("<html><body><h1>Members only</h1><p>Sign in to continue reading this content.</p></body></html>");
    return;
  }
  if (request.url === "/inconclusive-agent-response") {
    if (/GPTBot|OAI-SearchBot|ChatGPT-User/i.test(userAgent)) {
      response.statusCode = 500;
      response.end("<html><body><h1>Temporary server error</h1></body></html>");
      return;
    }
    response.end("<html><body><main><h1>Public content</h1><p>Visible without login or registration.</p></main></body></html>");
    return;
  }
  if (request.url === "/gemini-blocked") {
    if (/Google-Extended/i.test(userAgent)) {
      response.statusCode = 403;
      response.end("<html><body><h1>Access denied</h1><p>CAPTCHA bot block.</p></body></html>");
      return;
    }
    response.end("<html><body><main><h1>Public content</h1><p>Visible public page.</p></main></body></html>");
    return;
  }
  if (request.url === "/gemini-inconclusive") {
    if (/Google-Extended/i.test(userAgent)) {
      response.statusCode = 500;
      response.end("<html><body><h1>Temporary server error</h1></body></html>");
      return;
    }
    response.end("<html><body><main><h1>Public content</h1><p>Visible public page.</p></main></body></html>");
    return;
  }
  if (request.url === "/faq-only") {
    response.end(`<!doctype html><html><head><title>Frequently asked questions</title></head><body>
      <main><h1>Frequently asked questions</h1><section class="faq">
        <h2>How does the service work?</h2><p>The service provides a clear online process.</p>
      </section></main></body></html>`);
    return;
  }
  if (request.url === "/hidden-primary") {
    response.end(`<!doctype html><html><head><title>Public guide</title></head><body>
      <main><h1>Public guide</h1><p>This visible introduction explains the public page.</p>
        <section hidden>${"Important eligibility, repayment, pricing, and application information. ".repeat(30)}</section>
      </main></body></html>`);
    return;
  }
  response.end(`<!doctype html>
    <html>
      <head><title>Acme online service</title></head>
      <body>
        <main>
          <h1>Acme online service</h1>
          <p>Use Acme online without visiting a physical location.</p>
          <a href="${origin}/guide">Read our guide</a>
          <a href="https://www.facebook.com/acme">Facebook</a>
        </main>
      </body>
    </html>`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const audit = await runGeoAeoAudit(origin);

  const sameAs = check(audit, 12);
  assert.equal(sameAs.severity, "ADVISORY");
  assert.equal(sameAs.warning, true);
  assert.ok(sameAs.priorityScore >= 10 && sameAs.priorityScore <= 25);
  assert.match(sameAs.recommendation, /verified official profile/i);

  const linkedin = check(audit, 13);
  assert.equal(linkedin.passed, false);
  assert.equal(linkedin.warning, true);
  assert.equal(linkedin.skipped, undefined);

  const authorityProfile = check(audit, 14);
  assert.equal(authorityProfile.passed, false);
  assert.equal(authorityProfile.warning, true);
  assert.equal(authorityProfile.skipped, undefined);

  for (const id of [28, 29, 30, 31]) {
    assert.equal(check(audit, id).skipped, true, `Local GEO check ${id} should be skipped`);
  }

  const faqSchema = check(audit, 18);
  assert.equal(faqSchema.passed, false);
  assert.equal(faqSchema.skipped, undefined);
  const faqEvidence = JSON.parse(faqSchema.evidence);
  assert.ok(faqEvidence.pagesChecked > 0);
  assert.ok(faqEvidence.pagesFailed > 0);
  assert.ok(faqEvidence.affectedPages.some((page) => page.url.endsWith("/guide")));

  assert.equal(check(audit, 20).severity, "ADVISORY");
  assert.equal(check(audit, 25).severity, "ADVISORY");

  const density = check(audit, 34);
  assert.equal(density.severity, "ADVISORY");
  assert.equal(density.warning, true);
  assert.match(density.recommendation, /numbers, examples, comparisons/i);

  assert.match(check(audit, 32).recommendation, /initial HTML response|server-rendered/i);

  assert.equal(check(audit, 41).passed, true);
  assert.equal(check(audit, 41).skipped, undefined);
  assert.equal(check(audit, 42).passed, true);

  for (const id of [49, 50]) {
    const opportunity = check(audit, id);
    assert.equal(opportunity.passed, false);
    assert.equal(opportunity.warning, true);
    assert.equal(opportunity.informational, undefined);
    assert.equal(opportunity.severity, "ADVISORY");
    assert.equal(opportunity.priorityScore, 5);
    assert.equal(opportunity.opportunity, undefined);
    assert.match(opportunity.recommendation, /Create/i);
  }

  assert.equal(check(audit, 52).skipped, true);
  assert.equal(check(audit, 52).notApplicable, true);

  assert.equal(check(audit, 67).passed, true);
  assert.equal(check(audit, 68).passed, true);
  assert.equal(check(audit, 69).skipped, true);
  assert.match(check(audit, 69).evidence, /Unable to verify Google IP access/i);
  assert.equal(check(audit, 70).skipped, true);
  assert.equal(check(audit, 70).notApplicable, true);
  assert.match(check(audit, 70).evidence, /Google Business Profile comparison is not applicable/i);
  assert.equal(check(audit, 71).passed, true);
  for (const id of [74, 75, 76, 77]) {
    assert.equal(check(audit, id).skipped, true);
    assert.equal(check(audit, id).notApplicable, true);
  }
  assert.equal(check(audit, 78).skipped, true);
  assert.equal(check(audit, 78).notApplicable, true);

  for (const item of audit.checks.filter((item) => !item.passed && !item.skipped)) {
    const evidence = JSON.parse(item.evidence);
    assert.ok(Number.isFinite(Number(evidence.pagesCrawled)));
    assert.ok(Number(evidence.pagesChecked) > 0);
    assert.ok(Number(evidence.pagesFailed) > 0);
    assert.ok(Array.isArray(evidence.affectedPages) && evidence.affectedPages.some((page) => page.url));
  }

  const blockedAudit = await runGeoAeoAudit(`${origin}/blocked-and-paywalled`);
  const waf = check(blockedAudit, 41);
  assert.equal(waf.passed, false);
  assert.equal(waf.skipped, undefined);
  assert.match(waf.recommendation, /WAF|CAPTCHA|bot challenge/i);
  assert.ok(JSON.parse(waf.evidence).agents.some((agent) => agent.status === 403));

  const paywall = check(blockedAudit, 42);
  assert.equal(paywall.passed, false, paywall.evidence);
  assert.equal(paywall.skipped, undefined);
  assert.match(paywall.recommendation, /login|subscription|membership|registration/i);

  const inconclusiveAudit = await runGeoAeoAudit(`${origin}/inconclusive-agent-response`);
  const inconclusiveWaf = check(inconclusiveAudit, 41);
  assert.equal(inconclusiveWaf.passed, true);
  assert.equal(inconclusiveWaf.skipped, true);
  assert.match(inconclusiveWaf.evidence, /Insufficient evidence|inconclusive/i);

  const geminiBlockedAudit = await runGeoAeoAudit(`${origin}/gemini-blocked`);
  assert.equal(check(geminiBlockedAudit, 67).passed, false);
  assert.equal(check(geminiBlockedAudit, 68).passed, false);
  assert.equal(JSON.parse(check(geminiBlockedAudit, 68).evidence).status, 403);

  const geminiInconclusiveAudit = await runGeoAeoAudit(`${origin}/gemini-inconclusive`);
  for (const id of [67, 68]) {
    assert.equal(check(geminiInconclusiveAudit, id).passed, true);
    assert.equal(check(geminiInconclusiveAudit, id).skipped, true);
  }

  const faqOnlyAudit = await runGeoAeoAudit(`${origin}/faq-only`);
  assert.equal(check(faqOnlyAudit, 20).skipped, true);
  assert.equal(check(faqOnlyAudit, 20).notApplicable, true);
  assert.equal(check(faqOnlyAudit, 21).skipped, undefined);

  const hiddenPrimaryAudit = await runGeoAeoAudit(`${origin}/hidden-primary`);
  const hiddenPrimary = check(hiddenPrimaryAudit, 33);
  assert.equal(hiddenPrimary.passed, false);
  assert.match(hiddenPrimary.recommendation, /primary content visible/i);
  const hiddenEvidence = JSON.parse(hiddenPrimary.evidence);
  assert.equal(hiddenEvidence.pagesFailed, 1);
  assert.ok(hiddenEvidence.affectedPages.some((page) => page.url.endsWith("/hidden-primary")));
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("GEO/AEO accuracy tests passed");
