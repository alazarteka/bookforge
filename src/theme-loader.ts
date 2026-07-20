import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { PublicationTheme, ThemeAsset } from "./model.js";
import { validateCss } from "./css-security.js";
import { THEME_ASSET_EXTENSIONS, mediaTypeFor } from "./media-types.js";
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


export interface BuiltInThemeInfo {
  id: string;
  name: string;
  version: string;
  styles: string[];
  assets: string[];
}

function bundledThemesDirectory(): string {
  return path.resolve(import.meta.dirname, "..", "themes");
}

async function readBuiltInThemeInfo(directoryName: string, bundledThemes: string): Promise<BuiltInThemeInfo | undefined> {
  const manifestFile = containedPath(bundledThemes, path.join(directoryName, "theme.yaml"));
  if (!(await stat(manifestFile).catch(() => undefined))?.isFile()) return undefined;
  const manifest = themeManifestSchema.parse(YAML.parse(await readFile(manifestFile, "utf8"), { strict: true, uniqueKeys: true }));
  if (manifest.id !== directoryName) throw new Error(`Built-in theme directory "${directoryName}" declares "${manifest.id}"`);
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    styles: Object.values(manifest.styles),
    assets: manifest.assets,
  };
}

export async function listBuiltInThemes(): Promise<BuiltInThemeInfo[]> {
  const bundledThemes = bundledThemesDirectory();
  const entries = await readdir(bundledThemes, { withFileTypes: true });
  const themes = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readBuiltInThemeInfo(entry.name, bundledThemes)));
  return themes.filter((theme): theme is BuiltInThemeInfo => theme !== undefined).sort((a, b) => a.id.localeCompare(b.id));
}

export async function inspectBuiltInTheme(id: string): Promise<BuiltInThemeInfo> {
  const info = await readBuiltInThemeInfo(id, bundledThemesDirectory());
  if (!info) throw new Error(`Theme not found: ${id}. Add theme/theme.yaml or choose an installed built-in theme.`);
  return info;
}

export async function loadBuiltInTheme(id: string): Promise<PublicationTheme> {
  const bundledThemes = bundledThemesDirectory();
  return loadThemeCandidates(id, [{ root: containedPath(bundledThemes, id), source: "built-in" }], bundledThemes);
}

export async function loadTheme(projectRoot: string, id: string): Promise<PublicationTheme> {
  const bundledThemes = bundledThemesDirectory();
  const candidates: Array<{ root: string; source: "project" | "built-in" }> = [
    { root: path.join(projectRoot, "theme"), source: "project" },
    { root: path.join(projectRoot, "themes", id), source: "project" },
    { root: containedPath(bundledThemes, id), source: "built-in" },
  ];
  return loadThemeCandidates(id, candidates, bundledThemes, projectRoot);
}

async function loadThemeCandidates(
  id: string,
  candidates: Array<{ root: string; source: "project" | "built-in" }>,
  bundledThemes: string,
  projectRoot?: string,
): Promise<PublicationTheme> {
  for (const candidate of candidates) {
    const container = candidate.source === "project" ? projectRoot : bundledThemes;
    if (!container) throw new Error("Theme resolution requires a project root");
    const manifestFile = containedPath(container, path.relative(container, path.join(candidate.root, "theme.yaml")));
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
      return [key, css, await fileHash(file), validateCss(css, `${manifest.id}/${relative}`)] as const;
    }));
    const assetNames = new Set<string>();
    const assetNameKeys = new Set<string>();
    const assets: ThemeAsset[] = [];
    for (const relative of manifest.assets) {
      const sourcePath = containedPath(candidate.root, relative);
      const info = await stat(sourcePath).catch(() => undefined);
      if (!info?.isFile()) throw new Error(`Theme asset does not exist: ${relative}`);
      const outputName = path.basename(relative);
      if (!/^[A-Za-z0-9._-]+$/.test(outputName)) throw new Error(`Theme asset filename is not portable: ${outputName}`);
      const outputNameKey = outputName.toLowerCase();
      if (assetNameKeys.has(outputNameKey)) throw new Error(`Theme assets must have unique filenames, ignoring case: ${outputName}`);
      assetNames.add(outputName);
      assetNameKeys.add(outputNameKey);
      const extension = path.extname(outputName).toLowerCase();
      if (!THEME_ASSET_EXTENSIONS.has(extension)) throw new Error(`Unsupported theme asset format: ${relative}`);
      const mediaType = mediaTypeFor(extension);
      if (!mediaType) throw new Error(`Unsupported theme asset format: ${relative}`);
      assets.push({ sourcePath, outputName, mediaType, hash: await fileHash(sourcePath) });
    }
    for (const [, , , references] of cssEntries) validateAssetReferences(references, assetNames, manifest.id);
    const css = Object.fromEntries(cssEntries.map(([key, value]) => [key, value])) as PublicationTheme["css"];
    const hash = sha256([rawManifest, ...cssEntries.map(([, , value]) => value), ...assets.map((asset) => asset.hash)].join("\0"));
    return { schema: 1, id, name: manifest.name, version: manifest.version, source: candidate.source, root: candidate.root, hash, css, assets };
  }
  throw new Error(`Theme not found: ${id}. Add theme/theme.yaml or choose an installed built-in theme.`);
}

function validateAssetReferences(references: string[], assets: Set<string>, themeId: string): void {
  for (const value of references) {
    if (value.startsWith("#")) continue;
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
