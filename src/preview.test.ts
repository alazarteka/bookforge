import assert from "node:assert/strict";
import test from "node:test";
import { access, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateBuiltInThemePreviews, rebuildPreview } from "./preview.js";

const fixture = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "synthetic");

test("preview rebuild replaces output and removes its staging directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-preview-"));
  try {
    await cp(fixture, root, { recursive: true });
    await mkdir(path.join(root, ".bookforge-preview"));
    await writeFile(path.join(root, ".bookforge-preview", "stale.txt"), "old output\n");
    await rebuildPreview(root);
    await access(path.join(root, ".bookforge-preview", "index.html"));
    await assert.rejects(access(path.join(root, ".bookforge-preview", "stale.txt")));
    assert.deepEqual((await readdir(root)).filter((entry) => entry.startsWith(".bookforge-preview-")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("preview rebuild preserves the previous output and cleans its stage on render failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-preview-"));
  try {
    await cp(fixture, root, { recursive: true });
    await mkdir(path.join(root, ".bookforge-preview"));
    await writeFile(path.join(root, ".bookforge-preview", "keep.txt"), "old output\n");
    await assert.rejects(rebuildPreview(root, async () => { throw new Error("render failed"); }), /render failed/);
    await access(path.join(root, ".bookforge-preview", "keep.txt"));
    assert.deepEqual((await readdir(root)).filter((entry) => entry.startsWith(".bookforge-preview-")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("preview theme overrides leave book.yaml unchanged", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-preview-"));
  try {
    await cp(fixture, root, { recursive: true });
    const book = await readFile(path.join(root, "book.yaml"), "utf8");
    await rebuildPreview(root, undefined, "meridian");
    assert.equal(await readFile(path.join(root, "book.yaml"), "utf8"), book);
    assert.match(await readFile(path.join(root, ".bookforge-preview", "reader.css"), "utf8"), /IBM Plex/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("built-in theme previews preserve dist and publish every theme atomically", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-theme-previews-"));
  try {
    await cp(fixture, root, { recursive: true });
    await mkdir(path.join(root, "dist"));
    await writeFile(path.join(root, "dist", "keep.txt"), "existing build\n");
    const book = await readFile(path.join(root, "book.yaml"), "utf8");
    const destination = await generateBuiltInThemePreviews(root);
    assert.equal(destination, path.join(root, ".bookforge-theme-previews"));
    await access(path.join(root, "dist", "keep.txt"));
    assert.equal(await readFile(path.join(root, "book.yaml"), "utf8"), book);
    const index = await readFile(path.join(destination, "index.html"), "utf8");
    for (const id of ["acorn", "caesura", "classic", "lyceum", "meridian", "riso-club"]) {
      await access(path.join(destination, id, "index.html"));
      assert.match(index, new RegExp(`${id}/index\\.html`));
    }
    assert.deepEqual((await readdir(root)).filter((entry) => entry.includes("theme-previews-stage") || entry.endsWith("theme-previews-previous")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed built-in theme previews preserve the previous comparison", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-theme-previews-"));
  try {
    await cp(fixture, root, { recursive: true });
    const target = path.join(root, ".bookforge-theme-previews");
    await mkdir(target);
    await writeFile(path.join(target, "keep.txt"), "previous comparison\n");
    await assert.rejects(generateBuiltInThemePreviews(root, async (_publication, theme) => {
      if (theme.id === "classic") throw new Error("render failed");
    }), /render failed/);
    await access(path.join(target, "keep.txt"));
    assert.deepEqual((await readdir(root)).filter((entry) => entry.includes("theme-previews-stage") || entry.endsWith("theme-previews-previous")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
