import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initProject } from "./init.js";

test("init creates a complete project from a staged directory", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "bookforge-init-"));
  const root = path.join(parent, "book");
  try {
    assert.equal(await initProject(root), root);
    await access(path.join(root, "book.yaml"));
    await access(path.join(root, "chapters", "01-opening.md"));
    assert.deepEqual((await readdir(parent)).filter((entry) => entry.includes("bookforge-init")), []);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("init refuses an existing target without modifying it", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "bookforge-init-"));
  const root = path.join(parent, "existing");
  try {
    await mkdir(root);
    await writeFile(path.join(root, "keep.txt"), "unchanged\n");
    await assert.rejects(initProject(root), /Refusing to initialize an existing directory/);
    assert.equal(await readFile(path.join(root, "keep.txt"), "utf8"), "unchanged\n");
    await assert.rejects(access(path.join(root, "chapters")));
  } finally { await rm(parent, { recursive: true, force: true }); }
});
