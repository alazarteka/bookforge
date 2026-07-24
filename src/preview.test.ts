import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import type { FSWatcher } from "node:fs";
import { access, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateBuiltInThemePreviews, isPreviewMissing, listenPreviewServer, previewContentType, rebuildPreview, shouldRebuildPreview, stopPreviewServer, stopPreviewWatcher } from "./preview.js";
import { containedPath } from "./util.js";

const fixture = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "synthetic");

test("isPreviewMissing maps missing and invalid paths to 404, not unexpected errors", () => {
  assert.equal(isPreviewMissing(new URIError("bad percent encoding")), true);
  assert.equal(isPreviewMissing(Object.assign(new Error("missing"), { code: "ENOENT" })), true);
  assert.equal(isPreviewMissing(Object.assign(new Error("not a dir"), { code: "ENOTDIR" })), true);
  try {
    containedPath(path.resolve("project"), "/etc/passwd");
  } catch (error) {
    assert.equal(isPreviewMissing(error), true);
  }
  try {
    containedPath(path.resolve("project"), "../escape");
  } catch (error) {
    assert.equal(isPreviewMissing(error), true);
  }
  assert.equal(isPreviewMissing(new Error("socket failed")), false);
  assert.equal(isPreviewMissing(Object.assign(new Error("denied"), { code: "EACCES" })), false);
});

test("preview watches supported source assets and serves them with their media types", () => {
  assert.equal(shouldRebuildPreview("theme/fonts/reader.woff2"), true);
  assert.equal(shouldRebuildPreview("theme/fonts/reader.otf"), true);
  assert.equal(shouldRebuildPreview("assets/animation.gif"), true);
  assert.equal(shouldRebuildPreview(".bookforge-preview/reader.css"), false);
  assert.equal(previewContentType("reader.woff2"), "font/woff2");
  assert.equal(previewContentType("reader.ttf"), "font/ttf");
  assert.equal(previewContentType("animation.gif"), "image/gif");
});

