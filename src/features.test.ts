import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { archiveProject } from "./archive.js";
import { buildProject } from "./build.js";
import { checkProject } from "./check.js";
import { formatProofDiff, proofDiff } from "./diff.js";
import { giftProject } from "./gift.js";
import { lintProject } from "./lint.js";
import { loadReleaseSeal } from "./seal.js";
import { statusProject } from "./status.js";

const fixture = path.resolve(import.meta.dirname, "../tests/fixtures/synthetic");

async function tempProject(webOnly = false): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-features-"));
  await cp(fixture, root, { recursive: true });
  await rm(path.join(root, "dist"), { recursive: true, force: true });
  if (webOnly) {
    const book = path.join(root, "book.yaml");
    await writeFile(book, (await readFile(book, "utf8")).replace("  epub: {}\n  pdf:\n    profile: screen-a5\n", ""));
  }
  return root;
}

test("status reports manuscript pulse word counts", async () => {
  const root = await tempProject();
  try {
    const pulse = await statusProject(root);
    assert.equal(pulse.id, "synthetic-book");
    assert.ok(pulse.words > 0);
    assert.ok(pulse.chapters.length >= 3);
    assert.ok(pulse.chapters.every((chapter) => chapter.status === "ready"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("build omits draft chapters and ship lint reports them", async () => {
  const root = await tempProject(true);
  try {
    const manifest = await readFile(path.join(root, "book.yaml"), "utf8");
    await writeFile(path.join(root, "book.yaml"), manifest.replace(
      "  - id: notes\n    path: chapters/03-notes.md\n    role: backmatter",
      "  - id: notes\n    path: chapters/03-notes.md\n    role: backmatter\n    status: draft",
    ));
    const lint = await lintProject(root, { ship: true });
    assert.ok(lint.issues.some((issue) => /draft/.test(issue.message)));
    await buildProject(root, ["web"]);
    const chapterPage = await readFile(path.join(root, "dist/web/chapters/notes.html"), "utf8").catch(() => "");
    assert.equal(chapterPage, "");
    await assert.rejects(checkProject(root, { ship: true }), /draft/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("colophon is injected when enabled", async () => {
  const root = await tempProject(true);
  try {
    const manifest = await readFile(path.join(root, "book.yaml"), "utf8");
    await writeFile(path.join(root, "book.yaml"), manifest.replace("theme: classic", "theme: classic\ncolophon: true"));
    await buildProject(root, ["web"]);
    const html = await readFile(path.join(root, "dist/web/chapters/colophon.html"), "utf8");
    assert.match(html, /Colophon/);
    assert.match(html, /Bookforge/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("build writes a release seal and gift/archive consume dist", async () => {
  const root = await tempProject(true);
  try {
    await buildProject(root, ["web"]);
    const seal = await loadReleaseSeal(path.join(root, "dist/release-seal.json"));
    assert.equal(seal.kind, "bookforge-release-seal");
    assert.equal(seal.publicationId, "synthetic-book");
    await checkProject(root, { seal: true });
    const gift = await giftProject(root, { to: "Sam", formats: ["web"], output: path.join(root, "gift.zip") });
    assert.equal(path.basename(gift), "gift.zip");
    const info = await readFile(gift);
    assert.ok(info.byteLength > 100);
    const archived = await archiveProject(root, "v1");
    assert.match(archived, /archives/);
    const index = await readFile(path.join(root, "archives/INDEX.md"), "utf8");
    assert.match(index, /synthetic-book/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("proof diff reports unchanged chapters for identical manuscript", async () => {
  const root = await tempProject();
  try {
    const result = await proofDiff(root);
    assert.equal(result.changed, 0);
    assert.match(formatProofDiff(result), /No prose/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("edition lattice builds a sibling edition overlay", async () => {
  const root = await tempProject(true);
  try {
    await mkdir(path.join(root, "editions"), { recursive: true });
    await writeFile(path.join(root, "editions/annotated-threshold.md"), "# Annotated Threshold\n\nEditor note.\n");
    const manifest = await readFile(path.join(root, "book.yaml"), "utf8");
    await writeFile(path.join(root, "book.yaml"), `${manifest.trimEnd()}\neditions:\n  - id: annotated\n    title: Threshold Annotated\n    overlays:\n      threshold: editions/annotated-threshold.md\n`);
    await buildProject(root, ["web"], undefined, { allEditions: true });
    const base = await readFile(path.join(root, "dist/web/chapters/threshold.html"), "utf8");
    const annotated = await readFile(path.join(root, "dist/editions/annotated/web/chapters/threshold.html"), "utf8");
    assert.match(base, /Threshold/);
    assert.match(annotated, /Editor note/);
    assert.match(annotated, /Annotated Threshold/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verse layout chapters are marked in HTML", async () => {
  const root = await tempProject(true);
  try {
    const manifest = await readFile(path.join(root, "book.yaml"), "utf8");
    await writeFile(path.join(root, "book.yaml"), manifest.replace(
      "  - id: threshold\n    path: chapters/01-threshold.md\n    role: frontmatter",
      "  - id: threshold\n    path: chapters/01-threshold.md\n    role: frontmatter\n    layout: verse",
    ));
    await buildProject(root, ["web"]);
    const html = await readFile(path.join(root, "dist/web/chapters/threshold.html"), "utf8");
    assert.match(html, /layout-verse/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
