import path from "node:path";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import type { Asset, Publication } from "./model.js";
import { IMAGE_EXTENSIONS, mediaTypeFor } from "./media-types.js";
import { visitPublication } from "./traversal.js";
import { containedPath, defaultConcurrency, ensureFile, fileHash, mapPool, sha256 } from "./util.js";

/** Content-hash keyed encode jobs so web/EPUB/PDF share one sharp pass per image. */
const encodedAssetJobs = new Map<string, Promise<string>>();
let encodedAssetDirectory: Promise<string> | undefined;

async function encodedCacheDirectory(): Promise<string> {
  if (!encodedAssetDirectory) {
    encodedAssetDirectory = (async () => {
      const directory = path.join(tmpdir(), "bookforge-encoded-assets");
      await mkdir(directory, { recursive: true });
      return directory;
    })();
  }
  return encodedAssetDirectory;
}

export async function collectAssets(publication: Publication, projectRoot: string): Promise<void> {
  const refs: Array<{ src: string; assign: (id: string) => void }> = [];
  visitPublication(publication, {
    inline: (inline) => {
      if (inline.type === "image") refs.push({ src: inline.src, assign: (assetId) => { inline.assetId = assetId; } });
    },
  });
  const known = new Map<string, Asset>();
  const uniqueSources = new Map<string, { src: string; sourcePath: string; extension: string; mediaType: string }>();
  for (const ref of refs) {
    const sourcePath = containedPath(projectRoot, ref.src);
    const extension = path.extname(sourcePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) throw new Error(`Unsupported image format: ${ref.src}`);
    const mediaType = mediaTypeFor(extension);
    if (!mediaType) throw new Error(`Unsupported image format: ${ref.src}`);
    if (!uniqueSources.has(sourcePath)) uniqueSources.set(sourcePath, { src: ref.src, sourcePath, extension, mediaType });
  }
  const collected = await mapPool([...uniqueSources.values()], defaultConcurrency(), async (entry) => {
    await ensureFile(entry.sourcePath, "Image asset");
    const hash = await fileHash(entry.sourcePath);
    const safeName = path.basename(entry.sourcePath, entry.extension).replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
    return {
      id: `asset-${sha256(entry.src).slice(0, 12)}`,
      sourcePath: entry.sourcePath,
      outputName: `${hash.slice(0, 12)}-${safeName}${entry.extension}`,
      mediaType: entry.mediaType,
      hash,
    } satisfies Asset;
  });
  for (const asset of collected) {
    known.set(asset.sourcePath, asset);
    publication.assets.push(asset);
  }
  for (const ref of refs) {
    const sourcePath = containedPath(projectRoot, ref.src);
    const asset = known.get(sourcePath);
    if (!asset) throw new Error(`Missing collected asset for ${ref.src}`);
    ref.assign(asset.id);
  }
}

function encodeAsset(asset: Asset): Promise<string> {
  const extension = path.extname(asset.outputName).toLowerCase() || path.extname(asset.sourcePath).toLowerCase();
  const cacheKey = `${asset.hash}${extension}`;
  let job = encodedAssetJobs.get(cacheKey);
  if (!job) {
    job = (async () => {
      const directory = await encodedCacheDirectory();
      const cached = path.join(directory, cacheKey);
      // Reuse complete on-disk encodes across process runs; content-hash names keep this safe.
      const existing = await stat(cached).catch(() => undefined);
      if (existing?.isFile() && existing.size > 0) return cached;
      // Encode to a temp path then rename so interrupted writes are never reused.
      const staging = path.join(directory, `.${cacheKey}.${process.pid}.${Date.now()}.tmp`);
      try {
        await sharp(asset.sourcePath, { animated: asset.mediaType === "image/gif" }).rotate().toFile(staging);
        await rename(staging, cached);
      } catch (error) {
        await rm(staging, { force: true }).catch(() => undefined);
        throw error;
      }
      return cached;
    })().catch((error) => {
      encodedAssetJobs.delete(cacheKey);
      throw error;
    });
    encodedAssetJobs.set(cacheKey, job);
  }
  return job;
}

export async function writeAssets(assets: Asset[], directory: string): Promise<void> {
  if (!assets.length) return;
  await mkdir(directory, { recursive: true });
  await mapPool(assets, defaultConcurrency(4), async (asset) => {
    const target = path.join(directory, asset.outputName);
    await copyFile(await encodeAsset(asset), target);
  });
}
