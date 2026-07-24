import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BookConfig, BuildManifest, PrintProfile } from "./model.js";
import { loadConfigWithSource } from "./config.js";
import { renderWeb } from "./web.js";
import { renderEpub } from "./epub.js";
import { renderPdf } from "./pdf.js";
import { loadPrintProfile } from "./profile-loader.js";
import { projectToolExecutable } from "./tool-paths.js";
import { writeReleaseSeal } from "./seal.js";
import { writeZineGuide } from "./zine.js";
import {
  createPublication,
  type CreatePublicationOptions,
  type Format,
  type PublicationBuild,
} from "./publication.js";
import { BOOKFORGE_VERSION, atomicReplaceDirectory, commandVersion, run, sourceEpochDate } from "./util.js";

export type { Format, CreatePublicationOptions, PublicationBuild };
export { createPublication };

export interface BuildProjectOptions {
  formats?: string[];
  themeOverride?: string;
  includeDrafts?: boolean;
  editionId?: string;
  allEditions?: boolean;
  /** Rebuild even when dist already matches the current sourceHash. */
  force?: boolean;
}

const toolVersionCache = new Map<string, Promise<Record<string, string>>>();

export async function buildProject(project: string, requested?: string[], themeOverride?: string, options: BuildProjectOptions = {}): Promise<string> {
  const projectRoot = path.resolve(project);
  const { config, bookYaml } = await loadConfigWithSource(projectRoot);
  const formats = resolveFormats(config, options.formats ?? requested);
  const shared: BuildProjectOptions = {
    ...(options.includeDrafts !== undefined ? { includeDrafts: options.includeDrafts } : {}),
    ...(themeOverride ? { themeOverride } : {}),
    ...(options.force ? { force: true } : {}),
  };
  if (options.allEditions && config.editions.length) {
    // Build the base edition first, then each sibling into dist/editions/<id>
    // without letting the base replace wipe sibling outputs.
    await buildOne(projectRoot, config, bookYaml, formats, shared);
    for (const edition of config.editions) {
      await buildOne(projectRoot, config, bookYaml, formats, { ...shared, editionId: edition.id });
    }
    return path.join(projectRoot, "dist");
  }
  return await buildOne(projectRoot, config, bookYaml, formats, {
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

function isFormat(value: string): value is Format {
  return value === "web" || value === "epub" || value === "pdf";
}

async function buildOne(
  projectRoot: string,
  config: BookConfig,
  bookYaml: string,
  formats: Format[],
  options: BuildProjectOptions,
): Promise<string> {
  const built = await createPublication(projectRoot, options.themeOverride, {
    includeDrafts: options.includeDrafts ?? false,
    injectColophon: true,
    config,
    bookYaml,
    ...(options.editionId ? { editionId: options.editionId } : {}),
  });
  const { publication, theme, sourceHash, edition } = built;
  if (!publication.spine.length) throw new Error("No chapters to build. Mark chapters ready/locked or pass --include-drafts.");
  const destination = edition
    ? path.join(projectRoot, "dist", "editions", edition.id)
    : path.join(projectRoot, "dist");
  const printProfile = formats.includes("pdf") ? await loadPrintProfile(projectRoot, config.outputs.pdf) : undefined;
  const webReading = config.outputs.web?.reading ?? "paged";
  if (!options.force && await existingBuildIsCurrent(destination, built, formats, {
    webReading,
    ...(printProfile ? { printProfile } : {}),
  })) {
    return destination;
  }
  const stage = await mkdtemp(path.join(projectRoot, ".bookforge-stage-"));
  try {
    // Web, EPUB, and PDF share one publication IR; render them concurrently.
    const renderJobs: Array<Promise<void>> = [];
    if (formats.includes("web")) {
      renderJobs.push(renderWeb(publication, theme, path.join(stage, "web"), webReading));
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

async function existingBuildIsCurrent(
  destination: string,
  built: PublicationBuild,
  formats: Format[],
  options: { printProfile?: PrintProfile; webReading: "paged" | "continuous" },
): Promise<boolean> {
  try {
    const raw = await readFile(path.join(destination, "build-manifest.json"), "utf8");
    const manifest = JSON.parse(raw) as BuildManifest;
    if (manifest.sourceHash !== built.sourceHash) return false;
    if (manifest.publicationId !== built.publication.id) return false;
    if (manifest.theme.hash !== built.theme.hash) return false;
    if (manifest.formats.length !== formats.length || formats.some((format) => !manifest.formats.includes(format))) return false;
    if (formats.includes("pdf")) {
      if (!options.printProfile || !manifest.printProfile) return false;
      if (
        manifest.printProfile.id !== options.printProfile.id
        || manifest.printProfile.hash !== options.printProfile.hash
        || manifest.printProfile.source !== options.printProfile.source
      ) return false;
    } else if (manifest.printProfile) {
      return false;
    }
    const checks = formats.map(async (format) => {
      if (format === "web") {
        if (!(await stat(path.join(destination, "web", "index.html")).catch(() => undefined))?.isFile()) return false;
        if (options.webReading !== "paged") return true;
        const chapterChecks = await Promise.all(built.publication.spine.map(async (section) =>
          (await stat(path.join(destination, "web", "chapters", `${section.id}.html`)).catch(() => undefined))?.isFile()));
        return chapterChecks.every(Boolean);
      }
      if (format === "epub") return (await stat(path.join(destination, "book.epub")).catch(() => undefined))?.isFile();
      return (await stat(path.join(destination, "book.pdf")).catch(() => undefined))?.isFile();
    });
    return (await Promise.all(checks)).every(Boolean);
  } catch {
    return false;
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
  const key = [...formats].sort().join(",");
  let cached = toolVersionCache.get(key);
  if (!cached) {
    cached = probeToolVersions(formats);
    toolVersionCache.set(key, cached);
  }
  return cached;
}

async function probeToolVersions(formats: Format[]): Promise<Record<string, string>> {
  const commands: Array<[string, string, string[]]> = [["node", "node", ["--version"]], ["pandoc", "pandoc", ["--version"]]];
  if (formats.includes("epub")) commands.push(["epubcheck", "epubcheck", ["--version"]]);
  if (formats.includes("pdf")) commands.push(["vivliostyle", projectToolExecutable(path.resolve(import.meta.dirname, ".."), "vivliostyle"), ["--version"]]);
  const entries = await Promise.all(commands.map(async ([key, command, args]) => {
    const result = await run(command, args, { cwd: path.resolve(import.meta.dirname, ".."), quiet: true });
    return [key, result.code === 0 ? commandVersion(result.stdout || result.stderr) : "unavailable"] as const;
  }));
  return Object.fromEntries(entries);
}
