import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

export interface BrowserResolution {
  executable: string;
  source: "environment" | "platform";
}

export function browserCandidates(platform = process.platform, environment: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === "darwin") return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ...(environment.HOME ? [
      path.posix.join(environment.HOME, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      path.posix.join(environment.HOME, "Applications", "Chromium.app", "Contents", "MacOS", "Chromium"),
    ] : []),
  ];
  if (platform === "linux") return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
  return [];
}

export function browserSetupMessage(platform = process.platform): string {
  if (platform === "win32") return "Windows is not a supported Bookforge runtime target. Use macOS or Linux; installed releases include docs/RELEASES.md for setup guidance.";
  return "No supported browser was found. Set BOOKFORGE_BROWSER to a Chrome- or Chromium-based browser executable; installed releases include docs/RELEASES.md for setup guidance.";
}

export async function resolveBrowser(environment: NodeJS.ProcessEnv = process.env, platform = process.platform): Promise<BrowserResolution | undefined> {
  if (platform === "win32") return undefined;
  const configured = environment.BOOKFORGE_BROWSER;
  if (configured) {
    const executable = await resolveExecutable(configured, environment.PATH);
    if (!executable) throw new Error(`BOOKFORGE_BROWSER does not resolve to an executable: ${configured}`);
    return { executable, source: "environment" };
  }
  for (const candidate of browserCandidates(platform, environment)) {
    const executable = await resolveExecutable(candidate, environment.PATH);
    if (executable) return { executable, source: "platform" };
  }
  return undefined;
}

async function resolveExecutable(candidate: string, searchPath: string | undefined): Promise<string | undefined> {
  if (path.posix.isAbsolute(candidate) || candidate.includes(path.posix.sep)) return await isExecutable(candidate) ? candidate : undefined;
  for (const directory of (searchPath ?? "").split(path.posix.delimiter).filter(Boolean)) {
    const fullPath = path.posix.join(directory, candidate);
    if (await isExecutable(fullPath)) return fullPath;
  }
  return undefined;
}

async function isExecutable(file: string): Promise<boolean> {
  return await access(file, constants.X_OK).then(() => true).catch(() => false);
}
