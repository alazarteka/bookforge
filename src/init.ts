import { copyFile, lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export interface InitOptions {
  fromExisting?: string;
  dryRun?: boolean;
  id?: string;
  title?: string;
  authors?: string[];
  language?: string;
}

interface ImportedChapter { source: string; relativePath: string; id: string }

/**
 * Creates a new Bookforge project. Importing always copies Markdown into a new
 * project; the supplied source directory is never renamed, edited, or deleted.
 */
export async function initProject(target: string, options: InitOptions = {}): Promise<string> {
  const root = path.resolve(target);
  if (await exists(root)) throw new Error(`Refusing to initialize an existing directory: ${root}`);

  const imported = options.fromExisting ? await discoverChapters(options.fromExisting) : [];
  const metadata = metadataFor(root, options);
  if (options.dryRun) return root;

  await mkdir(path.dirname(root), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(root), `.${path.basename(root)}.bookforge-init-`));
  try {
    await mkdir(path.join(stage, "chapters"));
    await writeFile(path.join(stage, "book.yaml"), YAML.stringify({
      schema: 1,
      ...metadata,
      theme: "classic",
      chapters: imported.length ? imported.map((chapter) => ({ id: chapter.id, path: `chapters/${chapter.relativePath}`, role: "bodymatter" })) : [{ id: "opening", path: "chapters/01-opening.md", role: "bodymatter" }],
      outputs: { web: {}, epub: {}, pdf: { profile: "screen-a5" } },
    }), { flag: "wx" });
    if (imported.length) {
      await Promise.all(imported.map(async (chapter) => {
        const destination = path.join(stage, "chapters", chapter.relativePath);
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(chapter.source, destination, 0);
      }));
    } else {
      await writeFile(path.join(stage, "chapters", "01-opening.md"), `# Opening

Begin your book here. Bookforge turns this manuscript into a browser reader,
an EPUB, and a PDF from the same semantic source.

---

This rule becomes a scene break in every format.
`, { flag: "wx" });
    }
    await rename(stage, root);
    return root;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

export async function importedChapterCount(directory: string): Promise<number> {
  return (await discoverChapters(directory)).length;
}

async function discoverChapters(directory: string): Promise<ImportedChapter[]> {
  const sourceRoot = path.resolve(directory);
  const info = await lstat(sourceRoot).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`Markdown source directory does not exist: ${sourceRoot}`);
  const files: Array<{ source: string; relativePath: string }> = [];
  await walk(sourceRoot, sourceRoot, files);
  files.sort((a, b) => naturalPathCompare(a.relativePath, b.relativePath));
  if (!files.length) throw new Error(`No Markdown chapters found in: ${sourceRoot}`);
  const seen = new Map<string, number>();
  return files.map((file) => {
    const base = stableIdentifier(file.relativePath.replace(/\.md$/i, ""));
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { ...file, id: count === 1 ? base : `${base}-${count}` };
  });
}

async function walk(root: string, directory: string, files: Array<{ source: string; relativePath: string }>): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    // Do not follow links while importing: a project should not silently absorb
    // files outside the directory the author chose.
    if (entry.isSymbolicLink()) continue;
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(root, source, files);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push({ source, relativePath: path.relative(root, source).replaceAll("\\", "/") });
  }
}

function metadataFor(root: string, options: InitOptions): { id: string; title: string; language: string; authors: Array<{ name: string }> } {
  const name = path.basename(root);
  const id = options.id ?? stableIdentifier(name);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error(`Invalid book id "${id}"; use lowercase letters, numbers, dots, underscores, or hyphens`);
  const title = options.title?.trim() || displayName(name);
  const language = options.language?.trim() || "en";
  if (!title) throw new Error("Book title must not be empty");
  if (language.length < 2) throw new Error("Language must be a language tag such as en or ko");
  const authors = (options.authors?.map((author) => author.trim()).filter(Boolean) ?? []);
  return { id, title, language, authors: authors.length ? authors.map((name) => ({ name })) : [{ name: "Unknown author" }] };
}

function stableIdentifier(value: string): string {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const id = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return id || "book";
}

function displayName(value: string): string {
  return value.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) || "My Book";
}

function naturalPathCompare(left: string, right: string): number {
  const compared = left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
  return compared || (left < right ? -1 : left > right ? 1 : 0);
}

async function exists(file: string): Promise<boolean> {
  return await lstat(file).then(() => true).catch(() => false);
}
