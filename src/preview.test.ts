import assert from "node:assert/strict";
import test from "node:test";
import { access, cp, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { rebuildPreview } from "./preview.js";

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
