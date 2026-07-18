import { watch } from "node:fs";
import { createServer } from "node:http";
import { mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createPublication } from "./build.js";
import { renderWeb } from "./web.js";
import { containedPath } from "./util.js";

const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

export async function previewProject(project: string, port = 4173): Promise<void> {
  const root = path.resolve(project);
  let building = false;
  let queued = false;
  const rebuild = async () => {
    if (building) { queued = true; return; }
    building = true;
    try {
      const { publication, theme } = await createPublication(root);
      const stage = await mkdtemp(path.join(root, ".bookforge-preview-stage-"));
      await renderWeb(publication, theme, stage);
      const target = path.join(root, ".bookforge-preview");
      const previous = path.join(root, ".bookforge-preview-previous");
      await rm(previous, { recursive: true, force: true });
      await rename(target, previous).catch(() => undefined);
      await rename(stage, target);
      await rm(previous, { recursive: true, force: true });
      console.log(`[bookforge] rebuilt ${new Date().toLocaleTimeString()}`);
    }
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
