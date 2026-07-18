import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildProject } from "./build.js";
import { loadPrintProfile } from "./profile-loader.js";
import { loadTheme } from "./theme-loader.js";

const fixture = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "synthetic");

test("loads built-in themes and print profiles", async () => {
  const theme = await loadTheme(fixture, "classic");
  const profile = await loadPrintProfile(fixture, { profile: "paperback-b5" });
  assert.equal(theme.source, "built-in");
  assert.equal(theme.version, "1.0.0");
  assert.equal(profile.page, "182mm,257mm");
  assert.equal(profile.binding, "perfect");
  assert.equal(profile.color, "grayscale");
});

test("builds a project-local theme and packages its declared assets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-theme-"));
  try {
    await cp(fixture, root, { recursive: true });
    const manifestPath = path.join(root, "book.yaml");
    await writeFile(manifestPath, (await readFile(manifestPath, "utf8")).replace("theme: classic", "theme: custom"));
    const themeRoot = path.join(root, "theme");
    await mkdir(path.join(themeRoot, "assets"), { recursive: true });
    await cp(path.join(root, "assets", "marker.png"), path.join(themeRoot, "assets", "ornament.png"));
    await writeFile(path.join(themeRoot, "theme.yaml"), `schema: 1
id: custom
name: Custom Test
version: 1.0.0
styles:
  tokens: tokens.css
  body: body.css
  web: web.css
  epub: epub.css
  print: print.css
  cover: cover.css
assets:
  - assets/ornament.png
`);
    await Promise.all([
      writeFile(path.join(themeRoot, "tokens.css"), ":root { --ink: #123; }\n"),
      writeFile(path.join(themeRoot, "body.css"), "body { color: var(--ink); }\n"),
      writeFile(path.join(themeRoot, "web.css"), `.custom-theme-marker { background: url("theme-assets/ornament.png"); }\n`),
      writeFile(path.join(themeRoot, "epub.css"), "article { display: block; }\n"),
      writeFile(path.join(themeRoot, "print.css"), "@page { size: var(--book-page); }\n"),
      writeFile(path.join(themeRoot, "cover.css"), ".print-cover { break-after: page; }\n"),
    ]);
    await buildProject(root, ["web", "epub"]);
    assert.match(await readFile(path.join(root, "dist", "web", "reader.css"), "utf8"), /custom-theme-marker/);
    await readFile(path.join(root, "dist", "web", "theme-assets", "ornament.png"));
    assert.equal((await loadTheme(root, "custom")).source, "project");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects themes that reference remote resources", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-unsafe-theme-"));
  try {
    const themeRoot = path.join(root, "theme");
    await mkdir(themeRoot, { recursive: true });
    await writeFile(path.join(themeRoot, "theme.yaml"), `schema: 1
id: unsafe
name: Unsafe
version: 1.0.0
styles: { tokens: style.css, body: style.css, web: style.css, epub: style.css, print: style.css, cover: style.css }
assets: []
`);
    await writeFile(path.join(themeRoot, "style.css"), `body { background: url("https://example.com/tracker.png"); }`);
    await assert.rejects(loadTheme(root, "unsafe"), /remote, embedded, or executable/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
