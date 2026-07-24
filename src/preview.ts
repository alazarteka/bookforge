import { watch, type FSWatcher } from "node:fs";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublication } from "./publication.js";
import { renderWeb } from "./web.js";
import { contentTypeFor } from "./media-types.js";
import { listBuiltInThemes, loadBuiltInTheme } from "./theme-loader.js";
import { atomicReplaceDirectory, containedPath, escapeHtml } from "./util.js";

const PREVIEW_DEBOUNCE_MS = 75;

export function previewContentType(file: string): string {
  return contentTypeFor(file);
}

export function shouldRebuildPreview(filename: string): boolean {
  const normalized = filename.replaceAll("\\", "/");
  if (normalized.startsWith("dist/") || normalized.startsWith(".bookforge-")) return false;
  return /\.(md|ya?ml|css|jpe?g|png|webp|gif|woff2?|otf|ttf)$/i.test(normalized);
}

export async function listenPreviewServer(server: Server, port: number, onRuntimeError?: (error: Error) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      cleanup();
      if (onRuntimeError) server.on("error", onRuntimeError);
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      server.off("listening", onListening);
      server.off("error", onError);
    };
    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(port, "127.0.0.1");
  });
}

export function stopPreviewWatcher(watcher: Pick<FSWatcher, "close">, error: unknown): void {
  watcher.close();
  console.error(`[bookforge] preview watcher failed; live rebuilding stopped: ${error instanceof Error ? error.message : String(error)}`);
}

export function stopPreviewServer(server: Pick<Server, "close">, watcher: Pick<FSWatcher, "close">, error: unknown): void {
  watcher.close();
  server.close();
  console.error(`[bookforge] preview server failed; preview stopped: ${error instanceof Error ? error.message : String(error)}`);
}

export async function previewProject(project: string, port = 4173, themeOverride?: string): Promise<void> {
  const root = path.resolve(project);
  let building = false;
  let queued = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSourceHash: string | undefined;
  const rebuild = async () => {
    if (building) { queued = true; return; }
    building = true;
    try {
      const result = await rebuildPreview(root, renderWeb, themeOverride, lastSourceHash ? { sourceHash: lastSourceHash } : {});
      lastSourceHash = result.sourceHash;
      if (result.rebuilt) console.log(`[bookforge] rebuilt ${new Date().toLocaleTimeString()}`);
    }
    catch (error) { console.error(`[bookforge] rebuild failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { building = false; if (queued) { queued = false; void rebuild(); } }
  };
  const scheduleRebuild = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = undefined; void rebuild(); }, PREVIEW_DEBOUNCE_MS);
  };
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (filename && shouldRebuildPreview(filename)) scheduleRebuild();
  });
  watcher.on("error", (error) => stopPreviewWatcher(watcher, error));
  try {
    await rebuild();
    const webRoot = path.join(root, ".bookforge-preview");
    const server = createServer(async (request, response) => {
      try {
        const rawPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
        const relative = rawPath === "/" ? "index.html" : rawPath.replace(/^\//, "");
        let file = containedPath(webRoot, relative);
        if ((await stat(file).catch(() => undefined))?.isDirectory()) file = path.join(file, "index.html");
        const data = await readFile(file);
        response.writeHead(200, { "content-type": previewContentType(file), "cache-control": "no-store" });
        response.end(data);
      } catch (error) {
        if (isPreviewMissing(error)) {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }
        console.error(`[bookforge] preview request failed: ${error instanceof Error ? error.message : String(error)}`);
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
          response.end("Internal server error");
        }
      }
    });
    await listenPreviewServer(server, port, (error) => stopPreviewServer(server, watcher, error));
    console.log(`[bookforge] preview: http://127.0.0.1:${port}`);
  } catch (error) {
    watcher.close();
    throw error;
  }
}

export async function rebuildPreview(
  root: string,
  render: typeof renderWeb = renderWeb,
  themeOverride?: string,
  state: { sourceHash?: string } = {},
): Promise<{ sourceHash: string; rebuilt: boolean }> {
  const { publication, theme, sourceHash } = await createPublication(root, themeOverride);
  const target = path.join(root, ".bookforge-preview");
  const previewIndex = path.join(target, "index.html");
  if (
    state.sourceHash
    && state.sourceHash === sourceHash
    && (await stat(previewIndex).catch(() => undefined))?.isFile()
  ) {
    return { sourceHash, rebuilt: false };
  }
  const stage = await mkdtemp(path.join(root, ".bookforge-preview-stage-"));
  const previous = path.join(root, ".bookforge-preview-previous");
  try {
    await render(publication, theme, stage);
    await atomicReplaceDirectory(stage, target, previous);
    return { sourceHash, rebuilt: true };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

/** Render every bundled theme side-by-side without changing book.yaml or dist/. */
export async function generateBuiltInThemePreviews(root: string, render: typeof renderWeb = renderWeb): Promise<string> {
  root = path.resolve(root);
  const { publication, config } = await createPublication(root);
  const themes = await listBuiltInThemes();
  const stage = await mkdtemp(path.join(root, ".bookforge-theme-previews-stage-"));
  const target = path.join(root, ".bookforge-theme-previews");
  const previous = path.join(root, ".bookforge-theme-previews-previous");
  try {
    const renders = await Promise.allSettled(themes.map(async (info) => {
      const theme = await loadBuiltInTheme(info.id);
      await render(publication, theme, path.join(stage, info.id), config.outputs.web?.reading ?? "paged");
    }));
    const failed = renders.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    await writeFile(path.join(stage, "index.html"), themePreviewIndex(themes));
    await atomicReplaceDirectory(stage, target, previous);
    return target;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

export function isPreviewMissing(error: unknown): boolean {
  if (error instanceof URIError) return true;
  if (error instanceof Error) {
    const message = error.message;
    if (message.startsWith("Absolute paths are not allowed:") || message.startsWith("Path escapes project root")) return true;
  }
  const code = typeof error === "object" && error && "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
  return code === "ENOENT" || code === "ENOTDIR";
}

function themePreviewIndex(themes: Awaited<ReturnType<typeof listBuiltInThemes>>): string {
  const rows = themes.map((theme) =>
    `<li><a href="${theme.id}/index.html"><strong>${escapeHtml(theme.name)}</strong> <code>${escapeHtml(theme.id)}</code> <span>v${escapeHtml(theme.version)}</span></a></li>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bookforge theme previews</title>
<style>
body{max-width:48rem;margin:3rem auto;padding:0 1.5rem;font:16px/1.5 system-ui,sans-serif;color:#1d1b19}
h1{margin-bottom:.25rem}
ul{padding:0;list-style:none}
li{margin:.75rem 0}
a{display:block;padding:1rem;border:1px solid #ddd;border-radius:.5rem;color:inherit;text-decoration:none}
a:hover{border-color:#666}
code{margin-left:.5rem}
span{color:#666}
</style>
</head>
<body>
<h1>Theme previews</h1>
<p>Each link opens the same book rendered with a built-in Bookforge theme.</p>
<ul>${rows}</ul>
</body>
</html>`;
}
