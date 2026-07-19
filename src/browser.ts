import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

export interface BrowserResolution {
  executable: string;
  source: "environment" | "platform";
}

export function browserCandidates(platform = process.platform): string[] {
  if (platform === "darwin") return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  if (platform === "linux") return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
  if (platform === "win32") return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "msedge.exe",
  ];
  return [];
}

export async function resolveBrowser(environment: NodeJS.ProcessEnv = process.env, platform = process.platform): Promise<BrowserResolution | undefined> {
  const configured = environment.BOOKFORGE_BROWSER;
  if (configured) {
    const executable = await resolveExecutable(configured, environment.PATH);
    if (!executable) throw new Error(`BOOKFORGE_BROWSER does not resolve to an executable: ${configured}`);
    return { executable, source: "environment" };
  }
  for (const candidate of browserCandidates(platform)) {
    const executable = await resolveExecutable(candidate, environment.PATH);
    if (executable) return { executable, source: "platform" };
  }
  return undefined;
}

async function resolveExecutable(candidate: string, searchPath = process.env.PATH): Promise<string | undefined> {
  if (path.isAbsolute(candidate) || candidate.includes(path.sep)) return await isExecutable(candidate) ? candidate : undefined;
  for (const directory of (searchPath ?? "").split(path.delimiter).filter(Boolean)) {
    const fullPath = path.join(directory, candidate);
    if (await isExecutable(fullPath)) return fullPath;
  }
  return undefined;
}

async function isExecutable(file: string): Promise<boolean> {
  return await access(file, constants.X_OK).then(() => true).catch(() => false);
}
