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

test("init imports Markdown in deterministic natural order without changing the source", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "bookforge-init-import-"));
  const source = path.join(parent, "draft");
  const root = path.join(parent, "book");
  try {
    await mkdir(path.join(source, "parts"), { recursive: true });
    await Promise.all([
      writeFile(path.join(source, "10-ending.md"), "# Ending\n"),
      writeFile(path.join(source, "2-beginning.md"), "# Beginning\n"),
      writeFile(path.join(source, "parts", "01-interlude.md"), "# Interlude\n"),
      writeFile(path.join(source, "notes.txt"), "keep me\n"),
    ]);
    await initProject(root, { fromExisting: source, authors: ["Ada"] });
    const manifest = await readFile(path.join(root, "book.yaml"), "utf8");
    assert.ok(manifest.indexOf("chapters/2-beginning.md") < manifest.indexOf("chapters/10-ending.md"));
    assert.ok(manifest.includes("chapters/parts/01-interlude.md"));
    assert.equal(await readFile(path.join(source, "notes.txt"), "utf8"), "keep me\n");
    assert.equal(await readFile(path.join(root, "chapters", "2-beginning.md"), "utf8"), "# Beginning\n");
    await assert.rejects(access(path.join(root, "chapters", "notes.txt")));
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("init import dry run validates its source and creates no destination", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "bookforge-init-dry-run-"));
  const source = path.join(parent, "draft");
  const root = path.join(parent, "book");
  try {
    await mkdir(source);
    await writeFile(path.join(source, "01-one.md"), "# One\n");
    assert.equal(await initProject(root, { fromExisting: source, dryRun: true }), root);
    await assert.rejects(access(root));
  } finally { await rm(parent, { recursive: true, force: true }); }
});
