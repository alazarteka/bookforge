import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { BookConfig } from "./model.js";
import { containedPath, ensureFile } from "./util.js";

const identifier = z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/, "must be a lowercase stable identifier");
const emptyObject = z.object({}).strict();
const chapterSchema = z.object({
  id: identifier,
  path: z.string().min(1),
  role: z.enum(["frontmatter", "bodymatter", "backmatter", "part"]).default("bodymatter"),
  title: z.string().min(1).optional(),
}).strict();

export const bookConfigSchema = z.object({
  schema: z.literal(1),
  id: identifier,
  title: z.string().min(1),
  subtitle: z.string().min(1).optional(),
  language: z.string().min(2).default("en"),
  authors: z.array(z.object({ name: z.string().min(1) }).strict()).min(1),
  theme: z.string().min(1).default("classic"),
  cover: z.object({ path: z.string().min(1), alt: z.string().min(1) }).strict().optional(),
  chapters: z.array(chapterSchema).min(1),
  outputs: z.object({
    web: z.object({ reading: z.enum(["paged", "continuous"]).default("paged") }).strict().optional(),
    epub: emptyObject.optional(),
    pdf: z.object({ profile: identifier.optional(), page: z.string().min(1).optional(), margins: z.string().min(1).optional() }).strict().optional(),
  }).strict().refine((outputs) => Object.keys(outputs).length > 0, "at least one output is required"),
}).strict();

export async function loadConfig(projectRoot: string): Promise<BookConfig> {
  const configPath = path.join(projectRoot, "book.yaml");
  await ensureFile(configPath, "Book manifest");
  const parsed: unknown = YAML.parse(await readFile(configPath, "utf8"), { strict: true, uniqueKeys: true });
  const config = bookConfigSchema.parse(parsed) as BookConfig;
  const ids = new Set<string>();
  for (const chapter of config.chapters) {
    if (ids.has(chapter.id)) throw new Error(`Duplicate chapter id: ${chapter.id}`);
    ids.add(chapter.id);
    await ensureFile(containedPath(projectRoot, chapter.path), `Chapter ${chapter.id}`);
    if (!chapter.path.toLowerCase().endsWith(".md")) throw new Error(`Chapter must be Markdown: ${chapter.path}`);
  }
  if (config.cover) await ensureFile(containedPath(projectRoot, config.cover.path), "Cover image");
  return config;
}
