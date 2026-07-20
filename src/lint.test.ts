import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { lintProject } from "./lint.js";

test("lint reports every manifest schema problem without requiring a build", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-lint-schema-"));
  try {
    await writeFile(path.join(root, "book.yaml"), [
      "schema: 2",
      "id: Not Stable",
      "title: ''",
      "authors: []",
      "chapters: []",
      "outputs: {}",
      "",
    ].join("\n"));
    const result = await lintProject(root);
    assert.ok(result.issues.length >= 5);
    assert.ok(result.issues.every((issue) => issue.file === "book.yaml"));
    assert.ok(result.issues.some((issue) => issue.message.startsWith("schema:")));
    assert.ok(result.issues.some((issue) => issue.message.startsWith("outputs:")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("lint aggregates missing chapter files and unsafe chapter paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-lint-chapters-"));
  try {
    await writeFile(path.join(root, "book.yaml"), [
      "schema: 1",
      "id: book",
      "title: A Book",
      "authors:",
      "  - name: Author",
      "chapters:",
      "  - id: missing",
      "    path: chapters/missing.md",
      "  - id: escape",
      "    path: ../outside.md",
      "  - id: wrong-kind",
      "    path: chapters/chapter.txt",
      "outputs:",
      "  web: {}",
      "",
    ].join("\n"));
    const result = await lintProject(root);
    assert.equal(result.issues.length, 3);
    assert.deepEqual(result.issues.map((issue) => issue.file), ["../outside.md", "chapters/chapter.txt", "chapters/missing.md"]);
    assert.match(result.issues[0]?.message ?? "", /Path escapes project root/);
    assert.match(result.issues[2]?.message ?? "", /Chapter file is missing/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("lint gives a useful result when no manifest exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-lint-missing-"));
  try {
    const result = await lintProject(root);
    assert.deepEqual(result, { chapters: 0, issues: [{ file: "book.yaml", message: "Book manifest is missing. Create book.yaml or run `bookforge init <directory>`." }] });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("lint checks local links and images but leaves external link fragments alone", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-lint-references-"));
  try {
    await mkdir(path.join(root, "chapters"));
    await writeFile(path.join(root, "book.yaml"), [
      "schema: 1",
      "id: book",
      "title: A Book",
      "authors:",
      "  - name: Author",
      "chapters:",
      "  - id: one",
      "    path: chapters/01-one.md",
      "outputs:",
      "  web: {}",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "chapters", "01-one.md"), "# One\n\n[Elsewhere](missing.md#heading) [External](https://example.com/page#section)\n\n![Missing figure](missing.png)\n");
    const result = await lintProject(root);
    assert.equal(result.issues.length, 2);
    assert.ok(result.issues.some((issue) => /Broken chapter link/.test(issue.message)));
    assert.ok(result.issues.some((issue) => /Image "chapters\/missing.png" is missing/.test(issue.message)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("lint reports broken same- and cross-chapter heading fragments", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-lint-headings-"));
  try {
    await mkdir(path.join(root, "chapters"));
    await writeFile(path.join(root, "book.yaml"), [
      "schema: 1",
      "id: book",
      "title: A Book",
      "authors:",
      "  - name: Author",
      "chapters:",
      "  - id: one",
      "    path: chapters/01-one.md",
      "  - id: two",
      "    path: chapters/02-two.md",
      "outputs:",
      "  web: {}",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "chapters", "01-one.md"), "# One\n\n## Present\n\n[Missing](#no-such-id) [Cross](02-two.md#no-such-id)\n");
    await writeFile(path.join(root, "chapters", "02-two.md"), "# Two\n\n## Elsewhere\n");
    const result = await lintProject(root);
    assert.ok(result.issues.some((issue) => /Broken heading link "#no-such-id"/.test(issue.message)));
    assert.ok(result.issues.some((issue) => /Broken heading link "chapters\/02-two\.md#no-such-id"/.test(issue.message)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("lint does not report a configured but unparseable link target as missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-lint-unparseable-link-"));
  try {
    await mkdir(path.join(root, "chapters"));
    await writeFile(path.join(root, "book.yaml"), [
      "schema: 1",
      "id: book",
      "title: A Book",
      "authors:",
      "  - name: Author",
      "chapters:",
      "  - id: source",
      "    path: chapters/01-source.md",
      "  - id: target",
      "    path: chapters/02-target.md",
      "outputs:",
      "  web: {}",
      "",
    ].join("\n"));
    await writeFile(path.join(root, "chapters", "01-source.md"), "# Source\n\n[Target](02-target.md#section)\n");
    await writeFile(path.join(root, "chapters", "02-target.md"), "<div>unsupported</div>\n");

    const result = await lintProject(root);
    assert.equal(result.issues.length, 1);
    assert.match(result.issues[0]?.message ?? "", /raw HTML is not supported/);
    assert.ok(!result.issues.some((issue) => /Broken (chapter|heading) link/.test(issue.message)));
  } finally { await rm(root, { recursive: true, force: true }); }
});
