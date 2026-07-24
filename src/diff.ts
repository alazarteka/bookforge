import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadManuscriptSpine } from "./manuscript.js";
import { collectAssets } from "./assets.js";
import { loadReleaseSeal, snapshotChapters, type ChapterSnapshot } from "./seal.js";

export interface ChapterDiff {
  id: string;
  change: "added" | "removed" | "changed" | "same";
  beforeTitle?: string;
  afterTitle?: string;
  beforeWords?: number;
  afterWords?: number;
}

export interface ProofDiffResult {
  leftLabel: string;
  rightLabel: string;
  chapters: ChapterDiff[];
  changed: number;
}

export async function proofDiff(project: string, against?: string): Promise<ProofDiffResult> {
  const root = path.resolve(project);
  const right = await snapshotProject(root);
  const left = against
    ? await snapshotPath(path.resolve(against))
    : await snapshotBuilt(path.join(root, "dist"));
  return compareSnapshots(left, left.label, right, right.label);
}

export async function driftReport(project: string): Promise<string> {
  const root = path.resolve(project);
  const { publication, config } = await loadManuscriptSpine(root);
  const webIds = publication.spine.map((section) => section.id);
  // Builds inject a generated colophon section when enabled; expect its web page too.
  if (config.colophon && !webIds.includes("colophon")) webIds.push("colophon");
  const lines = [
    `Cross-format drift for ${publication.metadata.title}`,
    `Shared spine (${webIds.length}): ${webIds.join(", ") || "(empty)"}`,
    "",
    "Web, EPUB, and PDF are rendered from the same IR spine.",
    "Structural drift is reported only when a built artifact is missing expected chapter files.",
  ];
  const dist = path.join(root, "dist");
  const manifestRaw = await readFile(path.join(dist, "build-manifest.json"), "utf8").catch(() => undefined);
  if (!manifestRaw) {
    lines.push("", "No dist/build-manifest.json — run `bookforge build` before drift.");
    return `${lines.join("\n")}\n`;
  }
  const manifest = JSON.parse(manifestRaw) as { formats: string[]; sourceHash: string; publicationId: string };
  lines.push(`Manifest publication: ${manifest.publicationId}`);
  lines.push(`Formats: ${manifest.formats.join(", ")}`);
  if (manifest.publicationId !== publication.id) lines.push("DRIFT: publication id differs from current IR.");
  for (const id of webIds) {
    if (manifest.formats.includes("web")) {
      const paged = path.join(dist, "web", "chapters", `${id}.html`);
      const continuous = path.join(dist, "web", "index.html");
      const hasPaged = (await stat(paged).catch(() => undefined))?.isFile() ?? false;
      const hasContinuous = hasPaged
        ? false
        : await readFile(continuous, "utf8").then((html) => html.includes(`id="${id}"`)).catch(() => false);
      if (!hasPaged && !hasContinuous) lines.push(`DRIFT: web missing chapter ${id}`);
    }
  }
  if (manifest.formats.includes("epub")) {
    const epub = (await stat(path.join(dist, "book.epub")).catch(() => undefined))?.isFile() ?? false;
    if (!epub) lines.push("DRIFT: EPUB artifact missing");
  }
  if (manifest.formats.includes("pdf")) {
    const pdf = (await stat(path.join(dist, "book.pdf")).catch(() => undefined))?.isFile() ?? false;
    if (!pdf) lines.push("DRIFT: PDF artifact missing");
  }
  const drifted = lines.some((line) => line.startsWith("DRIFT:"));
  lines.push("", drifted ? "Drift detected." : "No cross-format drift detected.");
  return `${lines.join("\n")}\n`;
}

interface Snapshot {
  label: string;
  chapters: ChapterSnapshot[];
}

async function snapshotProject(projectRoot: string): Promise<Snapshot> {
  const { publication } = await loadManuscriptSpine(projectRoot, { includeDrafts: true });
  // Match seal digests: built publications assign assetIds before snapshotting.
  await collectAssets(publication, projectRoot);
  return { label: publication.id, chapters: snapshotChapters(publication) };
}

