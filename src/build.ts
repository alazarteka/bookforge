import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
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
import { visitBlocks, visitPublication } from "./traversal.js";
import { projectToolExecutable } from "./tool-paths.js";
import { BOOKFORGE_VERSION, commandVersion, containedPath, run, sha256, sourceEpochDate } from "./util.js";

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
  resolveChapterLinks(publication, projectRoot, config.chapters);
  await collectAssets(publication, projectRoot);
  hashes.push(theme.hash);
  for (const asset of [...publication.assets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) hashes.push(asset.hash);
  return { publication, config, theme, sourceHash: sha256(hashes.join("\n\0\n")) };
}

function resolveChapterLinks(publication: Publication, projectRoot: string, chapters: Array<{ id: string; path: string }>): void {
  const chapterPaths = new Map(chapters.map((chapter) => [normalizedProjectPath(projectRoot, chapter.path), chapter.id]));
  const headings = new Map(publication.spine.map((section) => [section.id, headingTargets(section)]));
  const resolveFragment = (sectionId: string, fragment: string, href: string): string => {
    const target = headings.get(sectionId)?.get(fragment);
    if (!target) throw new Error(`Broken heading link: ${href}`);
    return target;
  };
  visitPublication(publication, {
    inline: (inline, context) => {
      if (inline.type !== "link") return;
      const sectionId = context.section?.id;
      if (!sectionId) throw new Error("Link traversal requires a publication section");
      const [file, fragment] = inline.href.split("#", 2);
      if (!file && fragment) inline.href = `#${resolveFragment(sectionId, fragment, inline.href)}`;
      else if (file && /\.md$/i.test(file)) {
        const targetId = chapterPaths.get(normalizedProjectPath(projectRoot, file));
        if (!targetId) throw new Error(`Broken chapter link: ${inline.href}`);
        const targetFragment = fragment ? `#${resolveFragment(targetId, fragment, inline.href)}` : "";
        inline.href = `${targetId}.md${targetFragment}`;
      }
    },
  }, { includeTitles: true });
}

function normalizedProjectPath(projectRoot: string, value: string): string {
  return path.relative(projectRoot, path.resolve(projectRoot, value)).replaceAll("\\", "/");
}

function headingTargets(section: Publication["spine"][number]): Map<string, string> {
  const targets = new Map<string, string>();
  const register = (id: string) => {
    const prefix = `${section.id}--`;
    targets.set(id, id);
    if (id.startsWith(prefix)) targets.set(id.slice(prefix.length), id);
  };
  if (section.titleAnchor) register(section.titleAnchor);
  targets.set(section.id, section.id);
  visitBlocks(section.blocks, {
    block: (block) => {
      if (block.type === "heading") register(block.id);
    },
  });
  return targets;
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
    const backup = path.join(projectRoot, ".bookforge-previous-dist");
    await rm(backup, { recursive: true, force: true });
    await rename(destination, backup).catch(() => undefined);
    try { await rename(stage, destination); } catch (error) { await rename(backup, destination).catch(() => undefined); throw error; }
    await rm(backup, { recursive: true, force: true });
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