test("preview listener rejects asynchronous listen errors", async () => {
  const server = new EventEmitter() as EventEmitter & { listen: () => void };
  server.listen = () => queueMicrotask(() => server.emit("error", Object.assign(new Error("port already in use"), { code: "EADDRINUSE" })));
  await assert.rejects(listenPreviewServer(server as unknown as Server, 4173), (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE");
});

test("preview listener keeps a runtime error handler after startup", async (t) => {
  const server = new EventEmitter() as EventEmitter & { close: () => void; listen: () => void };
  let serverClosed = false;
  let watcherClosed = false;
  const messages: unknown[][] = [];
  const watcher = { close: () => { watcherClosed = true; } } as Pick<FSWatcher, "close">;
  t.mock.method(console, "error", (...args: unknown[]) => { messages.push(args); });
  server.listen = () => queueMicrotask(() => server.emit("listening"));
  server.close = () => { serverClosed = true; };
  const onRuntimeError = (error: Error) => stopPreviewServer(server as unknown as Pick<Server, "close">, watcher, error);
  await listenPreviewServer(server as unknown as Server, 4173, onRuntimeError);
  server.emit("error", new Error("socket failed"));
  assert.equal(serverClosed, true);
  assert.equal(watcherClosed, true);
  assert.match(messages.flat().join(" "), /preview server failed; preview stopped: socket failed/);
});

test("preview stops live rebuilding and reports watcher failures", (t) => {
  let closed = false;
  const messages: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { messages.push(args); });
  stopPreviewWatcher({ close: () => { closed = true; } } as Pick<FSWatcher, "close">, new Error("too many files"));
  assert.equal(closed, true);
  assert.match(messages.flat().join(" "), /preview watcher failed; live rebuilding stopped: too many files/);
});

test("preview rebuild replaces output and removes its staging directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-preview-"));
  try {
    await cp(fixture, root, { recursive: true });
    await mkdir(path.join(root, ".bookforge-preview"));
    await writeFile(path.join(root, ".bookforge-preview", "stale.txt"), "old output\n");
    await rebuildPreview(root);
    await access(path.join(root, ".bookforge-preview", "index.html"));
    await assert.rejects(access(path.join(root, ".bookforge-preview", "stale.txt")));
    assert.deepEqual((await readdir(root)).filter((entry) => entry.startsWith(".bookforge-preview-")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("preview hash short-circuit rebuilds when index.html is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-preview-"));
  try {
    await cp(fixture, root, { recursive: true });
    const first = await rebuildPreview(root);
    assert.equal(first.rebuilt, true);
    const skipped = await rebuildPreview(root, undefined, undefined, { sourceHash: first.sourceHash });
    assert.equal(skipped.rebuilt, false);
    await rm(path.join(root, ".bookforge-preview", "index.html"));
    const recovered = await rebuildPreview(root, undefined, undefined, { sourceHash: first.sourceHash });
    assert.equal(recovered.rebuilt, true);
    await access(path.join(root, ".bookforge-preview", "index.html"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("preview rebuild preserves the previous output and cleans its stage on render failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-preview-"));
  try {
    await cp(fixture, root, { recursive: true });
    await mkdir(path.join(root, ".bookforge-preview"));
    await writeFile(path.join(root, ".bookforge-preview", "keep.txt"), "old output\n");
    await assert.rejects(rebuildPreview(root, async () => { throw new Error("render failed"); }), /render failed/);
    await access(path.join(root, ".bookforge-preview", "keep.txt"));
    assert.deepEqual((await readdir(root)).filter((entry) => entry.startsWith(".bookforge-preview-")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("preview theme overrides leave book.yaml unchanged", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-preview-"));
  try {
    await cp(fixture, root, { recursive: true });
    const book = await readFile(path.join(root, "book.yaml"), "utf8");
    await rebuildPreview(root, undefined, "meridian");
    assert.equal(await readFile(path.join(root, "book.yaml"), "utf8"), book);
    assert.match(await readFile(path.join(root, ".bookforge-preview", "reader.css"), "utf8"), /IBM Plex/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("built-in theme previews preserve dist and publish every theme atomically", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-theme-previews-"));
  try {
    await cp(fixture, root, { recursive: true });
    await mkdir(path.join(root, "dist"));
    await writeFile(path.join(root, "dist", "keep.txt"), "existing build\n");
    const book = await readFile(path.join(root, "book.yaml"), "utf8");
    const destination = await generateBuiltInThemePreviews(root);
    assert.equal(destination, path.join(root, ".bookforge-theme-previews"));
    await access(path.join(root, "dist", "keep.txt"));
    assert.equal(await readFile(path.join(root, "book.yaml"), "utf8"), book);
    const index = await readFile(path.join(destination, "index.html"), "utf8");
    for (const id of ["acorn", "caesura", "classic", "lyceum", "meridian", "riso-club"]) {
      await access(path.join(destination, id, "index.html"));
      assert.match(index, new RegExp(`${id}/index\\.html`));
    }
    assert.deepEqual((await readdir(root)).filter((entry) => entry.includes("theme-previews-stage") || entry.endsWith("theme-previews-previous")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed built-in theme previews preserve the previous comparison", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bookforge-theme-previews-"));
  try {
    await cp(fixture, root, { recursive: true });
    const target = path.join(root, ".bookforge-theme-previews");
    await mkdir(target);
    await writeFile(path.join(target, "keep.txt"), "previous comparison\n");
    await assert.rejects(generateBuiltInThemePreviews(root, async (_publication, theme) => {
      if (theme.id === "classic") throw new Error("render failed");
    }), /render failed/);
    await access(path.join(target, "keep.txt"));
    assert.deepEqual((await readdir(root)).filter((entry) => entry.includes("theme-previews-stage") || entry.endsWith("theme-previews-previous")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
