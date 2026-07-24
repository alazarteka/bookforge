import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { BookConfig } from "./model.js";
import { containedPath, defaultConcurrency, ensureFile, mapPool } from "./util.js";

const identifier = z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/, "must be a lowercase stable identifier");
const emptyObject = z.object({}).strict();
const chapterSchema = z.object({
  id: identifier,
  path: z.string().min(1),
  role: z.enum(["frontmatter", "bodymatter", "backmatter", "part"]).default("bodymatter"),
  title: z.string().min(1).optional(),
  status: z.enum(["draft", "ready", "locked"]).default("ready"),
  layout: z.enum(["prose", "verse"]).default("prose"),
}).strict();

const editionSchema = z.object({
  id: identifier,
  title: z.string().min(1).optional(),
  subtitle: z.string().min(1).optional(),
  theme: identifier.optional(),
  chapters: z.array(identifier).min(1).optional(),
  overlays: z.record(identifier, z.string().min(1)).optional(),
}).strict();

export const bookConfigSchema = z.object({
  schema: z.literal(1),
  id: identifier,
  title: z.string().min(1),
  subtitle: z.string().min(1).optional(),
  language: z.string().min(2).default("en"),
  authors: z.array(z.object({ name: z.string().min(1) }).strict()).min(1),
  theme: identifier.default("classic"),
  chapters: z.array(chapterSchema).min(1),
  colophon: z.boolean().default(false),
  editions: z.array(editionSchema).default([]),
  outputs: z.object({
    web: z.object({ reading: z.enum(["paged", "continuous"]).default("paged") }).strict().optional(),
    epub: emptyObject.optional(),
    pdf: z.object({ profile: identifier.optional(), page: z.string().min(1).optional(), margins: z.union([z.string().min(1), z.literal(0).transform(() => "0")]).optional() }).strict().optional(),
  }).strict().refine((outputs) => Object.keys(outputs).length > 0, "at least one output is required"),
}).strict().superRefine((config, ctx) => {
  const chapterIds = new Set(config.chapters.map((chapter) => chapter.id));
  const editionIds = new Set<string>();
  for (const [index, edition] of config.editions.entries()) {
    if (editionIds.has(edition.id)) {
      ctx.addIssue({ code: "custom", message: `Duplicate edition id: ${edition.id}`, path: ["editions", index, "id"] });
    }
    editionIds.add(edition.id);
    if (edition.chapters) {
      for (const [chapterIndex, chapterId] of edition.chapters.entries()) {
        if (!chapterIds.has(chapterId)) {
          ctx.addIssue({ code: "custom", message: `Unknown chapter id "${chapterId}"`, path: ["editions", index, "chapters", chapterIndex] });
        }
      }
    }
    if (edition.overlays) {
      for (const chapterId of Object.keys(edition.overlays)) {
        if (!chapterIds.has(chapterId)) {
          ctx.addIssue({ code: "custom", message: `Unknown chapter id "${chapterId}" in overlays`, path: ["editions", index, "overlays", chapterId] });
        }
      }
    }
  }
});

export async function loadConfig(projectRoot: string): Promise<BookConfig> {
  return (await loadConfigWithSource(projectRoot)).config;
}

/** Load and validate book.yaml once, returning raw text for sourceHash reuse. */
export async function loadConfigWithSource(projectRoot: string): Promise<{ config: BookConfig; bookYaml: string }> {
  const configPath = path.join(projectRoot, "book.yaml");
  await ensureFile(configPath, "Book manifest");
  const bookYaml = await readFile(configPath, "utf8");
  const parsed: unknown = YAML.parse(bookYaml, { strict: true, uniqueKeys: true });
  const config = bookConfigSchema.parse(parsed) as BookConfig;
  const ids = new Set<string>();
  for (const chapter of config.chapters) {
    if (ids.has(chapter.id)) throw new Error(`Duplicate chapter id: ${chapter.id}`);
    ids.add(chapter.id);
    if (!chapter.path.toLowerCase().endsWith(".md")) throw new Error(`Chapter must be Markdown: ${chapter.path}`);
  }
  for (const edition of config.editions) {
    for (const overlay of Object.values(edition.overlays ?? {})) {
      if (!overlay.toLowerCase().endsWith(".md")) throw new Error(`Edition overlay must be Markdown: ${overlay}`);
    }
  }
  const chapterChecks = config.chapters.map((chapter) => ({
    label: `Chapter ${chapter.id}`,
    file: containedPath(projectRoot, chapter.path),
  }));
  const overlayChecks = config.editions.flatMap((edition) =>
    Object.values(edition.overlays ?? {}).map((overlay) => ({
      label: `Edition overlay ${edition.id}`,
      file: containedPath(projectRoot, overlay),
    })));
  await mapPool([...chapterChecks, ...overlayChecks], defaultConcurrency(), async (entry) => {
    await ensureFile(entry.file, entry.label);
  });
  return { config, bookYaml };
}
