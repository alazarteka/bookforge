import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { containedPath } from "./util.js";
import { bookConfigSchema, loadConfig } from "./config.js";
import { parseMarkdown } from "./pandoc.js";
import { buildProject, createPublication } from "./build.js";
import type { Format } from "./build.js";

// Bookforge's principle (docs/SCOPE.md §2, §5, §10): unsupported or unsafe input
// must fail with a useful diagnostic rather than silently degrading. These tests
// assert the documented rejections actually throw with the expected messages.

const fixture = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "synthetic");

// A minimal, schema-valid manifest used as a base for pure schema-shape checks
// (language/theme/role carry defaults, so they are intentionally omitted).
const validConfig = {
  schema: 1,
  id: "book",
  title: "Title",
  authors: [{ name: "Author" }],
  chapters: [{ id: "ch1", path: "ch1.md" }],
  outputs: { web: {} },
};

// --- Pure rejections (no external tools; always runnable) -------------------

test("containedPath rejects an absolute path", () => {
  assert.throws(() => containedPath(path.resolve("project"), "/etc/passwd"), /Absolute paths are not allowed/);
});

test("containedPath rejects a path that escapes the project root", () => {
  assert.throws(() => containedPath(path.resolve("project"), "../escape"), /Path escapes project root/);
});

test("containedPath accepts a normal nested path", () => {
  const root = path.resolve("project");
  assert.equal(containedPath(root, "chapters/one.md"), path.join(root, "chapters", "one.md"));
});

test("loadConfig rejects a chapter symbolic link that escapes the project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-reject-chapter-link-"));
  const outside = await mkdtemp(path.join(tmpdir(), "bookforge-outside-"));
  try {
    await cp(fixture, root, { recursive: true });
    const target = path.join(outside, "chapter.md");
    await writeFile(target, "# Outside\n");
    await symlink(target, path.join(root, "chapters", "escape.md"));
    await writeFile(path.join(root, "book.yaml"), [
      "schema: 1",
      "id: linked-book",
      "title: T",
      "authors:",
      "  - name: A",
      "chapters:",
      "  - id: chapter",
      "    path: chapters/escape.md",
      "outputs:",
      "  web: {}",
      "",
    ].join("\n"));
    await assert.rejects(loadConfig(root), /symbolic link/);
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  }
});

test("bookConfigSchema rejects unknown top-level keys (strict)", () => {
  assert.throws(() => bookConfigSchema.parse({ ...validConfig, extra: true }), /[Uu]nrecognized key/);
});

test("bookConfigSchema rejects an empty outputs object", () => {
  assert.throws(() => bookConfigSchema.parse({ ...validConfig, outputs: {} }), /at least one output is required/);
});

test("bookConfigSchema rejects a theme path instead of an identifier", () => {
  assert.throws(() => bookConfigSchema.parse({ ...validConfig, theme: "../outside" }), /lowercase stable identifier/);
});

