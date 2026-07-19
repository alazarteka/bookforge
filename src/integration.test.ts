import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { access, mkdtemp, readFile, rm, cp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { buildProject, createPublication } from "./build.js";
import { sectionArticle } from "./html.js";
import { fileHash } from "./util.js";

const fixture = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "synthetic");
const execFileAsync = promisify(execFile);

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

test("resolves same- and cross-chapter heading links in every renderer", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-links-"));
  try {
    await cp(fixture, root, { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "chapters", "01-threshold.md"), "# Threshold\n\n## Local Target\n\n[This heading](#local-target) and [the inventory](02-night-train.md#inventory).\n"),
      writeFile(path.join(root, "chapters", "02-night-train.md"), "# Night Train\n\n## Inventory\n\nA list of things.\n"),
    ]);
    await buildProject(root, ["web", "epub"]);
    const paged = await readFile(path.join(root, "dist", "web", "chapters", "threshold.html"), "utf8");
    assert.match(paged, /href="#threshold--local-target"/);
    assert.match(paged, /href="night-train\.html#night-train--inventory"/);
    assert.match(paged, /<h1 id="threshold--threshold">Threshold<\/h1>/);

    const epub = path.join(root, "dist", "book.epub");
    const epubChapter = (await execFileAsync("unzip", ["-p", epub, "EPUB/threshold.xhtml"])).stdout.toString();
    assert.match(epubChapter, /href="#threshold--local-target"/);
    assert.match(epubChapter, /href="night-train\.xhtml#night-train--inventory"/);

    const { publication } = await createPublication(root);
    const print = sectionArticle(publication.spine[0]!, publication, {
      flavor: "print",
      assets: new Map(),
      chapterFile: (id) => `#${id}`,
      assetPrefix: "assets/",
    });
    assert.match(print, /href="#threshold--local-target"/);
    assert.match(print, /href="#night-train--inventory"/);

    const book = path.join(root, "book.yaml");
    await writeFile(book, (await readFile(book, "utf8")).replace("  web: {}", "  web:\n    reading: continuous"));
    await buildProject(root, ["web"]);
    const continuous = await readFile(path.join(root, "dist", "web", "index.html"), "utf8");
    assert.match(continuous, /href="#threshold--local-target"/);
    assert.match(continuous, /href="#night-train--inventory"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
