import path from "node:path";
import { browserSetupMessage, resolveBrowser } from "./browser.js";
import { projectToolExecutable } from "./tool-paths.js";
import { run } from "./util.js";

interface ToolCheck { name: string; command: string; args: string[]; expected?: RegExp; remedy: string; cwd?: string; required?: boolean }

export interface DoctorDependencies {
  resolveBrowser?: typeof resolveBrowser;
  run?: typeof run;
  log?: (message?: unknown, ...optionalParams: unknown[]) => void;
}

const supportedBrowserVersion = /^(?:(?:Google )?Chrome(?: for Testing)?|Chromium|(?:Microsoft )?Edge)\s+\d+(?:\.\d+)+\b/i;

export async function doctor(dependencies: DoctorDependencies = {}): Promise<boolean> {
  const root = path.resolve(import.meta.dirname, "..");
  const releaseGuide = path.join(root, "docs", "RELEASES.md");
  const probe = dependencies.run ?? run;
  const log = dependencies.log ?? console.log;
  const checks: ToolCheck[] = [
    { name: "Node.js", command: "node", args: ["--version"], expected: /^v24\.18\.0$/, remedy: `Install or select Node.js 24.18.0; see ${releaseGuide} for setup guidance.` },
    { name: "Pandoc", command: "pandoc", args: ["--version"], expected: /^pandoc 3\.7\.0\.2\b/, remedy: `Install Pandoc 3.7.0.2 and ensure it is on PATH; see ${releaseGuide}.` },
    { name: "EPUBCheck", command: "epubcheck", args: ["--version"], expected: /^EPUBCheck v5\.3\.0\b/, remedy: `Install EPUBCheck 5.3.0 and ensure epubcheck is on PATH; see ${releaseGuide}.` },
    { name: "Vivliostyle", command: projectToolExecutable(root, "vivliostyle"), args: ["--version"], expected: /cli: 11\.1\.0/, remedy: `Reinstall Bookforge or set BOOKFORGE_VIVLIOSTYLE; see ${releaseGuide}.`, cwd: root },
    { name: "Poppler", command: "pdfinfo", args: ["-v"], remedy: `Install Poppler and ensure pdfinfo is on PATH; see ${releaseGuide}.` },
  ];
  const browser = await (dependencies.resolveBrowser ?? resolveBrowser)().catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
  if (browser && "executable" in browser) checks.push({ name: `Browser (${browser.source})`, command: browser.executable, args: ["--version"], expected: supportedBrowserVersion, remedy: `Set BOOKFORGE_BROWSER to a supported browser executable; see ${releaseGuide}.` });
  let healthy = true;
  log("Bookforge doctor\n");
  const results = await Promise.all(checks.map(async (check) => {
    const result = await probe(check.command, check.args, { ...(check.cwd ? { cwd: check.cwd } : {}), quiet: true }).catch(() => undefined);
    const output = `${result?.stdout ?? ""}${result?.stderr ?? ""}`.trim();
    const okay = result?.code === 0 && (!check.expected || check.expected.test(output));
    return { check, okay, output };
  }));
  for (const { check, okay, output } of results) {
    if (check.required !== false) healthy &&= okay;
    log(`${okay ? "✓" : check.required === false ? "!" : "✗"} ${check.name}: ${output.split(/\r?\n/, 1)[0] || "unavailable"}`);
    if (!okay) log(`  ${check.remedy}`);
  }
  if (!browser || !("executable" in browser)) {
    healthy = false;
    log(`✗ Browser: ${browser && "error" in browser ? browser.error : browserSetupMessage()}`);
    if (browser && "error" in browser) log(`  ${browserSetupMessage()}`);
  }
  return healthy;
}