test("loadConfig rejects a duplicate chapter id", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-reject-dup-"));
  try {
    await cp(fixture, root, { recursive: true });
    // Both chapter files exist so the duplicate-id check (not a missing file) is what fires.
    await writeFile(path.join(root, "book.yaml"), [
      "schema: 1",
      "id: dup-book",
      "title: T",
      "authors:",
      "  - name: A",
      "chapters:",
      "  - id: same",
      "    path: chapters/01-threshold.md",
      "  - id: same",
      "    path: chapters/02-night-train.md",
      "outputs:",
      "  web: {}",
      "",
    ].join("\n"));
    await assert.rejects(loadConfig(root), /Duplicate chapter id/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadConfig rejects a chapter path that is not Markdown", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-reject-ext-"));
  try {
    await cp(fixture, root, { recursive: true });
    // marker.png exists in the fixture, so ensureFile passes and the ".md" check is reached.
    await writeFile(path.join(root, "book.yaml"), [
      "schema: 1",
      "id: ext-book",
      "title: T",
      "authors:",
      "  - name: A",
      "chapters:",
      "  - id: cover-chapter",
      "    path: assets/marker.png",
      "outputs:",
      "  web: {}",
      "",
    ].join("\n"));
    await assert.rejects(loadConfig(root), /Chapter must be Markdown/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- Pandoc-dependent rejections (parseMarkdown shells out to `pandoc`) ------

// Writes `markdown` to a temp chapter and runs it through parseMarkdown; the
// returned promise rejects for unsupported/unsafe constructs. Temp dir is always
// cleaned up, even on rejection.
async function parseSource(markdown: string): Promise<unknown> {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-reject-md-"));
  try {
    const file = path.join(root, "chapter.md");
    await writeFile(file, markdown);
    return await parseMarkdown(file, root, "chapter", "bodymatter");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("parseMarkdown rejects raw HTML", async () => {
  await assert.rejects(parseSource("<div>hello</div>\n"), /chapter\.md:1:1: raw HTML is not supported; write literal angle-bracket text as inline code/);
});

test("parseMarkdown supports GFM strikeout", async () => {
  const section = await parseSource("# Title\n\nA ~~deliberate revision~~.\n") as Awaited<ReturnType<typeof parseMarkdown>>;
  const paragraph = section.blocks[0];
  assert.equal(paragraph?.type, "paragraph");
  if (paragraph?.type === "paragraph") assert.equal(paragraph.children[2]?.type, "strikeout");
});

test("parseMarkdown rejects a javascript: link protocol", async () => {
  await assert.rejects(parseSource("[click me](javascript:alert(1))\n"), /unsafe link protocol/);
});

test("parseMarkdown rejects non-allowlisted and protocol-relative links", async () => {
  await assert.rejects(parseSource("[data](data:text/html,hello)\n"), /unsafe link protocol/);
  await assert.rejects(parseSource("[network-path](//example.com/path)\n"), /unsafe link protocol/);
});

test("parseMarkdown permits explicitly allowlisted link protocols", async () => {
  await assert.doesNotReject(parseSource("[web](https://example.com) [mail](mailto:reader@example.com) [call](tel:+821012345678)\n"));
});

test("parseMarkdown rejects an image without alternative text", async () => {
  await assert.rejects(parseSource("![](figure.png)\n"), /images require alternative text/);
});

test("parseMarkdown rejects a remote image", async () => {
  await assert.rejects(parseSource("![a satellite view](https://example.com/city.png)\n"), /remote images are not supported/);
});

test("parseMarkdown rejects an embedded data-URI image", async () => {
  await assert.rejects(parseSource("![tiny pixel](data:image/png;base64,iVBORw0KGgo=)\n"), /remote or embedded images are not supported/);
});

test("parseMarkdown rejects a heading hierarchy jump", async () => {
  await assert.rejects(parseSource("# Title\n\n## Section\n\n#### Deep\n"), /heading hierarchy jumps from level 2 to 4/);
});

// --- Build-level rejections (run the pipeline, then fail) --------------------

test("buildProject rejects an unknown output format", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-reject-fmt-"));
  try {
    await cp(fixture, root, { recursive: true });
    await assert.rejects(buildProject(root, ["bogus"] as unknown as Format[]), /Unknown formats/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createPublication rejects a broken chapter link", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-reject-link-"));
  try {
    await cp(fixture, root, { recursive: true });
    // A .md link with no matching chapter must fail rather than dangle.
    await writeFile(
      path.join(root, "chapters", "01-threshold.md"),
      "# Threshold\n\nSee the [missing chapter](does-not-exist.md).\n",
    );
    await assert.rejects(createPublication(root), /Broken chapter link/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createPublication rejects an image symbolic link that escapes the project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-reject-image-link-"));
  const outside = await mkdtemp(path.join(tmpdir(), "bookforge-outside-"));
  try {
    await cp(fixture, root, { recursive: true });
    const target = path.join(outside, "image.png");
    await cp(path.join(root, "assets", "marker.png"), target);
    await symlink(target, path.join(root, "assets", "escape.png"));
    await writeFile(path.join(root, "chapters", "01-threshold.md"), "# Threshold\n\n![Escaped asset](../assets/escape.png)\n");
    await assert.rejects(createPublication(root), /symbolic link/);
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  }
});