async function snapshotBuilt(dist: string): Promise<Snapshot> {
  try {
    const seal = await loadReleaseSeal(path.join(dist, "release-seal.json"));
    return { label: `${seal.publicationId} (built)`, chapters: seal.chapters };
  } catch (error) {
    throw new Error(`No compatible proof baseline found at ${dist}. Run \`bookforge build\` to create a fresh release seal. ${errorMessage(error)}`);
  }
}

async function snapshotPath(candidate: string): Promise<Snapshot> {
  if (!(await stat(candidate).catch(() => undefined))?.isDirectory()) {
    throw new Error(`Proof comparison path is not a directory: ${candidate}`);
  }
  if ((await stat(path.join(candidate, "book.yaml")).catch(() => undefined))?.isFile()) {
    try { return await snapshotProject(candidate); } catch (projectError) {
      if ((await stat(path.join(candidate, "dist", "release-seal.json")).catch(() => undefined))?.isFile()) {
        return await snapshotBuilt(path.join(candidate, "dist"));
      }
      throw projectError;
    }
  }
  if ((await stat(path.join(candidate, "release-seal.json")).catch(() => undefined))?.isFile()) {
    return await snapshotBuilt(candidate);
  }
  if ((await stat(path.join(candidate, "dist", "release-seal.json")).catch(() => undefined))?.isFile()) {
    return await snapshotBuilt(path.join(candidate, "dist"));
  }
  throw new Error(`No project or proof baseline found at ${candidate}`);
}

function compareSnapshots(left: Snapshot, leftLabel: string, right: Snapshot, rightLabel: string): ProofDiffResult {
  const leftMap = new Map(left.chapters.map((chapter) => [chapter.id, chapter]));
  const rightMap = new Map(right.chapters.map((chapter) => [chapter.id, chapter]));
  const ids = [...new Set([...leftMap.keys(), ...rightMap.keys()])];
  const chapters: ChapterDiff[] = ids.map((id) => {
    const before = leftMap.get(id);
    const after = rightMap.get(id);
    if (!before && after) return { id, change: "added" as const, afterTitle: after.title, afterWords: after.words };
    if (before && !after) return { id, change: "removed" as const, beforeTitle: before.title, beforeWords: before.words };
    if (before && after && before.digest !== after.digest) {
      return { id, change: "changed" as const, beforeTitle: before.title, afterTitle: after.title, beforeWords: before.words, afterWords: after.words };
    }
    const same: ChapterDiff = { id, change: "same" };
    if (before?.title !== undefined) same.beforeTitle = before.title;
    if (after?.title !== undefined) same.afterTitle = after.title;
    if (before?.words !== undefined) same.beforeWords = before.words;
    if (after?.words !== undefined) same.afterWords = after.words;
    return same;
  });
  return {
    leftLabel,
    rightLabel,
    chapters,
    changed: chapters.filter((chapter) => chapter.change !== "same").length,
  };
}

export function formatProofDiff(result: ProofDiffResult): string {
  const lines = [`Proof diff (${result.leftLabel} → ${result.rightLabel})`, `${result.changed} chapter change(s)`, ""];
  for (const chapter of result.chapters) {
    if (chapter.change === "same") continue;
    if (chapter.change === "added") lines.push(`+ ${chapter.id}: ${chapter.afterTitle} (${chapter.afterWords} words)`);
    else if (chapter.change === "removed") lines.push(`- ${chapter.id}: ${chapter.beforeTitle} (${chapter.beforeWords} words)`);
    else lines.push(`~ ${chapter.id}: ${chapter.beforeWords} → ${chapter.afterWords} words (${chapter.afterTitle})`);
  }
  if (result.changed === 0) lines.push("No prose/structure changes.");
  return `${lines.join("\n")}\n`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
