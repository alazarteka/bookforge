import assert from "node:assert/strict";
import test from "node:test";
import { doctor } from "./doctor.js";

const browser = { executable: "/test/browser", source: "environment" as const };

function probe(browserVersion: string) {
  return async (command: string) => {
    if (command === browser.executable) return { stdout: browserVersion, stderr: "", code: 0 };
    if (command === "node") return { stdout: "v24.18.0", stderr: "", code: 0 };
    if (command === "pandoc") return { stdout: "pandoc 3.7.0.2", stderr: "", code: 0 };
    if (command === "epubcheck") return { stdout: "EPUBCheck v5.3.0", stderr: "", code: 0 };
    if (command === "pdfinfo") return { stdout: "pdfinfo version 25.01.0", stderr: "", code: 0 };
    return { stdout: "cli: 11.1.0", stderr: "", code: 0 };
  };
}

test("doctor rejects runnable executables whose version banner is not a supported browser", async () => {
  const output: string[] = [];
  const healthy = await doctor({
    resolveBrowser: async () => browser,
    run: probe("v24.18.0"),
    log: (message) => { output.push(String(message)); },
  });
  assert.equal(healthy, false);
  assert.match(output.join("\n"), /✗ Browser \(environment\): v24\.18\.0/);
});

test("doctor accepts Chrome, Chromium, and Edge version banners", async () => {
  for (const version of ["Google Chrome 142.0.7444.59", "Chromium 142.0.7444.59", "Microsoft Edge 142.0.3595.94"]) {
    assert.equal(await doctor({
      resolveBrowser: async () => browser,
      run: probe(version),
      log: () => {},
    }), true, version);
  }
});
