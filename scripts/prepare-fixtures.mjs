import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const synthetic = path.join(root, "tests", "fixtures", "synthetic", "assets");
await mkdir(synthetic, { recursive: true });
const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
await writeFile(path.join(synthetic, "marker.png"), Buffer.from(onePixelPng, "base64"));
