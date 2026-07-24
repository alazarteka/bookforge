import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ZipFile } from "yazl";
import { loadConfig } from "./config.js";
import { sourceEpochDate } from "./util.js";

export interface GiftOptions {
  to?: string;
  formats?: Array<"web" | "epub" | "pdf">;
  output?: string;
}

export async function giftProject(project: string, options: GiftOptions = {}): Promise<string> {
  const root = path.resolve(project);
  const config = await loadConfig(root);
  const dist = path.join(root, "dist");
  if (!(await stat(dist).catch(() => undefined))?.isDirectory()) {
    throw new Error("No dist/ build found. Run `bookforge build` before `bookforge gift`.");
  }
  const formats = options.formats ?? (Object.keys(config.outputs) as Array<"web" | "epub" | "pdf">);
  const slug = config.id.replace(/[^a-z0-9._-]+/gi, "-");
  const who = (options.to ?? "reader").replace(/[^\w.-]+/g, "-");
  const stamp = sourceEpochDate().toISOString().slice(0, 10);
  const output = path.resolve(options.output ?? path.join(root, `${slug}-for-${who}-${stamp}.zip`));
  await mkdir(path.dirname(output), { recursive: true });

  const zip = new ZipFile();
  const mtime = sourceEpochDate();
  const note = [
    `${config.title}`,
    "",
    "This gift bundle was packed by Bookforge.",
    "",
    "How to read:",
    formats.includes("web") ? "- Web: open web/index.html in a browser" : undefined,
    formats.includes("epub") ? "- EPUB: load book.epub in an ereader app" : undefined,
    formats.includes("pdf") ? "- PDF: open book.pdf" : undefined,
    "",
    options.to ? `For ${options.to}.` : "Enjoy the book.",
    "",
  ].filter((line): line is string => line !== undefined).join("\n");
  zip.addBuffer(Buffer.from(note, "utf8"), "README-for-reader.txt", { mtime, mode: 0o100644 });

  if (formats.includes("web")) await addDirectory(zip, path.join(dist, "web"), "web", mtime);
  if (formats.includes("epub")) await addFile(zip, path.join(dist, "book.epub"), "book.epub", mtime);
  if (formats.includes("pdf")) await addFile(zip, path.join(dist, "book.pdf"), "book.pdf", mtime);
  for (const name of ["build-manifest.json", "release-seal.json"]) {
    const file = path.join(dist, name);
    if ((await stat(file).catch(() => undefined))?.isFile()) await addFile(zip, file, name, mtime);
  }

  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(output)).on("close", resolve).on("error", reject);
    zip.end();
  });
  return output;
}

async function addFile(zip: ZipFile, file: string, name: string, mtime: Date): Promise<void> {
  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`Gift format artifact missing: ${name}. Rebuild with that format enabled.`);
  zip.addBuffer(await readFile(file), name, { mtime, mode: 0o100644 });
}

async function addDirectory(zip: ZipFile, directory: string, prefix: string, mtime: Date): Promise<void> {
  const info = await stat(directory).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`Gift format artifact missing: ${prefix}/. Rebuild with web enabled.`);
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .sort();
  const buffers = await Promise.all(files.map((relative) => readFile(path.join(directory, relative))));
  for (let index = 0; index < files.length; index++) {
    zip.addBuffer(buffers[index]!, `${prefix}/${files[index]!}`, { mtime, mode: 0o100644 });
  }
}
