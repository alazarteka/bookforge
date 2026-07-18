import path from "node:path";
import { run } from "./util.js";

interface ToolCheck { name: string; command: string; args: string[]; expected?: RegExp; remedy: string; cwd?: string }

export async function doctor(): Promise<boolean> {
  const root = path.resolve(import.meta.dirname, "..");
  const checks: ToolCheck[] = [
    { name: "Node.js", command: "node", args: ["--version"], expected: /^v24\./, remedy: "Use /opt/homebrew/opt/node@24/bin first in PATH." },
    { name: "pnpm", command: "pnpm", args: ["--version"], expected: /^10\.26\.1$/, remedy: "Install or activate pnpm 10.26.1." },
    { name: "Pandoc", command: "pandoc", args: ["--version"], expected: /^pandoc 3\.7\.0\.2\b/, remedy: "Install Pandoc 3.7.0.2." },
    { name: "EPUBCheck", command: "epubcheck", args: ["--version"], expected: /^EPUBCheck v5\.3\.0\b/, remedy: "Run brew install epubcheck." },
    { name: "Vivliostyle", command: "pnpm", args: ["exec", "vivliostyle", "--version"], expected: /cli: 11\.1\.0/, remedy: "Run pnpm install --frozen-lockfile.", cwd: root },
    { name: "Poppler", command: "pdfinfo", args: ["-v"], remedy: "Run brew install poppler." },
  ];
  let healthy = true;
  console.log("Bookforge doctor\n");
  for (const check of checks) {
    const result = await run(check.command, check.args, { ...(check.cwd ? { cwd: check.cwd } : {}), quiet: true }).catch(() => undefined);
    const output = `${result?.stdout ?? ""}${result?.stderr ?? ""}`.trim();
    const okay = result?.code === 0 && (!check.expected || check.expected.test(output));
    healthy &&= okay;
    console.log(`${okay ? "✓" : "✗"} ${check.name}: ${output.split(/\r?\n/, 1)[0] || "unavailable"}`);
    if (!okay) console.log(`  ${check.remedy}`);
  }
  return healthy;
}
