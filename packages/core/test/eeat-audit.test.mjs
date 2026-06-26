import assert from "node:assert/strict";
import http from "node:http";
import { runEeatAudit } from "../dist/eeat-audit.js";

function check(audit, id) {
  const found = audit.checks.find((item) => item.id === id);
  assert.ok(found, `Expected EEAT check ${id}`);
  return found;
}

const server = http.createServer((request, response) => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  response.setHeader("content-type", "text/html; charset=utf-8");

  if (request.url === "/privacy") {
    response.end(`<main><h1>Privacy policy</h1><p>${"We describe data collection, consent, use, retention, security, rights, and contact procedures. ".repeat(25)}</p></main>`);
    return;
  }
  if (request.url === "/terms") {
    response.end(`<main><h1>Terms and conditions</h1><p>${"These terms describe eligibility, service use, responsibilities, limitations, complaints, and contact procedures. ".repeat(20)}</p></main>`);
    return;
  }
  if (request.url === "/contact") {
    response.end("<main><h1>Contact us</h1><p>Call +91 9876543210 for support.</p></main>");
    return;
  }
  if (request.url === "/blogs") {
    response.end("<main><h1>Latest articles</h1><a href='/blogs/guide'>Responsible borrowing guide</a></main>");
    return;
  }
  if (request.url === "/blogs/guide") {
    response.end(`<article><h1>Responsible borrowing guide</h1><p>Written by A. Expert</p>
      <a rel="author" href="/author/a-expert">A. Expert</a>
      <p>${"This detailed guide explains borrowing decisions and repayment planning. ".repeat(35)}</p>
      <a href="https://www.rbi.org.in/">Reserve Bank of India</a>
    </article>`);
    return;
  }
  if (request.url === "/author/a-expert") {
    response.end(`<main><h1>A. Expert</h1><p>${"A. Expert writes educational financial guidance based on relevant professional experience. ".repeat(20)}</p></main>`);
    return;
  }
  if (request.url === "/blogs/no-byline") {
    response.end(`<article><h1>Responsible borrowing guide</h1><p>${"This detailed guide explains borrowing decisions and repayment planning. ".repeat(35)}</p></article>`);
    return;
  }

  response.end(`<main><h1>Online financial service</h1>
    <a href="${origin}/blogs">Blogs</a>
    <a href="${origin}/contact">Contact us</a>
    <a href="${origin}/privacy">Privacy policy</a>
    <a href="${origin}/terms">Terms and conditions</a>
    <p>Apply online or call our office for support.</p>
  </main>`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const homepageAudit = await runEeatAudit(origin);

  for (const id of [7, 15, 19]) {
    const item = check(homepageAudit, id);
    assert.equal(item.passed, false, `EEAT check ${id} should surface missing trust evidence`);
    assert.equal(item.skipped, false);
    assert.equal(item.evidence.pagesFailed, 1);
  }
  assert.equal(check(homepageAudit, 1).passed, true);
  assert.equal(check(homepageAudit, 2).passed, true);
  assert.equal(check(homepageAudit, 3).passed, true);
  assert.equal(check(homepageAudit, 16).passed, false);
  assert.equal(check(homepageAudit, 16).warning, true);
  assert.equal(check(homepageAudit, 17).passed, true);
  assert.equal(check(homepageAudit, 12).passed, true);
  assert.equal(check(homepageAudit, 13).passed, true);
  assert.equal(check(homepageAudit, 10).passed, false);
  assert.equal(check(homepageAudit, 10).skipped, false);
  const homepageFailures = homepageAudit.checks.filter((item) => !item.passed && !item.skipped);
  assert.ok(homepageFailures.length >= 4, JSON.stringify(homepageFailures));

  const articleAudit = await runEeatAudit(`${origin}/blogs/no-byline`);
  const byline = check(articleAudit, 1);
  assert.equal(byline.passed, false);
  assert.equal(byline.skipped, false);
  assert.match(byline.recommendation, /visible author or reviewer byline/i);
  assert.equal(byline.evidence.pagesChecked, 1);
  assert.equal(byline.evidence.pagesFailed, 1);
  assert.ok(byline.evidence.affectedPages.some((page) => page.url.endsWith("/blogs/no-byline")));
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("EEAT audit accuracy tests passed");
