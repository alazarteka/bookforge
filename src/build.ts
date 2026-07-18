import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Block, BuildManifest, Inline, Publication } from "./model.js";
import { loadConfig } from "./config.js";
import { parseMarkdown } from "./pandoc.js";
import { collectAssets } from "./assets.js";
import { renderWeb } from "./web.js";
import { renderEpub } from "./epub.js";
import { renderPdf } from "./pdf.js";
import { loadTheme } from "./theme-loader.js";
import { loadPrintProfile } from "./profile-loader.js";
import { BOOKFORGE_VERSION, commandVersion, containedPath, run, sha256, sourceEpochDate } from "./util.js";

export type Format = "web" | "epub" | "pdf";

export async function createPublication(projectRoot: string): Promise<{ publication: Publication; config: Awaited<ReturnType<typeof loadConfig>>; theme: Awaited<ReturnType<typeof loadTheme>>; sourceHash: string }> {
  const config = await loadConfig(projectRoot);
  const theme = await loadTheme(projectRoot, config.theme);
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
    ...(config.cover ? { cover: { assetId: "pending", alt: config.cover.alt } } : {}),
    spine,
    assets: [],
  };
  resolveChapterLinks(publication, config.chapters);
  await collectAssets(publication, projectRoot, config.cover?.path);
  return { publication, config, theme, sourceHash: sha256(hashes.join("\n\0\n")) };
}

function resolveChapterLinks(publication: Publication, chapters: Array<{ id: string; path: string }>): void {
  const targets = new Map(chapters.map((chapter) => [chapter.path.replaceAll("\\", "/"), chapter.id]));
  const visitInlines = (inlines: Inline[]) => inlines.forEach((inline) => {
    if (inline.type === "link") {
      const [file, fragment] = inline.href.split("#", 2);
      const id = file ? targets.get(file.replaceAll("\\", "/")) : undefined;
      if (id) inline.href = `${id}.md${fragment ? `#${fragment}` : ""}`;
      else if (file?.endsWith(".md")) throw new Error(`Broken chapter link: ${inline.href}`);
    }
    if (inline.type === "footnote") visitBlocks(inline.blocks);
    if ("children" in inline && Array.isArray(inline.children)) visitInlines(inline.children);
  });
  const visitBlocks = (blocks: Block[]) => blocks.forEach((block) => {
    if (block.type === "paragraph" || block.type === "heading") visitInlines(block.children);
    else if (block.type === "blockquote") visitBlocks(block.blocks);
    else if (block.type === "list") block.items.forEach(visitBlocks);
    else if (block.type === "figure") { visitInlines([block.image]); visitInlines(block.caption); }
    else if (block.type === "table") { block.headers.forEach(visitInlines); block.rows.flat().forEach(visitInlines); }
  });
  publication.spine.forEach((section) => visitBlocks(section.blocks));
}

export async function buildProject(project: string, requested?: Format[]): Promise<string> {
  const projectRoot = path.resolve(project);
  const { publication, config, theme, sourceHash } = await createPublication(projectRoot);
  const configured = Object.keys(config.outputs) as Format[];
  const formats = requested?.length ? requested : configured;
  const unsupported = formats.filter((format) => !["web", "epub", "pdf"].includes(format));
  if (unsupported.length) throw new Error(`Unknown formats: ${unsupported.join(", ")}`);
  const stage = await mkdtemp(path.join(projectRoot, ".bookforge-stage-"));
  try {
    if (formats.includes("web")) await renderWeb(publication, theme, path.join(stage, "web"));
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
  if (formats.includes("pdf")) commands.push(["vivliostyle", "pnpm", ["exec", "vivliostyle", "--version"]]);
  const versions: Record<string, string> = {};
  for (const [key, command, args] of commands) {
    const result = await run(command, args, { cwd: path.resolve(import.meta.dirname, ".."), quiet: true });
    versions[key] = result.code === 0 ? commandVersion(result.stdout || result.stderr) : "unavailable";
  }
  return versions;
}
