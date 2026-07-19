import path from "node:path";
import { resolveBrowser } from "./browser.js";
import { run } from "./util.js";

interface ToolCheck { name: string; command: string; args: string[]; expected?: RegExp; remedy: string; cwd?: string; required?: boolean }

export async function doctor(): Promise<boolean> {
  const root = path.resolve(import.meta.dirname, "..");
  const checks: ToolCheck[] = [
    { name: "Node.js", command: "node", args: ["--version"], expected: /^v24\./, remedy: "Use /opt/homebrew/opt/node@24/bin first in PATH." },
    { name: "pnpm", command: "pnpm", args: ["--version"], expected: /^10\.26\.1$/, remedy: "Only needed to install or update Bookforge; activate Corepack when needed.", required: false },
    { name: "Pandoc", command: "pandoc", args: ["--version"], expected: /^pandoc 3\.7\.0\.2\b/, remedy: "Install Pandoc 3.7.0.2." },
    { name: "EPUBCheck", command: "epubcheck", args: ["--version"], expected: /^EPUBCheck v5\.3\.0\b/, remedy: "Run brew install epubcheck." },
    { name: "Vivliostyle", command: path.join(root, "node_modules", ".bin", "vivliostyle"), args: ["--version"], expected: /cli: 11\.1\.0/, remedy: "Run pnpm install --frozen-lockfile.", cwd: root },
    { name: "Poppler", command: "pdfinfo", args: ["-v"], remedy: "Run brew install poppler." },
  ];
  const browser = await resolveBrowser().catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
  if (browser && "executable" in browser) checks.push({ name: `Browser (${browser.source})`, command: browser.executable, args: ["--version"], remedy: "Install Chrome or Chromium, or set BOOKFORGE_BROWSER to its executable path." });
  let healthy = true;
  console.log("Bookforge doctor\n");
  for (const check of checks) {
    const result = await run(check.command, check.args, { ...(check.cwd ? { cwd: check.cwd } : {}), quiet: true }).catch(() => undefined);
    const output = `${result?.stdout ?? ""}${result?.stderr ?? ""}`.trim();
    const okay = result?.code === 0 && (!check.expected || check.expected.test(output));
    if (check.required !== false) healthy &&= okay;
    console.log(`${okay ? "✓" : check.required === false ? "!" : "✗"} ${check.name}: ${output.split(/\r?\n/, 1)[0] || "unavailable"}`);
    if (!okay) console.log(`  ${check.remedy}`);
  }
  if (!browser || !("executable" in browser)) {
    healthy = false;
    console.log(`✗ Browser: ${browser && "error" in browser ? browser.error : "unavailable"}`);
    console.log("  Install Chrome or Chromium, or set BOOKFORGE_BROWSER to its executable path.");
  }
  return healthy;
}
