import assert from "node:assert/strict";
import test from "node:test";
import { projectToolExecutable } from "./tool-paths.js";

test("resolves project-local executable names", () => {
  assert.equal(projectToolExecutable("/opt/bookforge", "vivliostyle", {}), "/opt/bookforge/node_modules/.bin/vivliostyle");
});

test("allows a project tool executable override", () => {
  assert.equal(projectToolExecutable("/opt/bookforge", "vivliostyle", { BOOKFORGE_VIVLIOSTYLE: "/custom/vivliostyle" }), "/custom/vivliostyle");
});
