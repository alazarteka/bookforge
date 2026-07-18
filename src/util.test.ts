import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { containedPath, escapeHtml, slugify } from "./util.js";

test("escapes markup", () => assert.equal(escapeHtml(`<script a="b">&`), "&lt;script a=&quot;b&quot;&gt;&amp;"));
test("creates stable Unicode-aware slugs", () => assert.equal(slugify("Professor’s Wár"), "professor-s-war"));
test("rejects paths outside the project", () => assert.throws(() => containedPath(path.resolve("fixture"), "../secret"), /escapes project root/));
