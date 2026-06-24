import assert from "node:assert/strict";
import http from "node:http";
import { runIndexabilityAudit } from "../dist/indexability-audit.js";

function check(audit, id) {
  const found = audit.checks.find((item) => item.id === id);
  assert.ok(found, `Expected indexability check ${id}`);
  return found;
}

const server = http.createServer((request, response) => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  response.setHeader("content-type", "text/html; charset=utf-8");

  if (request.url?.startsWith("/random-url-") || request.url === "/nonexistent-page-seo-audit-test/") {
    response.statusCode = 404;
    response.end("<h1>Not found</h1>");
    return;
  }
  if (request.url === "/hidden-primary") {
    response.end(`<!doctype html><html><head><link rel="canonical" href="${origin}/hidden-primary"></head><body>
      <main><h1>Guide</h1><p>Visible introduction.</p>
        <section hidden>${"Important crawlable eligibility and repayment information. ".repeat(35)}</section>
      </main></body></html>`);
    return;
  }
  if (request.url === "/infinite-scroll") {
    response.end(`<!doctype html><html><head><link rel="canonical" href="${origin}/infinite-scroll"></head><body>
      <main><h1>Article listing</h1><div id="articles"><article>Article one</article></div>
        <script>const observer = new IntersectionObserver(() => { nextPage++; articles.insertAdjacentHTML("beforeend", html); });</script>
      </main></body></html>`);
    return;
  }
  response.end(`<!doctype html><html><head><link rel="canonical" href="${origin}/"></head><body>
    <header><nav hidden>${"Hidden navigation item ".repeat(120)}</nav></header>
    <main><h1>Public page</h1><p>${"Visible public content. ".repeat(80)}</p></main>
  </body></html>`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const audit = await runIndexabilityAudit(origin);

  const hidden = check(audit, 24);
  assert.equal(hidden.passed, true);
  assert.equal(hidden.skipped, false);

  const infiniteScroll = check(audit, 26);
  assert.equal(infiniteScroll.passed, true);
  assert.equal(infiniteScroll.skipped, true);
  assert.equal(infiniteScroll.notApplicable, true);
  assert.match(infiniteScroll.evidence.reason, /No infinite-scroll or auto-loading content behavior detected/i);

  for (const id of [19, 20]) {
    assert.equal(check(audit, id).skipped, true);
    assert.equal(check(audit, id).notApplicable, true);
  }

  const hiddenAudit = await runIndexabilityAudit(`${origin}/hidden-primary`);
  const hiddenFailure = check(hiddenAudit, 24);
  assert.equal(hiddenFailure.passed, false);
  assert.equal(hiddenFailure.skipped, false);
  assert.match(hiddenFailure.recommendation, /primary content visible/i);
  assert.equal(hiddenFailure.evidence.pagesChecked, 1);
  assert.equal(hiddenFailure.evidence.pagesFailed, 1);
  assert.ok(hiddenFailure.evidence.affectedPages.some((page) => page.url.endsWith("/hidden-primary")));

  const noPrimaryAudit = await runIndexabilityAudit(origin, "<html><body><div>Page without a reliable primary container.</div></body></html>");
  const noPrimaryHidden = check(noPrimaryAudit, 24);
  assert.equal(noPrimaryHidden.passed, true);
  assert.equal(noPrimaryHidden.skipped, true);
  assert.equal(noPrimaryHidden.evidence.reason, "Insufficient evidence to determine hidden-content usage.");

  const infiniteAudit = await runIndexabilityAudit(`${origin}/infinite-scroll`);
  const infiniteFailure = check(infiniteAudit, 26);
  assert.equal(infiniteFailure.passed, false);
  assert.equal(infiniteFailure.skipped, false);
  assert.equal(infiniteFailure.evidence.infiniteScrollDetected, true);
  assert.equal(infiniteFailure.evidence.paginationDetected, false);

  for (const item of hiddenAudit.checks.filter((item) => !item.passed && !item.skipped)) {
    assert.ok(Number(item.evidence.pagesChecked) > 0);
    assert.ok(Number(item.evidence.pagesFailed) > 0);
    assert.ok(Array.isArray(item.evidence.affectedPages) && item.evidence.affectedPages.some((page) => page.url));
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("Indexability audit accuracy tests passed");
