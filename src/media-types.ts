import path from "node:path";

export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export const THEME_ASSET_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ".woff2",
  ".woff",
  ".otf",
  ".ttf",
]);

const mediaTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

export function mediaTypeFor(extension: string): string | undefined {
  return mediaTypes[extension.toLowerCase()];
}

export function contentTypeFor(file: string): string {
  return mediaTypes[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}
