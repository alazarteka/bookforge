import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPublication } from "./build.js";
import { inlineText } from "./util.js";

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
  const right = await snapshot(root);
  const leftRoot = against ? path.resolve(against) : root;
  const left = against
    ? await snapshotFromSeal(leftRoot)
    : await snapshotFromSeal(path.join(root, "dist")).catch(async () => snapshot(root));
  return compareSnapshots(left, against ? `against:${against}` : "dist-or-current", right, "current");
}

export async function driftReport(project: string): Promise<string> {
  const root = path.resolve(project);
  const { publication } = await createPublication(root);
  const webIds = publication.spine.map((section) => section.id);
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
      const hasPaged = await readFile(paged, "utf8").then(() => true).catch(() => false);
      const hasContinuous = await readFile(continuous, "utf8").then((html) => html.includes(`id="${id}"`)).catch(() => false);
      if (!hasPaged && !hasContinuous) lines.push(`DRIFT: web missing chapter ${id}`);
    }
  }
  if (manifest.formats.includes("epub")) {
    const epub = await readFile(path.join(dist, "book.epub")).then(() => true).catch(() => false);
    if (!epub) lines.push("DRIFT: EPUB artifact missing");
  }
  if (manifest.formats.includes("pdf")) {
    const pdf = await readFile(path.join(dist, "book.pdf")).then(() => true).catch(() => false);
    if (!pdf) lines.push("DRIFT: PDF artifact missing");
  }
  const drifted = lines.some((line) => line.startsWith("DRIFT:"));
  lines.push("", drifted ? "Drift detected." : "No cross-format drift detected.");
  return `${lines.join("\n")}\n`;
}

interface Snapshot {
  label: string;
  chapters: Array<{ id: string; title: string; words: number; text: string }>;
}

async function snapshot(projectRoot: string): Promise<Snapshot> {
  const { publication } = await createPublication(projectRoot, undefined, { includeDrafts: true, injectColophon: false });
  return {
    label: publication.id,
    chapters: publication.spine.map((section) => {
      const text = sectionText(section);
      return { id: section.id, title: inlineText(section.title), words: text.split(/\s+/).filter(Boolean).length, text };
    }),
  };
}

async function snapshotFromSeal(distOrProject: string): Promise<Snapshot> {
  // Prefer rebuilding from a project path; if this is a dist folder, fall back to chapter HTML titles.
  try {
    return await snapshot(distOrProject);
  } catch {
    const manifest = JSON.parse(await readFile(path.join(distOrProject, "build-manifest.json"), "utf8")) as { publicationId: string };
    return { label: manifest.publicationId, chapters: [] };
  }
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
    if (before && after && before.text !== after.text) {
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

function sectionText(section: { title: Parameters<typeof inlineText>[0]; blocks: Array<{ type: string; children?: Parameters<typeof inlineText>[0]; value?: string; blocks?: unknown; items?: unknown }> }): string {
  const parts = [inlineText(section.title)];
  for (const block of section.blocks) {
    if (block.type === "paragraph" || block.type === "heading") parts.push(inlineText(block.children ?? []));
    else if (block.type === "codeBlock") parts.push(block.value ?? "");
    else if (block.type === "sceneBreak") parts.push("---");
  }
  return parts.join("\n");
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
