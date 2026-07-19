import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildProject, createPublication } from "./build.js";
import { checkProject } from "./check.js";
import { loadPrintProfile } from "./profile-loader.js";
import { BOOKFORGE_VERSION } from "./util.js";

const fixture = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "synthetic");

async function webProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-check-"));
  await cp(fixture, root, { recursive: true });
  const book = path.join(root, "book.yaml");
  await writeFile(book, (await readFile(book, "utf8")).replace("  epub: {}\n  pdf:\n    profile: screen-a5\n", ""));
  return root;
}

test("check requires a complete configured web build", async () => {
  const root = await webProject();
  try {
    await assert.rejects(checkProject(root), /Build manifest is missing/);
    await buildProject(root);
    assert.deepEqual(await checkProject(root), { sections: 3, assets: 1 });
    await rm(path.join(root, "dist", "web", "reader.js"));
    await assert.rejects(checkProject(root), /Web reader script is missing/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("check rejects stale, malformed, and format-mismatched manifests", async () => {
  const root = await webProject();
  try {
    await buildProject(root);
    const chapter = path.join(root, "chapters", "01-threshold.md");
    await writeFile(chapter, `${await readFile(chapter, "utf8")}\nA source change.\n`);
    await assert.rejects(checkProject(root), /artifacts are stale/);

    await buildProject(root);
    const manifest = path.join(root, "dist", "build-manifest.json");
    const parsed = JSON.parse(await readFile(manifest, "utf8")) as { formats: string[] };
    parsed.formats = ["epub"];
    await writeFile(manifest, `${JSON.stringify(parsed)}\n`);
    await assert.rejects(checkProject(root), /formats .*do not match configured outputs/);

    await writeFile(manifest, "not JSON\n");
    await assert.rejects(checkProject(root), /Invalid build manifest JSON/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("check rejects a corrupt PDF artifact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-check-pdf-"));
  try {
    await cp(fixture, root, { recursive: true });
    const book = path.join(root, "book.yaml");
    await writeFile(book, (await readFile(book, "utf8")).replace("  web: {}\n  epub: {}\n", ""));
    const { publication, config, theme, sourceHash } = await createPublication(root);
    const profile = await loadPrintProfile(root, config.outputs.pdf);
    const dist = path.join(root, "dist");
    await mkdir(dist);
    await writeFile(path.join(dist, "book.pdf"), "this is not a PDF\n");
    await writeFile(path.join(dist, "build-manifest.json"), `${JSON.stringify({
      bookforgeVersion: BOOKFORGE_VERSION,
      schemaVersion: 1,
      publicationId: publication.id,
      sourceHash,
      theme: { id: theme.id, version: theme.version, hash: theme.hash, source: theme.source },
      printProfile: { id: profile.id, hash: profile.hash, source: profile.source },
      toolVersions: { node: process.version, pandoc: "test", vivliostyle: "test" },
      formats: ["pdf"],
      timestamp: "2026-01-01T00:00:00.000Z",
    })}\n`);
    await assert.rejects(checkProject(root), /PDF validation failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
