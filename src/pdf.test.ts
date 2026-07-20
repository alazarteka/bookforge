import assert from "node:assert/strict";
import test from "node:test";
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPublication } from "./build.js";
import { renderPdf } from "./pdf.js";
import { loadPrintProfile } from "./profile-loader.js";

const fixture = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "synthetic");

async function pdfFixture(): Promise<{ root: string; work: string; publication: Awaited<ReturnType<typeof createPublication>>["publication"]; theme: Awaited<ReturnType<typeof createPublication>>["theme"]; profile: Awaited<ReturnType<typeof loadPrintProfile>> }> {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-pdf-"));
  const work = await mkdtemp(path.join(tmpdir(), "bookforge-pdf-work-"));
  await cp(fixture, root, { recursive: true });
  const { publication, config, theme } = await createPublication(root);
  return { root, work, publication, theme, profile: await loadPrintProfile(root, config.outputs.pdf) };
}

const browser = async () => ({ executable: process.execPath, source: "environment" as const });

test("PDF rendering rejects a zero-exit Vivliostyle run that creates no artifact, preserves an existing output, and cleans its work directory", async () => {
  const fixture = await pdfFixture();
  const output = path.join(fixture.work, "book.pdf");
  try {
    await writeFile(output, "previous PDF\n");
    await assert.rejects(
      renderPdf(fixture.publication, fixture.theme, fixture.profile, fixture.work, output, {
        resolveBrowser: browser,
        vivliostyle: process.execPath,
        run: async () => ({ code: 0, stdout: "", stderr: "" }),
      }),
      /Vivliostyle PDF output does not exist/,
    );
    assert.equal(await readFile(output, "utf8"), "previous PDF\n");
    await assert.rejects(access(path.join(fixture.work, "print")));
  } finally {
    await Promise.all([rm(fixture.root, { recursive: true, force: true }), rm(fixture.work, { recursive: true, force: true })]);
  }
});

test("PDF rendering atomically replaces an existing output after Vivliostyle produces a staged artifact", async () => {
  const fixture = await pdfFixture();
  const output = path.join(fixture.work, "book.pdf");
  try {
    await writeFile(output, "previous PDF\n");
    await renderPdf(fixture.publication, fixture.theme, fixture.profile, fixture.work, output, {
      resolveBrowser: browser,
      vivliostyle: process.execPath,
      run: async (_command, args) => {
        const outputIndex = args.indexOf("--output");
        await writeFile(args[outputIndex + 1]!, "new PDF\n");
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    assert.equal(await readFile(output, "utf8"), "new PDF\n");
    assert.deepEqual((await readdir(fixture.work)).filter((entry) => entry.startsWith(".bookforge-pdf-output-")), []);
  } finally {
    await Promise.all([rm(fixture.root, { recursive: true, force: true }), rm(fixture.work, { recursive: true, force: true })]);
  }
});

test("PDF rendering preserves an output placed under the former print work path", async () => {
  const fixture = await pdfFixture();
  const output = path.join(fixture.work, "print", "book.pdf");
  try {
    await renderPdf(fixture.publication, fixture.theme, fixture.profile, fixture.work, output, {
      resolveBrowser: browser,
      vivliostyle: process.execPath,
      run: async (_command, args) => {
        const outputIndex = args.indexOf("--output");
        await writeFile(args[outputIndex + 1]!, "new PDF\n");
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    assert.equal(await readFile(output, "utf8"), "new PDF\n");
    assert.deepEqual((await readdir(fixture.work)).filter((entry) => entry.startsWith(".bookforge-pdf-")), []);
  } finally {
    await Promise.all([rm(fixture.root, { recursive: true, force: true }), rm(fixture.work, { recursive: true, force: true })]);
  }
});

test("PDF rendering rejects a non-executable Vivliostyle path before invoking it and cleans its work directory", async () => {
  const fixture = await pdfFixture();
  const unavailable = path.join(fixture.work, "not-executable");
  await writeFile(unavailable, "not a program\n");
  let invoked = false;
  try {
    await assert.rejects(
      renderPdf(fixture.publication, fixture.theme, fixture.profile, fixture.work, path.join(fixture.work, "book.pdf"), {
        resolveBrowser: browser,
        vivliostyle: unavailable,
        run: async () => {
          invoked = true;
          return { code: 0, stdout: "", stderr: "" };
        },
      }),
      /Vivliostyle executable is unavailable/,
    );
    assert.equal(invoked, false);
    await assert.rejects(access(path.join(fixture.work, "print")));
  } finally {
    await Promise.all([rm(fixture.root, { recursive: true, force: true }), rm(fixture.work, { recursive: true, force: true })]);
  }
});
