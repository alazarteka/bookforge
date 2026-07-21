import assert from "node:assert/strict";
import test from "node:test";
import type { Publication, Section } from "./model.js";
import { collectLinkIssues, headingTargets, rewriteChapterLinks } from "./links.js";

function section(id: string, overrides: Partial<Section> = {}): Section {
  return {
    id,
    role: "bodymatter",
    title: [{ type: "text", value: id }],
    titleAnchor: `${id}--title`,
    blocks: [{ type: "heading", level: 2, id: `${id}--local-target`, children: [{ type: "text", value: "Local" }] }],
    ...overrides,
  };
}

test("headingTargets registers short-form, prefixed, title, and section ids", () => {
  const targets = headingTargets(section("chapter"));
  assert.equal(targets.get("chapter--local-target"), "chapter--local-target");
  assert.equal(targets.get("local-target"), "chapter--local-target");
  assert.equal(targets.get("chapter--title"), "chapter--title");
  assert.equal(targets.get("title"), "chapter--title");
  assert.equal(targets.get("chapter"), "chapter");
});

test("rewriteChapterLinks rewrites same- and cross-chapter heading links", () => {
  const one = section("one");
  const two = section("two");
  const publication: Publication = {
    schemaVersion: 1,
    id: "book",
    metadata: { title: "Book", language: "en", authors: ["Author"] },
    spine: [one, two],
    assets: [],
  };
  one.blocks.push({
    type: "paragraph",
    children: [
      { type: "link", href: "#local-target", children: [{ type: "text", value: "same" }] },
      { type: "link", href: "chapters/two.md#local-target", children: [{ type: "text", value: "cross" }] },
    ],
  });
  rewriteChapterLinks(publication, "/project", [
    { id: "one", path: "chapters/one.md" },
    { id: "two", path: "chapters/two.md" },
  ]);
  const links = one.blocks.flatMap((block) => block.type === "paragraph" ? block.children.filter((child) => child.type === "link") : []);
  assert.equal(links[0] && links[0].type === "link" ? links[0].href : "", "#one--local-target");
  assert.equal(links[1] && links[1].type === "link" ? links[1].href : "", "two.md#two--local-target");
});

test("rewriteChapterLinks throws on broken chapter and heading links", () => {
  const one = section("one");
  const publication: Publication = {
    schemaVersion: 1,
    id: "book",
    metadata: { title: "Book", language: "en", authors: ["Author"] },
    spine: [one],
    assets: [],
  };
  one.blocks = [{ type: "paragraph", children: [{ type: "link", href: "missing.md", children: [{ type: "text", value: "x" }] }] }];
  assert.throws(() => rewriteChapterLinks(publication, "/project", [{ id: "one", path: "chapters/one.md" }]), /Broken chapter link/);
  one.blocks = [{ type: "paragraph", children: [{ type: "link", href: "#no-such-id", children: [{ type: "text", value: "x" }] }] }];
  assert.throws(() => rewriteChapterLinks(publication, "/project", [{ id: "one", path: "chapters/one.md" }]), /Broken heading link/);
});

test("collectLinkIssues reports broken chapter and heading fragments", () => {
  const one = section("one");
  const two = section("two");
  one.blocks = [{
    type: "paragraph",
    children: [
      { type: "link", href: "missing.md#heading", children: [{ type: "text", value: "chapter" }] },
      { type: "link", href: "#no-such-id", children: [{ type: "text", value: "same" }] },
      { type: "link", href: "chapters/two.md#no-such-id", children: [{ type: "text", value: "cross" }] },
    ],
  }];
  const issues = collectLinkIssues("/project", [
    { chapter: { id: "one", path: "chapters/one.md" }, section: one },
    { chapter: { id: "two", path: "chapters/two.md" }, section: two },
  ]);
  assert.equal(issues.length, 3);
  assert.ok(issues.some((issue) => /Broken chapter link "missing\.md#heading"/.test(issue.message)));
  assert.ok(issues.some((issue) => /Broken heading link "#no-such-id"/.test(issue.message)));
  assert.ok(issues.some((issue) => /Broken heading link "chapters\/two\.md#no-such-id"/.test(issue.message)));
});
