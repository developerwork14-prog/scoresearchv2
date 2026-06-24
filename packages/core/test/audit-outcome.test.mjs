import assert from "node:assert/strict";
import {
  scoreParameterOutcomes,
  statusForParameterOutcomes
} from "../dist/audit-outcome.js";
import { outcomeForEvidence } from "../dist/site-audit-evidence.js";

const mostlyPassing = [
  ...Array.from({ length: 9 }, () => ({ passed: true })),
  { passed: false }
];

assert.equal(scoreParameterOutcomes(mostlyPassing), 90);
assert.equal(statusForParameterOutcomes(mostlyPassing), "Needs Attention");
assert.equal(
  statusForParameterOutcomes([{ passed: true }, { passed: false, warning: true }]),
  "Minor Attention"
);
assert.equal(
  statusForParameterOutcomes([{ passed: true, skipped: true }]),
  "Skipped"
);
assert.equal(
  scoreParameterOutcomes([
    { passed: true },
    { passed: false, informational: true, weight: 0 }
  ]),
  100
);
assert.equal(
  statusForParameterOutcomes([
    { passed: true },
    { passed: false, severity: "Advisory" }
  ]),
  "Passed"
);

const partialFailure = outcomeForEvidence({
  scope: "page-level-site-wide",
  pagesCrawled: 10,
  pagesChecked: 10,
  pagesPassed: 9,
  pagesFailed: 1,
  passRate: 90,
  affectedPages: [],
  sampleEvidence: []
});

assert.equal(partialFailure.passed, false);
assert.equal(partialFailure.warning, false);
assert.equal(partialFailure.severity, "Medium");

console.log("audit outcome tests passed");
