import path from "node:path";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import type { Asset, Publication } from "./model.js";
import { visitPublication } from "./traversal.js";
import { containedPath, ensureFile, fileHash, sha256 } from "./util.js";

const mediaTypes: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

export async function collectAssets(publication: Publication, projectRoot: string): Promise<void> {
  const refs: Array<{ src: string; assign: (id: string) => void }> = [];
  visitPublication(publication, {
    inline: (inline) => {
      if (inline.type === "image") refs.push({ src: inline.src, assign: (assetId) => { inline.assetId = assetId; } });
    },
  }, { includeTitles: false });
  const known = new Map<string, Asset>();
  for (const ref of refs) {
    const sourcePath = containedPath(projectRoot, ref.src);
    await ensureFile(sourcePath, "Image asset");
    const extension = path.extname(sourcePath).toLowerCase();
    const mediaType = mediaTypes[extension];
    if (!mediaType) throw new Error(`Unsupported image format: ${ref.src}`);
    let asset = known.get(sourcePath);
    if (!asset) {
      const hash = await fileHash(sourcePath);
      const safeName = path.basename(sourcePath, extension).replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
      asset = { id: `asset-${sha256(ref.src).slice(0, 12)}`, sourcePath, outputName: `${hash.slice(0, 12)}-${safeName}${extension}`, mediaType, hash };
      known.set(sourcePath, asset);
      publication.assets.push(asset);
    }
    ref.assign(asset.id);
  }
}

export async function writeAssets(assets: Asset[], directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const asset of assets) {
    const target = path.join(directory, asset.outputName);
    await sharp(asset.sourcePath, { animated: asset.mediaType === "image/gif" }).rotate().toFile(target);
  }
}
