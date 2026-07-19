import { watch } from "node:fs";
import { createServer } from "node:http";
import { mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublication } from "./build.js";
import { renderWeb } from "./web.js";
import { listBuiltInThemes, loadBuiltInTheme } from "./theme-loader.js";
import { containedPath, escapeHtml } from "./util.js";

const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

export async function previewProject(project: string, port = 4173, themeOverride?: string): Promise<void> {
  const root = path.resolve(project);
  let building = false;
  let queued = false;
  const rebuild = async () => {
    if (building) { queued = true; return; }
    building = true;
    try { await rebuildPreview(root, renderWeb, themeOverride); console.log(`[bookforge] rebuilt ${new Date().toLocaleTimeString()}`); }
    catch (error) { console.error(`[bookforge] rebuild failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { building = false; if (queued) { queued = false; void rebuild(); } }
  };
  await rebuild();
  const webRoot = path.join(root, ".bookforge-preview");
  const server = createServer(async (request, response) => {
    try {
      const rawPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const relative = rawPath === "/" ? "index.html" : rawPath.replace(/^\//, "");
      let file = containedPath(webRoot, relative);
      if ((await stat(file).catch(() => undefined))?.isDirectory()) file = path.join(file, "index.html");
      const data = await readFile(file);
      response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(data);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); response.end("Not found");
    }
  });
  server.listen(port, "127.0.0.1", () => console.log(`[bookforge] preview: http://127.0.0.1:${port}`));
  watch(root, { recursive: true }, (_event, filename) => {
    if (!filename || filename.startsWith("dist/") || filename.startsWith(".bookforge-")) return;
    if (/\.(md|ya?ml|css|jpe?g|png|webp|gif)$/i.test(filename)) void rebuild();
  });
}

export async function rebuildPreview(root: string, render: typeof renderWeb = renderWeb, themeOverride?: string): Promise<void> {
  const { publication, theme } = await createPublication(root, themeOverride);
  const stage = await mkdtemp(path.join(root, ".bookforge-preview-stage-"));
  const target = path.join(root, ".bookforge-preview");
  const previous = path.join(root, ".bookforge-preview-previous");
  try {
    await render(publication, theme, stage);
    await rm(previous, { recursive: true, force: true });
    await rename(target, previous).catch(() => undefined);
    try { await rename(stage, target); }
    catch (error) { await rename(previous, target).catch(() => undefined); throw error; }
    await rm(previous, { recursive: true, force: true });
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
    await rm(previous, { recursive: true, force: true });
    await rename(target, previous).catch(() => undefined);
    try { await rename(stage, target); }
    catch (error) { await rename(previous, target).catch(() => undefined); throw error; }
    await rm(previous, { recursive: true, force: true });
    return target;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

function themePreviewIndex(themes: Awaited<ReturnType<typeof listBuiltInThemes>>): string {
  const rows = themes.map((theme) => `<li><a href="${theme.id}/index.html"><strong>${escapeHtml(theme.name)}</strong> <code>${escapeHtml(theme.id)}</code> <span>v${escapeHtml(theme.version)}</span></a></li>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bookforge theme previews</title><style>body{max-width:48rem;margin:3rem auto;padding:0 1.5rem;font:16px/1.5 system-ui,sans-serif;color:#1d1b19}h1{margin-bottom:.25rem}ul{padding:0;list-style:none}li{margin:.75rem 0}a{display:block;padding:1rem;border:1px solid #ddd;border-radius:.5rem;color:inherit;text-decoration:none}a:hover{border-color:#666}code{margin-left:.5rem}span{color:#666}</style></head><body><h1>Theme previews</h1><p>Each link opens the same book rendered with a built-in Bookforge theme.</p><ul>${rows}</ul></body></html>`;
}
