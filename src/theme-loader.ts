import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { PublicationTheme, ThemeAsset } from "./model.js";
import { containedPath, fileHash, sha256 } from "./util.js";

const themeManifestSchema = z.object({
  schema: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  styles: z.object({
    tokens: z.string().min(1), body: z.string().min(1), web: z.string().min(1),
    epub: z.string().min(1), print: z.string().min(1), cover: z.string().min(1),
  }).strict(),
  assets: z.array(z.string().min(1)).default([]),
}).strict();

const mediaTypes: Record<string, string> = {
  ".woff2": "font/woff2", ".woff": "font/woff", ".otf": "font/otf", ".ttf": "font/ttf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
};

export async function loadTheme(projectRoot: string, id: string): Promise<PublicationTheme> {
  const candidates: Array<{ root: string; source: "project" | "built-in" }> = [
    { root: path.join(projectRoot, "theme"), source: "project" },
    { root: path.join(projectRoot, "themes", id), source: "project" },
    { root: path.resolve(import.meta.dirname, "..", "themes", id), source: "built-in" },
  ];
  for (const candidate of candidates) {
    const manifestFile = path.join(candidate.root, "theme.yaml");
    if (!(await stat(manifestFile).catch(() => undefined))?.isFile()) continue;
    const rawManifest = await readFile(manifestFile, "utf8");
    const manifest = themeManifestSchema.parse(YAML.parse(rawManifest, { strict: true, uniqueKeys: true }));
    if (manifest.id !== id) {
      if (candidate.source === "project" && candidate.root.endsWith(`${path.sep}theme`)) continue;
      throw new Error(`Theme directory requested "${id}" but declares "${manifest.id}"`);
    }
    const cssEntries = await Promise.all(Object.entries(manifest.styles).map(async ([key, relative]) => {
      const file = containedPath(candidate.root, relative);
      const css = await readFile(file, "utf8");
      validateCss(css, `${manifest.id}/${relative}`);
      return [key, css, await fileHash(file)] as const;
    }));
    const assetNames = new Set<string>();
    const assets: ThemeAsset[] = [];
    for (const relative of manifest.assets) {
      const sourcePath = containedPath(candidate.root, relative);
      const info = await stat(sourcePath).catch(() => undefined);
      if (!info?.isFile()) throw new Error(`Theme asset does not exist: ${relative}`);
      const outputName = path.basename(relative);
      if (!/^[A-Za-z0-9._-]+$/.test(outputName)) throw new Error(`Theme asset filename is not portable: ${outputName}`);
      if (assetNames.has(outputName)) throw new Error(`Theme assets must have unique filenames: ${outputName}`);
      assetNames.add(outputName);
      const mediaType = mediaTypes[path.extname(outputName).toLowerCase()];
      if (!mediaType) throw new Error(`Unsupported theme asset format: ${relative}`);
      assets.push({ sourcePath, outputName, mediaType, hash: await fileHash(sourcePath) });
    }
    for (const [, css] of cssEntries) validateAssetReferences(css, assetNames, manifest.id);
    const css = Object.fromEntries(cssEntries.map(([key, value]) => [key, value])) as PublicationTheme["css"];
    const hash = sha256([rawManifest, ...cssEntries.map(([, , value]) => value), ...assets.map((asset) => asset.hash)].join("\0"));
    return { schema: 1, id, name: manifest.name, version: manifest.version, source: candidate.source, root: candidate.root, hash, css, assets };
  }
  throw new Error(`Theme not found: ${id}. Add theme/theme.yaml or choose an installed built-in theme.`);
}

function validateCss(css: string, label: string): void {
  if (/@import\b/i.test(css)) throw new Error(`${label}: CSS @import is not allowed`);
  if (/expression\s*\(|javascript\s*:|url\s*\(\s*["']?(?:https?:|data:|\/\/)/i.test(css)) throw new Error(`${label}: remote, embedded, or executable CSS resources are not allowed`);
}

function validateAssetReferences(css: string, assets: Set<string>, themeId: string): void {
  for (const match of css.matchAll(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const value = match[1]?.trim();
    if (!value || value.startsWith("#")) continue;
    const expected = value.match(/^theme-assets\/([^/?#]+)$/)?.[1];
    if (!expected || !assets.has(expected)) throw new Error(`Theme ${themeId}: CSS asset must be declared and referenced as theme-assets/<filename>: ${value}`);
  }
}

export function themeCss(theme: PublicationTheme, flavor: "web" | "epub" | "print"): string {
  const layers = [theme.css.tokens, theme.css.body, theme.css[flavor]];
  if (flavor === "print") layers.push(theme.css.cover);
  return layers.join("\n");
}

export async function writeThemeAssets(theme: PublicationTheme, directory: string): Promise<void> {
  if (!theme.assets.length) return;
  await mkdir(directory, { recursive: true });
  for (const asset of theme.assets) await copyFile(asset.sourcePath, path.join(directory, asset.outputName));
}
