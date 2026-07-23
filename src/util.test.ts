import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { atomicReplaceDirectory, containedPath, escapeHtml, mapPool, slugify } from "./util.js";

test("escapes markup", () => assert.equal(escapeHtml(`<script a="b">&`), "&lt;script a=&quot;b&quot;&gt;&amp;"));
test("creates stable Unicode-aware slugs", () => assert.equal(slugify("Professor’s Wár"), "professor-s-war"));
test("rejects paths outside the project", () => assert.throws(() => containedPath(path.resolve("fixture"), "../secret"), /escapes project root/));

test("mapPool preserves order and respects concurrency", async () => {
  const active = { current: 0, peak: 0 };
  const results = await mapPool([1, 2, 3, 4, 5], 2, async (value) => {
    active.current += 1;
    active.peak = Math.max(active.peak, active.current);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active.current -= 1;
    return value * 10;
  });
  assert.deepEqual(results, [10, 20, 30, 40, 50]);
  assert.ok(active.peak <= 2);
  assert.equal(await mapPool([], 4, async (value) => value).then((items) => items.length), 0);
});

test("atomicReplaceDirectory swaps stage into target and removes previous", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-atomic-"));
  try {
    const stage = path.join(root, "stage");
    const target = path.join(root, "target");
    const previous = path.join(root, "previous");
    await mkdir(stage);
    await mkdir(target);
    await writeFile(path.join(stage, "next.txt"), "next\n");
    await writeFile(path.join(target, "old.txt"), "old\n");
    await atomicReplaceDirectory(stage, target, previous);
    assert.equal(await readFile(path.join(target, "next.txt"), "utf8"), "next\n");
    await assert.rejects(access(path.join(target, "old.txt")), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    await assert.rejects(access(stage), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    await assert.rejects(access(previous), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("atomicReplaceDirectory restores previous when stage rename fails", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-atomic-fail-"));
  try {
    const stage = path.join(root, "missing-stage");
    const target = path.join(root, "target");
    const previous = path.join(root, "previous");
    await mkdir(target);
    await writeFile(path.join(target, "old.txt"), "old\n");
    await assert.rejects(atomicReplaceDirectory(stage, target, previous), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    assert.equal(await readFile(path.join(target, "old.txt"), "utf8"), "old\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
