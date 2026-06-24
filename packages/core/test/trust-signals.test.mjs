import assert from "node:assert/strict";
import http from "node:http";
import { addressCandidates, phoneCandidates, runTrustSignalsAudit } from "../dist/trust-signals-audit.js";

const contactText = `
  Contact Us Office Address 1 and 2 Floor Khykha Court II 82 Stage 2 Block Hosur
  Main road, Koramangala, Bangalore, Karnataka, India 560034
  Our Email service@example.com Call Center 022489-30118
  Plugin version 3.23.0 - 25-07-2024
`;

assert.deepEqual(phoneCandidates(contactText), ["022489-30118"]);

assert.equal(
  addressCandidates(contactText)[0],
  "1 and 2 Floor Khykha Court II 82 Stage 2 Block Hosur Main road, Koramangala, Bangalore, Karnataka, India 560034"
);

function check(audit, id) {
  const found = audit.checks.find((item) => item.id === id);
  assert.ok(found, `Expected trust-signal check ${id}`);
  return found;
}

const server = http.createServer((request, response) => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  response.setHeader("content-type", "text/html; charset=utf-8");

  if (request.url === "/contact") {
    response.end("<main><h1>Contact support</h1><p>Call +91 9876543210 for assistance.</p><form><input name='message'></form></main>");
    return;
  }
  if (request.url === "/privacy") {
    response.end("<main><h1>Privacy policy</h1><p>We explain data collection, use, consent, retention, security, and user rights.</p></main>");
    return;
  }
  response.end(`<!doctype html><html><body><main><h1>Acme financial services</h1>
    <a href="${origin}/contact">Contact</a><a href="${origin}/privacy">Privacy</a>
    <p>Apply for a personal loan online.</p><footer>Copyright 2026 Acme</footer>
  </main></body></html>`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const audit = await runTrustSignalsAudit(origin, undefined, "Acme", "");

  for (const id of [1, 2, 3, 5, 9]) {
    assert.equal(check(audit, id).skipped, true, `NAP comparison check ${id} should skip without schema comparison data`);
    assert.match(check(audit, id).evidence.reason, /Insufficient evidence/i);
  }

  const email = check(audit, 4);
  assert.equal(email.passed, true);
  assert.equal(email.skipped, false);

  const security = check(audit, 13);
  assert.equal(security.passed, false);
  assert.match(security.recommendation, /security headers|Strict-Transport-Security|X-Frame-Options/i);
  assert.ok(security.evidence.missingSecurityHeaders.includes("Strict-Transport-Security"));
  assert.equal(security.evidence.pagesChecked, 1);
  assert.equal(security.evidence.pagesFailed, 1);

  const registration = check(audit, 14);
  assert.equal(registration.severity, "Advisory");
  assert.equal(registration.warning, true);
  assert.ok(registration.priorityScore <= 20);

  const privacyRecency = check(audit, 15);
  assert.equal(privacyRecency.skipped, true);
  assert.equal(privacyRecency.evidence.reason, "Unable to verify policy update date.");

  const dateParity = check(audit, 10);
  assert.equal(dateParity.skipped, true);
  assert.match(dateParity.evidence.reason, /no comparable (?:schema|visible) date/i);

  for (const item of audit.checks.filter((item) => !item.passed && !item.skipped)) {
    assert.ok(Number(item.evidence.pagesChecked) > 0);
    assert.ok(Number(item.evidence.pagesFailed) > 0);
    assert.ok(Array.isArray(item.evidence.affectedPages) && item.evidence.affectedPages.some((page) => page.url));
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("trust signals helper tests passed");
