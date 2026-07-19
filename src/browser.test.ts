import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { browserCandidates, browserSetupMessage, resolveBrowser } from "./browser.js";

test("lists platform browser candidates for supported release targets", () => {
  assert.ok(browserCandidates("darwin").some((candidate) => candidate.includes("Google Chrome.app")));
  assert.ok(browserCandidates("darwin").some((candidate) => candidate.includes("Microsoft Edge.app")));
  assert.ok(browserCandidates("linux").includes("google-chrome"));
  assert.ok(browserCandidates("linux").includes("chromium"));
  assert.ok(browserCandidates("linux").includes("microsoft-edge"));
  assert.deepEqual(browserCandidates("win32"), []);
});

test("honors BOOKFORGE_BROWSER before platform discovery", async () => {
  const browser = await resolveBrowser({ BOOKFORGE_BROWSER: process.execPath }, process.platform);
  assert.deepEqual(browser, { executable: process.execPath, source: "environment" });
  await assert.rejects(resolveBrowser({ BOOKFORGE_BROWSER: path.join(tmpdir(), "bookforge-no-browser") }, process.platform), /does not resolve to an executable/);
});

test("reports Windows as unsupported rather than accepting a browser override", async () => {
  assert.match(browserSetupMessage("win32"), /Windows is not a supported Bookforge runtime target/);
  assert.equal(await resolveBrowser({ BOOKFORGE_BROWSER: process.execPath }, "win32"), undefined);
});
