import assert from "node:assert/strict";
import test from "node:test";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { archiveProject } from "./archive.js";
import { buildProject } from "./build.js";
import { checkProject } from "./check.js";
import { driftReport, formatProofDiff, proofDiff } from "./diff.js";
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
    assert.equal(seal.chapters.length, 3);
    assert.ok(seal.artifacts.some((artifact) => artifact.path === "build-manifest.json"));
    await checkProject(root, { seal: true });
    const gift = await giftProject(root, { to: "Sam", formats: ["web"], output: path.join(root, "gift.zip") });
    assert.equal(path.basename(gift), "gift.zip");
    const info = await readFile(gift);
    assert.ok(info.byteLength > 100);
    const archived = await archiveProject(root, "v1");
    assert.match(archived, /archives/);
    const index = await readFile(path.join(root, "archives/INDEX.md"), "utf8");
    assert.match(index, /synthetic-book/);
    const archivedManifest = await readFile(path.join(archived, "dist/build-manifest.json"));
    await assert.rejects(archiveProject(root, "v1"), /already exists/i);
    assert.deepEqual(await readFile(path.join(archived, "dist/build-manifest.json")), archivedManifest);
    assert.equal(await readFile(path.join(root, "archives/INDEX.md"), "utf8"), index);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("proof diff compares the current manuscript with the built seal", async () => {
  const root = await tempProject(true);
  try {
    await assert.rejects(proofDiff(root), /proof baseline.*bookforge build/i);
    await buildProject(root, ["web"]);
    const unchanged = await proofDiff(root);
    assert.equal(unchanged.changed, 0);
    assert.match(formatProofDiff(unchanged), /No prose/);
    assert.equal((await proofDiff(root, root)).changed, 0);
    assert.equal((await proofDiff(root, path.join(root, "dist"))).changed, 0);

    const sealFile = path.join(root, "dist/release-seal.json");
    const sealText = await readFile(sealFile, "utf8");
    const legacySeal = JSON.parse(sealText) as Record<string, unknown>;
    delete legacySeal.chapters;
    await writeFile(sealFile, `${JSON.stringify(legacySeal)}\n`);
    await assert.rejects(proofDiff(root), /compatible proof baseline.*bookforge build/i);
    await writeFile(sealFile, sealText);

    const chapter = path.join(root, "chapters/02-night-train.md");
    await writeFile(chapter, `${await readFile(chapter, "utf8")}\nA newly revised ending.\n`);
    const changed = await proofDiff(root);
    assert.equal(changed.changed, 1);
    assert.deepEqual(changed.chapters.filter((entry) => entry.change !== "same").map((entry) => entry.id), ["night-train"]);
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
    await checkProject(root, { seal: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("proof snapshots detect edits in every nested manuscript structure", async () => {
  const root = await tempProject(true);
  try {
    const chapter = path.join(root, "chapters/02-night-train.md");
    const original = `${await readFile(chapter, "utf8")}\n> A quoted platform announcement.\n`;
    await writeFile(chapter, original);
    await buildProject(root, ["web"]);
    const edits: Array<[string, string]> = [
      ["one brass key", "one silver key"],
      ["Miren | 01:20", "Miren | 01:25"],
      ["A tiny square used to test local raster assets", "A revised marker description"],
      ["The signal was visible", "The distant signal was visible"],
      ["The code block remains literal", "The revised code block remains literal"],
      ["A quoted platform announcement", "A changed platform announcement"],
    ];
    for (const [before, after] of edits) {
      await writeFile(chapter, original.replace(before, after));
      const result = await proofDiff(root);
      assert.equal(result.changed, 1, `expected nested edit ${before} to change the proof digest`);
      assert.equal(result.chapters.find((entry) => entry.change !== "same")?.id, "night-train");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("seal verification rejects metadata, snapshot, and artifact tampering", async () => {
  const root = await tempProject(true);
  try {
    await buildProject(root, ["web"]);
    const sealFile = path.join(root, "dist/release-seal.json");
    const originalText = await readFile(sealFile, "utf8");
    const original = JSON.parse(originalText) as Record<string, unknown>;
    const tamper = async (mutate: (seal: Record<string, any>) => void): Promise<void> => {
      const seal = structuredClone(original) as Record<string, any>;
      mutate(seal);
      await writeFile(sealFile, `${JSON.stringify(seal, null, 2)}\n`);
      await assert.rejects(checkProject(root, { seal: true }), /release seal/i);
      await writeFile(sealFile, originalText);
    };

    await tamper((seal) => { seal.contentDigest = "0".repeat(64); });
    await tamper((seal) => { seal.theme.id = "tampered"; });
    await tamper((seal) => { seal.formats = ["pdf"]; });
    await tamper((seal) => { seal.chapters[0].words += 1; });
    await tamper((seal) => { seal.artifacts.pop(); });
    await tamper((seal) => { delete seal.chapters; });

    const index = path.join(root, "dist/web/index.html");
    const indexText = await readFile(index, "utf8");
    await writeFile(index, `${indexText}\n<!-- tampered -->\n`);
    await assert.rejects(checkProject(root, { seal: true }), /artifact inventory/i);
    await writeFile(index, indexText);

    const unexpected = path.join(root, "dist/unexpected.txt");
    await writeFile(unexpected, "not sealed\n");
    await assert.rejects(checkProject(root, { seal: true }), /artifact inventory/i);
    await rm(unexpected);
    await checkProject(root, { seal: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive rejects a tampered or unsealed build", async () => {
  const root = await tempProject(true);
  try {
    await buildProject(root, ["web"]);
    const index = path.join(root, "dist/web/index.html");
    await writeFile(index, `${await readFile(index, "utf8")}\n<!-- tampered -->\n`);
    await assert.rejects(archiveProject(root, "tampered"), /artifact inventory/i);
    await buildProject(root, ["web"]);
    await rm(path.join(root, "dist/release-seal.json"));
    await assert.rejects(archiveProject(root, "unsealed"), /release seal/i);
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

test("unchanged rebuild is a no-op unless --force is set", async () => {
  const root = await tempProject(true);
  try {
    await buildProject(root, ["web"]);
    const first = await readFile(path.join(root, "dist/build-manifest.json"), "utf8");
    await buildProject(root, ["web"]);
    assert.equal(await readFile(path.join(root, "dist/build-manifest.json"), "utf8"), first);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await buildProject(root, ["web"], undefined, { force: true });
    const forced = JSON.parse(await readFile(path.join(root, "dist/build-manifest.json"), "utf8")) as { sourceHash: string; timestamp: string };
    const original = JSON.parse(first) as { sourceHash: string; timestamp: string };
    assert.equal(forced.sourceHash, original.sourceHash);
    assert.notEqual(forced.timestamp, original.timestamp);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("paged web rebuild refuses to no-op when a chapter page is missing", async () => {
  const root = await tempProject(true);
  try {
    await buildProject(root, ["web"]);
    const first = await readFile(path.join(root, "dist/build-manifest.json"), "utf8");
    await rm(path.join(root, "dist/web/chapters/threshold.html"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await buildProject(root, ["web"]);
    const rebuilt = JSON.parse(await readFile(path.join(root, "dist/build-manifest.json"), "utf8")) as { timestamp: string };
    assert.notEqual(rebuilt.timestamp, JSON.parse(first).timestamp);
    await access(path.join(root, "dist/web/chapters/threshold.html"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rebuild refuses to no-op when the release seal is missing", async () => {
  const root = await tempProject(true);
  try {
    await buildProject(root, ["web"]);
    const first = await readFile(path.join(root, "dist/build-manifest.json"), "utf8");
    await rm(path.join(root, "dist/release-seal.json"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await buildProject(root, ["web"]);
    const rebuilt = JSON.parse(await readFile(path.join(root, "dist/build-manifest.json"), "utf8")) as { timestamp: string };
    assert.notEqual(rebuilt.timestamp, JSON.parse(first).timestamp);
    await access(path.join(root, "dist/release-seal.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rebuild refuses to no-op when the manifest Bookforge version differs", async () => {
  const root = await tempProject(true);
  try {
    await buildProject(root, ["web"]);
    const first = await readFile(path.join(root, "dist/build-manifest.json"), "utf8");
    const manifest = JSON.parse(first) as { bookforgeVersion: string; timestamp: string };
    manifest.bookforgeVersion = "0.0.0";
    await writeFile(path.join(root, "dist/build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await buildProject(root, ["web"]);
    const rebuilt = JSON.parse(await readFile(path.join(root, "dist/build-manifest.json"), "utf8")) as { bookforgeVersion: string; timestamp: string };
    assert.notEqual(rebuilt.timestamp, manifest.timestamp);
    assert.notEqual(rebuilt.bookforgeVersion, "0.0.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("drift reports a missing generated colophon page", async () => {
  const root = await tempProject(true);
  try {
    const manifest = await readFile(path.join(root, "book.yaml"), "utf8");
    await writeFile(path.join(root, "book.yaml"), manifest.replace("theme: classic", "theme: classic\ncolophon: true"));
    await buildProject(root, ["web"]);
    await rm(path.join(root, "dist/web/chapters/colophon.html"));
    const report = await driftReport(root);
    assert.match(report, /DRIFT: web missing chapter colophon/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
