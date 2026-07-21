import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildProject } from "./build.js";
import { bookConfigSchema } from "./config.js";
import { loadPrintProfile } from "./profile-loader.js";
import { inspectBuiltInTheme, listBuiltInThemes, loadTheme } from "./theme-loader.js";

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

test("lists and inspects only bundled themes", async () => {
  const themes = await listBuiltInThemes();
  assert.deepEqual(themes.map((theme) => theme.id), ["acorn", "caesura", "classic", "lyceum", "meridian", "riso-club"]);
  const classic = await inspectBuiltInTheme("classic");
  assert.equal(classic.name, "Classic");
  assert.deepEqual(classic.styles, ["tokens.css", "body.css", "web.css", "epub.css", "print.css", "cover.css"]);
  assert.ok(classic.assets.includes("fonts/source-serif-4-variable.woff2"));
});

test("build theme overrides do not rewrite the project configuration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-theme-override-"));
  try {
    await cp(fixture, root, { recursive: true });
    const book = await readFile(path.join(root, "book.yaml"), "utf8");
    await buildProject(root, ["web"], "meridian");
    assert.equal(await readFile(path.join(root, "book.yaml"), "utf8"), book);
    assert.match(await readFile(path.join(root, "dist", "web", "reader.css"), "utf8"), /IBM Plex/);
    const manifest = JSON.parse(await readFile(path.join(root, "dist", "build-manifest.json"), "utf8"));
    assert.equal(manifest.theme.id, "meridian");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("builds a project-local theme and packages declared assets referenced with CSS line continuations", async () => {
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
      writeFile(path.join(themeRoot, "web.css"), String.raw`.custom-theme-marker { background-image: image-set(/**/ url("theme-assets/orna\
ment.png") 1x, url("theme-assets/ornament.png") 2x); border-image-source: -webkit-image-set(url("theme-assets/ornament.png") 1x, url("theme-assets/ornament.png") 2x); }
`),
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

test("rejects direct and string-obscured remote CSS resources", async () => {
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
    const style = path.join(themeRoot, "style.css");
    await writeFile(style, `body { background: url("https://example.com/tracker.png"); }`);
    await assert.rejects(loadTheme(root, "unsafe"), /remote, embedded, or executable/);
    await writeFile(style, `body { content: "unterminated
; background: url(https://example.com/tracker.png); }`);
    await assert.rejects(loadTheme(root, "unsafe"), /remote, embedded, or executable/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects remote CSS source-map directives", async () => {
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
    await writeFile(path.join(themeRoot, "style.css"), "/*# sourceMappingURL=https://example.com/theme.css.map */");
    await assert.rejects(loadTheme(root, "unsafe"), /CSS source maps are not allowed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects escaped CSS resource functions", async () => {
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
    const style = path.join(themeRoot, "style.css");
    await writeFile(style, String.raw`body { background: u\72l(https://example.com/tracker.png); }`);
    await assert.rejects(loadTheme(root, "unsafe"), /remote, embedded, or executable/);
    await writeFile(style, String.raw`@im\70ort "https://example.com/theme.css";`);
    await assert.rejects(loadTheme(root, "unsafe"), /CSS @import is not allowed/);
    await writeFile(style, String.raw`@font-face { src: l\6f cal("Machine Font"); }`);
    await assert.rejects(loadTheme(root, "unsafe"), /CSS local\(\) resources are not allowed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects CSS resource functions split by comments or CRLF escapes", async () => {
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
    const style = path.join(themeRoot, "style.css");
    await writeFile(style, `body { background: u/**/rl(https://example.com/tracker.png); }`);
    await assert.rejects(loadTheme(root, "unsafe"), /remote, embedded, or executable/);
    await writeFile(style, `@font-face { src: l/**/ocal("Machine Font"); }`);
    await assert.rejects(loadTheme(root, "unsafe"), /CSS local\(\) resources are not allowed/);
    await writeFile(style, `body { width: ex/**/pression(document.cookie); }`);
    await assert.rejects(loadTheme(root, "unsafe"), /executable CSS resources are not allowed/);
    await writeFile(style, `body { background: u\\72\r\nl(https://example.com/tracker.png); }`);
    await assert.rejects(loadTheme(root, "unsafe"), /remote, embedded, or executable/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects CSS functions whose string arguments can be URLs", async () => {
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
    const style = path.join(themeRoot, "style.css");
    for (const css of [
      `body { background: image-set("https://example.com/tracker.png" 1x); }`,
      `body { background: -webkit-image-set("https://example.com/tracker.png" 1x); }`,
      `body { background: image("https://example.com/tracker.png"); }`,
      `body { background: src("https://example.com/tracker.png"); }`,
      `body { background: im/**/age-set("https://example.com/tracker.png" 1x); }`,
      `body { background: -webkit-im/**/age-set("https://example.com/tracker.png" 1x); }`,
      String.raw`body { background: im\61ge("https://example.com/tracker.png"); }`,
      `body { background: s/**/rc("https://example.com/tracker.png"); }`,
    ]) {
      await writeFile(style, css);
      await assert.rejects(loadTheme(root, "unsafe"), /CSS string URL resources are not allowed/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects direct string URL candidates in image-set()", async () => {
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
    await writeFile(path.join(themeRoot, "style.css"), `body { background: image-set(/**/ "https://example.com/tracker.png" 1x); }`);
    await assert.rejects(loadTheme(root, "unsafe"), /CSS string URL resources are not allowed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects variable image-set candidates that resolve to remote strings", async () => {
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
    await writeFile(path.join(themeRoot, "style.css"), `body { --remote: "https://example.com/tracker.png"; background: image-set(var(--remote) 1x); }`);
    await assert.rejects(loadTheme(root, "unsafe"), /CSS variable image-set candidates are not allowed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects theme assets that are not fonts or images", async () => {
  for (const asset of ["assets/script.js", "assets/page.html", "assets/extra.css"]) {
    const root = await mkdtemp(path.join(tmpdir(), "bookforge-theme-asset-"));
    try {
      const themeRoot = path.join(root, "theme");
      await mkdir(path.join(themeRoot, "assets"), { recursive: true });
      await writeFile(path.join(themeRoot, "theme.yaml"), `schema: 1
id: unsafe-assets
name: Unsafe Assets
version: 1.0.0
styles: { tokens: style.css, body: style.css, web: style.css, epub: style.css, print: style.css, cover: style.css }
assets: [${asset}]
`);
      await writeFile(path.join(themeRoot, "style.css"), "body {}\n");
      await writeFile(path.join(themeRoot, asset), "payload\n");
      await assert.rejects(loadTheme(root, "unsafe-assets"), /Unsupported theme asset format/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("rejects theme asset names that collide ignoring case", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-theme-case-"));
  try {
    const themeRoot = path.join(root, "theme");
    await mkdir(path.join(themeRoot, "assets"), { recursive: true });
    await writeFile(path.join(themeRoot, "theme.yaml"), `schema: 1
id: case-theme
name: Case Theme
version: 1.0.0
styles: { tokens: style.css, body: style.css, web: style.css, epub: style.css, print: style.css, cover: style.css }
assets: [assets/Foo.woff2, assets/foo.woff2]
`);
    await writeFile(path.join(themeRoot, "style.css"), "body {}\n");
    await writeFile(path.join(themeRoot, "assets", "Foo.woff2"), "first");
    await writeFile(path.join(themeRoot, "assets", "foo.woff2"), "second");
    await assert.rejects(loadTheme(root, "case-theme"), /unique filenames, ignoring case/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("normalizes bare YAML zero lengths and rejects zero-sized custom pages", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-profile-values-"));
  try {
    await mkdir(path.join(root, "profiles"));
    await writeFile(path.join(root, "profiles", "zero.yaml"), `schema: 1
id: zero
name: Zero margins
page: A5
margins: 0
bleed: 0
binding: screen
`);
    const profile = await loadPrintProfile(root, { profile: "zero" });
    assert.equal(profile.margins, "0");
    assert.equal(profile.bleed, "0");
    const config = bookConfigSchema.parse({ schema: 1, id: "book", title: "Book", authors: [{ name: "Author" }], chapters: [{ id: "chapter", path: "chapter.md" }], outputs: { pdf: { margins: 0 } } });
    assert.equal(config.outputs.pdf?.margins, "0");

    await writeFile(path.join(root, "profiles", "zero.yaml"), `schema: 1
id: zero
name: Zero page
page: "0,0"
margins: 0
binding: screen
`);
    await assert.rejects(loadPrintProfile(root, { profile: "zero" }), /custom page dimensions must be strictly positive/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects a project theme style symbolic link that escapes the project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-theme-link-"));
  const outside = await mkdtemp(path.join(tmpdir(), "bookforge-outside-"));
  try {
    const themeRoot = path.join(root, "theme");
    await mkdir(themeRoot, { recursive: true });
    const style = path.join(outside, "style.css");
    await writeFile(style, "body { color: black; }\n");
    await symlink(style, path.join(themeRoot, "style.css"));
    await writeFile(path.join(themeRoot, "theme.yaml"), `schema: 1
id: linked-theme
name: Linked Theme
version: 1.0.0
styles: { tokens: style.css, body: style.css, web: style.css, epub: style.css, print: style.css, cover: style.css }
assets: []
`);
    await assert.rejects(loadTheme(root, "linked-theme"), /symbolic link/);
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  }
});

test("rejects a project theme directory symbolic link that escapes the project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-theme-link-"));
  const outside = await mkdtemp(path.join(tmpdir(), "bookforge-outside-"));
  try {
    await writeFile(path.join(outside, "style.css"), "body { color: black; }\n");
    await writeFile(path.join(outside, "theme.yaml"), `schema: 1
id: linked-theme
name: Linked Theme
version: 1.0.0
styles: { tokens: style.css, body: style.css, web: style.css, epub: style.css, print: style.css, cover: style.css }
assets: []
`);
    await symlink(outside, path.join(root, "theme"), "dir");
    await assert.rejects(loadTheme(root, "linked-theme"), /symbolic link/);
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  }
});

test("rejects a project profile symbolic link that escapes the project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-profile-link-"));
  const outside = await mkdtemp(path.join(tmpdir(), "bookforge-outside-"));
  try {
    await mkdir(path.join(root, "profiles"));
    const profile = path.join(outside, "linked.yaml");
    await writeFile(profile, `schema: 1
id: linked
name: Linked
page: A5
margins: 10mm
binding: screen
`);
    await symlink(profile, path.join(root, "profiles", "linked.yaml"));
    await assert.rejects(loadPrintProfile(root, { profile: "linked" }), /symbolic link/);
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  }
});
