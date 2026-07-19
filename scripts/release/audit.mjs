import { spawn } from "node:child_process";
import process from "node:process";
import { parseAuditReport, vulnerabilityTotal } from "./audit-lib.mjs";

function runAudit() {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["audit", "--json"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

try {
  const { code, stdout, stderr } = await runAudit();
  const counts = parseAuditReport(stdout);
  const total = vulnerabilityTotal(counts);
  if (code !== 0 || total !== 0) {
    throw new Error(`dependency audit failed (${total} vulnerabilities; pnpm exit ${code})${stderr ? `\n${stderr.trim()}` : ""}`);
  }
  console.log("Dependency audit passed: no published vulnerabilities reported");
} catch (error) {
  console.error(`Dependency audit failed closed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
