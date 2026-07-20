import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BuildManifest, Publication } from "./model.js";
import { loadConfig } from "./config.js";
import { parseMarkdown } from "./pandoc.js";
import { collectAssets } from "./assets.js";
import { renderWeb } from "./web.js";
import { renderEpub } from "./epub.js";
import { renderPdf } from "./pdf.js";
import { loadTheme } from "./theme-loader.js";
import { loadPrintProfile } from "./profile-loader.js";
import { rewriteChapterLinks } from "./links.js";
import { projectToolExecutable } from "./tool-paths.js";
import { BOOKFORGE_VERSION, atomicReplaceDirectory, commandVersion, containedPath, run, sha256, sourceEpochDate } from "./util.js";

export type Format = "web" | "epub" | "pdf";

export async function createPublication(projectRoot: string, themeOverride?: string): Promise<{ publication: Publication; config: Awaited<ReturnType<typeof loadConfig>>; theme: Awaited<ReturnType<typeof loadTheme>>; sourceHash: string }> {
  const config = await loadConfig(projectRoot);
  const theme = await loadTheme(projectRoot, themeOverride ?? config.theme);
  const hashes: string[] = [await readFile(path.join(projectRoot, "book.yaml"), "utf8")];
  const spine = [];
  for (const chapter of config.chapters) {
    const file = containedPath(projectRoot, chapter.path);
    hashes.push(await readFile(file, "utf8"));
    spine.push(await parseMarkdown(file, projectRoot, chapter.id, chapter.role, chapter.title));
  }
  const publication: Publication = {
    schemaVersion: 1,
    id: config.id,
    metadata: {
      title: config.title,
      ...(config.subtitle ? { subtitle: config.subtitle } : {}),
      language: config.language,
      authors: config.authors.map((author) => author.name),
    },
    spine,
    assets: [],
  };
  rewriteChapterLinks(publication, projectRoot, config.chapters);
  await collectAssets(publication, projectRoot);
  hashes.push(theme.hash);
  for (const asset of [...publication.assets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) hashes.push(asset.hash);
  return { publication, config, theme, sourceHash: sha256(hashes.join("\n\0\n")) };
}

function isFormat(value: string): value is Format {
  return value === "web" || value === "epub" || value === "pdf";
}

export async function buildProject(project: string, requested?: string[], themeOverride?: string): Promise<string> {
  const projectRoot = path.resolve(project);
  const { publication, config, theme, sourceHash } = await createPublication(projectRoot, themeOverride);
  const configured = Object.keys(config.outputs);
  const candidates = requested?.length ? requested : configured;
  const unsupported = candidates.filter((format) => !isFormat(format));
  if (unsupported.length) throw new Error(`Unknown formats: ${unsupported.join(", ")}`);
  const formats = candidates.filter(isFormat);
  const stage = await mkdtemp(path.join(projectRoot, ".bookforge-stage-"));
  try {
    if (formats.includes("web")) await renderWeb(publication, theme, path.join(stage, "web"), config.outputs.web?.reading ?? "paged");
    if (formats.includes("epub")) {
      const epub = path.join(stage, "book.epub");
      await renderEpub(publication, theme, epub);
      const checked = await run("epubcheck", [epub], { quiet: true });
      if (checked.code !== 0) throw new Error(`EPUBCheck failed:\n${checked.stdout}\n${checked.stderr}`);
    }
    const printProfile = formats.includes("pdf") ? await loadPrintProfile(projectRoot, config.outputs.pdf) : undefined;
    if (printProfile) await renderPdf(publication, theme, printProfile, stage, path.join(stage, "book.pdf"));
    const versions = await toolVersions(formats);
    const manifest: BuildManifest = {
      bookforgeVersion: BOOKFORGE_VERSION,
      schemaVersion: 1,
      publicationId: publication.id,
      sourceHash,
      theme: { id: theme.id, version: theme.version, hash: theme.hash, source: theme.source },
      ...(printProfile ? { printProfile: { id: printProfile.id, hash: printProfile.hash, source: printProfile.source } } : {}),
      toolVersions: versions,
      formats,
      timestamp: sourceEpochDate().toISOString(),
    };
    await writeFile(path.join(stage, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const destination = path.join(projectRoot, "dist");
    await atomicReplaceDirectory(stage, destination, path.join(projectRoot, ".bookforge-previous-dist"));
    return destination;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function toolVersions(formats: Format[]): Promise<Record<string, string>> {
  const commands: Array<[string, string, string[]]> = [["node", "node", ["--version"]], ["pandoc", "pandoc", ["--version"]]];
  if (formats.includes("epub")) commands.push(["epubcheck", "epubcheck", ["--version"]]);
  if (formats.includes("pdf")) commands.push(["vivliostyle", projectToolExecutable(path.resolve(import.meta.dirname, ".."), "vivliostyle"), ["--version"]]);
  const versions: Record<string, string> = {};
  for (const [key, command, args] of commands) {
    const result = await run(command, args, { cwd: path.resolve(import.meta.dirname, ".."), quiet: true });
    versions[key] = result.code === 0 ? commandVersion(result.stdout || result.stderr) : "unavailable";
  }
  return versions;
}
