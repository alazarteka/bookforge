import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildProject, createPublication } from "./build.js";
import { fileHash } from "./util.js";

const fixture = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "synthetic");

test("adapts the synthetic publication into owned IR", async () => {
  const { publication } = await createPublication(fixture);
  assert.equal(publication.spine.length, 3);
  assert.equal(publication.assets.length, 1);
  assert.equal(publication.spine[1]?.title[0]?.type, "text");
});

test("builds accessible web and conforming EPUB outputs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-test-"));
  try {
    await cp(fixture, root, { recursive: true });
    await buildProject(root, ["web", "epub"]);
    await access(path.join(root, "dist", "book.epub"));
    const html = await readFile(path.join(root, "dist", "web", "chapters", "night-train.html"), "utf8");
    assert.match(html, /<article class="chapter bodymatter"/);
    assert.match(html, /role="doc-noteref"/);
    assert.doesNotMatch(html, /<script a=/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("produces byte-identical EPUBs with a fixed source epoch", async () => {
  const first = await mkdtemp(path.join(tmpdir(), "bookforge-repro-a-"));
  const second = await mkdtemp(path.join(tmpdir(), "bookforge-repro-b-"));
  const previous = process.env.SOURCE_DATE_EPOCH;
  process.env.SOURCE_DATE_EPOCH = "946684800";
  try {
    await cp(fixture, first, { recursive: true });
    await cp(fixture, second, { recursive: true });
    await buildProject(first, ["epub"]);
    await buildProject(second, ["epub"]);
    assert.equal(await fileHash(path.join(first, "dist", "book.epub")), await fileHash(path.join(second, "dist", "book.epub")));
  } finally {
    if (previous === undefined) delete process.env.SOURCE_DATE_EPOCH; else process.env.SOURCE_DATE_EPOCH = previous;
    await Promise.all([rm(first, { recursive: true, force: true }), rm(second, { recursive: true, force: true })]);
  }
});
