import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BookConfig, BuildManifest, ChapterConfig, EditionConfig, Publication, Section } from "./model.js";
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
import { buildColophonSection, shouldInjectColophon } from "./colophon.js";
import { writeReleaseSeal } from "./seal.js";
import { writeZineGuide } from "./zine.js";
import { BOOKFORGE_VERSION, atomicReplaceDirectory, commandVersion, containedPath, defaultConcurrency, mapPool, run, sha256, sourceEpochDate } from "./util.js";

export type Format = "web" | "epub" | "pdf";

export interface CreatePublicationOptions {
  includeDrafts?: boolean;
  editionId?: string;
  injectColophon?: boolean;
}

export async function createPublication(
  projectRoot: string,
  themeOverride?: string,
  options: CreatePublicationOptions = {},
): Promise<{ publication: Publication; config: BookConfig; theme: Awaited<ReturnType<typeof loadTheme>>; sourceHash: string; edition?: EditionConfig }> {
  const config = await loadConfig(projectRoot);
  const edition = options.editionId ? requireEdition(config, options.editionId) : undefined;
  const themeId = themeOverride ?? edition?.theme ?? config.theme;
  const theme = await loadTheme(projectRoot, themeId);
  const includeDrafts = options.includeDrafts ?? false;
  const selectedChapters = selectChapters(config, edition, includeDrafts);
  const bookYaml = await readFile(path.join(projectRoot, "book.yaml"), "utf8");
  const hashes: string[] = [bookYaml, edition?.id ?? ""];
  // Parse chapters concurrently; Pandoc process startup dominates multi-chapter books.
  const parsed = await mapPool(selectedChapters, defaultConcurrency(), async (chapter) => {
    const relativePath = edition?.overlays?.[chapter.id] ?? chapter.path;
    const file = containedPath(projectRoot, relativePath);
    const source = await readFile(file, "utf8");
    const section = await parseMarkdown(file, projectRoot, chapter.id, chapter.role, chapter.title, chapter.layout, source);
    return { source, section };
  });
  const spine: Section[] = [];
  for (const { source, section } of parsed) {
    hashes.push(source);
    spine.push(section);
  }
  const publication: Publication = {
    schemaVersion: 1,
    id: edition ? `${config.id}--${edition.id}` : config.id,
    metadata: {
      title: edition?.title ?? config.title,
      ...((edition?.subtitle ?? config.subtitle) ? { subtitle: edition?.subtitle ?? config.subtitle } : {}),
      language: config.language,
      authors: config.authors.map((author) => author.name),
    },
    spine,
    assets: [],
  };
  rewriteChapterLinks(publication, projectRoot, selectedChapters);
  await collectAssets(publication, projectRoot);
  hashes.push(theme.hash);
  for (const asset of [...publication.assets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) hashes.push(asset.hash);
  let sourceHash = sha256(hashes.join("\n\0\n"));
  if ((options.injectColophon ?? true) && shouldInjectColophon(config, publication)) {
    const printProfile = config.outputs.pdf ? await loadPrintProfile(projectRoot, config.outputs.pdf) : undefined;
    publication.spine.push(buildColophonSection(publication, config, theme, { ...(printProfile ? { printProfile } : {}), sourceHash }));
  }
  return { publication, config, theme, sourceHash, ...(edition ? { edition } : {}) };
}

function requireEdition(config: BookConfig, editionId: string): EditionConfig {
  const edition = config.editions.find((entry) => entry.id === editionId);
  if (!edition) throw new Error(`Unknown edition: ${editionId}`);
  return edition;
}

function selectChapters(config: BookConfig, edition: EditionConfig | undefined, includeDrafts: boolean): ChapterConfig[] {
  const ordered = edition?.chapters
    ? edition.chapters.map((id) => {
      const chapter = config.chapters.find((entry) => entry.id === id);
      if (!chapter) throw new Error(`Edition ${edition.id} references unknown chapter ${id}`);
      return chapter;
    })
    : config.chapters;
  return ordered.filter((chapter) => includeDrafts || chapter.status !== "draft");
}

function isFormat(value: string): value is Format {
  return value === "web" || value === "epub" || value === "pdf";
}

export interface BuildProjectOptions {
  formats?: string[];
  themeOverride?: string;
  includeDrafts?: boolean;
  editionId?: string;
  allEditions?: boolean;
}

export async function buildProject(project: string, requested?: string[], themeOverride?: string, options: BuildProjectOptions = {}): Promise<string> {
  const projectRoot = path.resolve(project);
  const config = await loadConfig(projectRoot);
  const formats = resolveFormats(config, options.formats ?? requested);
  const shared: BuildProjectOptions = {
    ...(options.includeDrafts !== undefined ? { includeDrafts: options.includeDrafts } : {}),
    ...(themeOverride ? { themeOverride } : {}),
  };
  if (options.allEditions && config.editions.length) {
    // Build the base edition first, then each sibling into dist/editions/<id>
    // without letting the base replace wipe sibling outputs.
    await buildOne(projectRoot, config, formats, shared);
    for (const edition of config.editions) {
      await buildOne(projectRoot, config, formats, { ...shared, editionId: edition.id });
    }
    return path.join(projectRoot, "dist");
  }
  return await buildOne(projectRoot, config, formats, {
    ...shared,
    ...(options.editionId ? { editionId: options.editionId } : {}),
  });
}

function resolveFormats(config: BookConfig, requested?: string[]): Format[] {
  const configured = Object.keys(config.outputs);
  const candidates = requested?.length ? requested : configured;
  const unsupported = candidates.filter((format) => !isFormat(format));
  if (unsupported.length) throw new Error(`Unknown formats: ${unsupported.join(", ")}`);
  return candidates.filter(isFormat);
}

async function buildOne(
  projectRoot: string,
  config: BookConfig,
  formats: Format[],
  options: BuildProjectOptions,
): Promise<string> {
  const { publication, theme, sourceHash, edition } = await createPublication(projectRoot, options.themeOverride, {
    includeDrafts: options.includeDrafts ?? false,
    injectColophon: true,
    ...(options.editionId ? { editionId: options.editionId } : {}),
  });
  if (!publication.spine.length) throw new Error("No chapters to build. Mark chapters ready/locked or pass --include-drafts.");
  const stage = await mkdtemp(path.join(projectRoot, ".bookforge-stage-"));
  try {
    const printProfile = formats.includes("pdf") ? await loadPrintProfile(projectRoot, config.outputs.pdf) : undefined;
    // Web, EPUB, and PDF share one publication IR; render them concurrently.
    const renderJobs: Array<Promise<void>> = [];
    if (formats.includes("web")) {
      renderJobs.push(renderWeb(publication, theme, path.join(stage, "web"), config.outputs.web?.reading ?? "paged"));
    }
    if (formats.includes("epub")) {
      renderJobs.push((async () => {
        const epub = path.join(stage, "book.epub");
        await renderEpub(publication, theme, epub);
        const checked = await run("epubcheck", [epub], { quiet: true });
        if (checked.code !== 0) throw new Error(`EPUBCheck failed:\n${checked.stdout}\n${checked.stderr}`);
      })());
    }
    if (printProfile) {
      renderJobs.push(renderPdf(publication, theme, printProfile, stage, path.join(stage, "book.pdf")));
    }
    const [, versions] = await Promise.all([
      Promise.all(renderJobs),
      toolVersions(formats),
    ]);
    if (printProfile?.imposition === "booklet") await writeZineGuide(stage, publication, printProfile);
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
    await writeReleaseSeal(stage, {
      publication,
      theme,
      sourceHash,
      formats,
      toolVersions: versions,
      timestamp: manifest.timestamp,
      ...(printProfile ? { printProfile } : {}),
      ...(edition ? { editionId: edition.id } : {}),
    });
    const destination = edition
      ? path.join(projectRoot, "dist", "editions", edition.id)
      : path.join(projectRoot, "dist");
    if (edition) {
      await mkdir(path.join(projectRoot, "dist", "editions"), { recursive: true });
      await atomicReplaceDirectory(stage, destination, path.join(projectRoot, `.bookforge-previous-edition-${edition.id}`));
    } else {
      // Preserve any sibling edition builds already under dist/editions.
      const editionsKeep = path.join(projectRoot, ".bookforge-keep-editions");
      await rm(editionsKeep, { recursive: true, force: true });
      await renameIfExists(path.join(projectRoot, "dist", "editions"), editionsKeep);
      try {
        await atomicReplaceDirectory(stage, destination, path.join(projectRoot, ".bookforge-previous-dist"));
        await renameIfExists(editionsKeep, path.join(projectRoot, "dist", "editions"));
      } catch (error) {
        await renameIfExists(editionsKeep, path.join(projectRoot, "dist", "editions"));
        throw error;
      }
    }
    return destination;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

async function renameIfExists(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch {
    // absent source is fine
  }
}

async function toolVersions(formats: Format[]): Promise<Record<string, string>> {
  const commands: Array<[string, string, string[]]> = [["node", "node", ["--version"]], ["pandoc", "pandoc", ["--version"]]];
  if (formats.includes("epub")) commands.push(["epubcheck", "epubcheck", ["--version"]]);
  if (formats.includes("pdf")) commands.push(["vivliostyle", projectToolExecutable(path.resolve(import.meta.dirname, ".."), "vivliostyle"), ["--version"]]);
  const entries = await Promise.all(commands.map(async ([key, command, args]) => {
    const result = await run(command, args, { cwd: path.resolve(import.meta.dirname, ".."), quiet: true });
    return [key, result.code === 0 ? commandVersion(result.stdout || result.stderr) : "unavailable"] as const;
  }));
  return Object.fromEntries(entries);
}
