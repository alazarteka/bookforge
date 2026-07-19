export function parseAuditReport(raw) {
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    throw new Error("pnpm audit did not produce a valid JSON report");
  }
  const vulnerabilities = report?.metadata?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object") {
    throw new Error("pnpm audit JSON is missing metadata.vulnerabilities");
  }
  const levels = ["info", "low", "moderate", "high", "critical"];
  const counts = {};
  for (const level of levels) {
    const count = vulnerabilities[level];
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`pnpm audit JSON has an invalid ${level} vulnerability count`);
    counts[level] = count;
  }
  return counts;
}

export function vulnerabilityTotal(counts) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}
