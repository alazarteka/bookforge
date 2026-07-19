import assert from "node:assert/strict";
import test from "node:test";
import { browserCandidates, resolveBrowser } from "./browser.js";

test("lists platform browser candidates for supported release targets", () => {
  assert.ok(browserCandidates("darwin").some((candidate) => candidate.includes("Google Chrome.app")));
  assert.ok(browserCandidates("linux").includes("google-chrome"));
  assert.ok(browserCandidates("linux").includes("chromium"));
});

test("honors BOOKFORGE_BROWSER before platform discovery", async () => {
  const browser = await resolveBrowser({ BOOKFORGE_BROWSER: "/bin/sh" }, "linux");
  assert.deepEqual(browser, { executable: "/bin/sh", source: "environment" });
  await assert.rejects(resolveBrowser({ BOOKFORGE_BROWSER: "/not/a/browser" }, "linux"), /does not resolve to an executable/);
});
