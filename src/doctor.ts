import path from "node:path";
import { browserSetupMessage, resolveBrowser } from "./browser.js";
import { projectToolExecutable } from "./tool-paths.js";
import { run } from "./util.js";

interface ToolCheck { name: string; command: string; args: string[]; expected?: RegExp; remedy: string; cwd?: string; required?: boolean }

export async function doctor(): Promise<boolean> {
  const root = path.resolve(import.meta.dirname, "..");
  const checks: ToolCheck[] = [
    { name: "Node.js", command: "node", args: ["--version"], expected: /^v24\.18\.0$/, remedy: "Install or select Node.js 24.18.0; see docs/RELEASES.md for setup guidance." },
    { name: "pnpm", command: "pnpm", args: ["--version"], expected: /^10\.26\.1$/, remedy: "Only needed to install or update Bookforge; see docs/RELEASES.md for setup guidance.", required: false },
    { name: "Pandoc", command: "pandoc", args: ["--version"], expected: /^pandoc 3\.7\.0\.2\b/, remedy: "Install Pandoc 3.7.0.2 and ensure it is on PATH; see docs/RELEASES.md." },
    { name: "EPUBCheck", command: "epubcheck", args: ["--version"], expected: /^EPUBCheck v5\.3\.0\b/, remedy: "Install EPUBCheck 5.3.0 and ensure epubcheck is on PATH; see docs/RELEASES.md." },
    { name: "Vivliostyle", command: projectToolExecutable(root, "vivliostyle"), args: ["--version"], expected: /cli: 11\.1\.0/, remedy: "Reinstall Bookforge or set BOOKFORGE_VIVLIOSTYLE; see docs/RELEASES.md.", cwd: root },
    { name: "Poppler", command: "pdfinfo", args: ["-v"], remedy: "Install Poppler and ensure pdfinfo is on PATH; see docs/RELEASES.md." },
  ];
  const browser = await resolveBrowser().catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
  if (browser && "executable" in browser) checks.push({ name: `Browser (${browser.source})`, command: browser.executable, args: ["--version"], remedy: "Set BOOKFORGE_BROWSER to a supported browser executable; see docs/RELEASES.md." });
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
    console.log(`✗ Browser: ${browser && "error" in browser ? browser.error : browserSetupMessage()}`);
    if (browser && "error" in browser) console.log(`  ${browserSetupMessage()}`);
  }
  return healthy;
}
