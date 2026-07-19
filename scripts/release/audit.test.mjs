import assert from "node:assert/strict";
import test from "node:test";
import { parseAuditReport, vulnerabilityTotal } from "./audit-lib.mjs";

const noVulnerabilities = JSON.stringify({
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } },
});

test("accepts a complete zero-vulnerability pnpm audit report", () => {
  const counts = parseAuditReport(noVulnerabilities);
  assert.equal(vulnerabilityTotal(counts), 0);
});

test("keeps every advisory severity in the failure total", () => {
  const counts = parseAuditReport(JSON.stringify({
    metadata: { vulnerabilities: { info: 1, low: 2, moderate: 3, high: 4, critical: 5 } },
  }));
  assert.equal(vulnerabilityTotal(counts), 15);
});

test("fails closed on unavailable or malformed audit output", () => {
  assert.throws(() => parseAuditReport("registry request failed"), /valid JSON/);
  assert.throws(() => parseAuditReport("{}"), /metadata\.vulnerabilities/);
  assert.throws(() => parseAuditReport(JSON.stringify({ metadata: { vulnerabilities: { info: 0 } } })), /invalid low/);
});
