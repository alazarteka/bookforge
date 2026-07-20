import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { z } from "zod";
import { bookConfigSchema } from "./config.js";
import type { ChapterLayout, ChapterStatus, Inline, Section } from "./model.js";
import { parseMarkdown } from "./pandoc.js";
import { collectLinkIssues } from "./links.js";
import { IMAGE_EXTENSIONS } from "./media-types.js";
import { visitSection } from "./traversal.js";
import { containedPath, defaultConcurrency, ensureFile, mapPool } from "./util.js";

export interface LintOptions {
  /** When true, draft chapters are lint errors. When false, drafts are ignored. */
  ship?: boolean;
}

interface UsableChapter {
  id: string;
  path: string;
  role: Section["role"];
  title?: string;
  absolute: string;
  status: ChapterStatus;
  layout: ChapterLayout;
}

export interface LintIssue { file: string; message: string }
export interface LintResult { issues: LintIssue[]; chapters: number }

/** Validates only author-maintained manuscript inputs. It never reads dist or theme files. */
export async function lintProject(project: string, options: LintOptions = {}): Promise<LintResult> {
  const root = path.resolve(project);
  const configFile = path.join(root, "book.yaml");
  const relativeConfig = "book.yaml";
  let raw: string;
  try {
    raw = await readFile(configFile, "utf8");
  } catch {
    return { issues: [{ file: relativeConfig, message: "Book manifest is missing. Create book.yaml or run `bookforge init <directory>`." }], chapters: 0 };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw, { strict: true, uniqueKeys: true });
  } catch (error) {
    return { issues: [{ file: relativeConfig, message: `Invalid YAML: ${errorMessage(error)}` }], chapters: 0 };
  }
  const configResult = bookConfigSchema.safeParse(parsed);
  if (!configResult.success) {
    return { issues: configResult.error.issues.map((issue) => ({ file: relativeConfig, message: `${issuePath(issue)}: ${issue.message}` })), chapters: 0 };
  }
  const config = configResult.data;
  const issues: LintIssue[] = [];
  const ids = new Set<string>();
  const usable: UsableChapter[] = [];

  for (const chapter of config.chapters) {
    const file = chapter.path.replaceAll("\\", "/");
    if (ids.has(chapter.id)) issues.push({ file, message: `Duplicate chapter id "${chapter.id}". Give every chapter a unique id in book.yaml.` });
    ids.add(chapter.id);
    if (!chapter.path.toLowerCase().endsWith(".md")) {
      issues.push({ file, message: "Chapter files must use the .md extension." });
      continue;
    }
    let absolute: string;
    try { absolute = containedPath(root, chapter.path); } catch (error) {
      issues.push({ file, message: `${errorMessage(error)}. Keep chapter paths inside this project.` });
      continue;
    }
    try { await ensureFile(absolute, "Chapter"); } catch {
      issues.push({ file, message: "Chapter file is missing. Update its path in book.yaml or add the file." });
      continue;
    }
    usable.push({
      id: chapter.id,
      path: file,
      role: chapter.role,
      ...(chapter.title ? { title: chapter.title } : {}),
      absolute,
      status: chapter.status,
      layout: chapter.layout,
    });
  }

  const parsedChapters = await mapPool(usable, defaultConcurrency(), async (chapter) => {
    try {
      return {
        chapter,
        section: await parseMarkdown(chapter.absolute, root, chapter.id, chapter.role, chapter.title, chapter.layout),
      };
    } catch (error) {
      issues.push({ file: chapter.path, message: withoutChapterId(errorMessage(error), chapter.id) });
      return undefined;
    }
  });
  const sections = parsedChapters.filter((entry): entry is { chapter: UsableChapter; section: Section } => Boolean(entry));
  issues.push(...collectLinkIssues(root, sections, usable));
  await lintImages(root, sections, issues);
  for (const { chapter, section } of sections) {
    if (options.ship && chapter.status === "draft") {
      issues.push({ file: chapter.path, message: 'Chapter status is "draft". Mark it ready or locked before shipping.' });
    }
    if (chapter.layout === "verse") issues.push(...lintVerseMeasure(chapter.path, section));
  }

  return { issues: sortIssues(issues), chapters: config.chapters.length };
}

/** Soft measure for poetry lines: warn when a verse line exceeds ~68 characters. */
const VERSE_LINE_LIMIT = 68;

function lintVerseMeasure(file: string, section: Section): LintIssue[] {
  const issues: LintIssue[] = [];
  visitSection(section, {
    block: (block) => {
      if (block.type !== "paragraph") return;
      const text = inlineTextFromChildren(block.children);
      for (const line of text.split(/\n/)) {
        if (line.trim().length > VERSE_LINE_LIMIT) {
          issues.push({ file, message: `Verse line exceeds ${VERSE_LINE_LIMIT} characters and may overflow the print measure: "${line.trim().slice(0, 40)}…"` });
        }
      }
    },
  }, { includeTitles: false });
  return issues;
}

function inlineTextFromChildren(children: Inline[]): string {
  return children.map((inline) => {
    if (inline.type === "text" || inline.type === "code") return inline.value;
    if (inline.type === "space") return " ";
    if (inline.type === "softBreak" || inline.type === "lineBreak") return "\n";
    if (inline.type === "emphasis" || inline.type === "strong" || inline.type === "strikeout" || inline.type === "link") {
      return inlineTextFromChildren(inline.children);
    }
    return "";
  }).join("");
}

async function lintImages(root: string, sections: Array<{ chapter: { path: string }; section: Section }>, issues: LintIssue[]): Promise<void> {
  await Promise.all(sections.map(async ({ chapter, section }) => {
    const images: Array<Extract<Inline, { type: "image" }>> = [];
    visitSection(section, { inline: (inline) => { if (inline.type === "image") images.push(inline); } }, { includeTitles: false });
    for (const image of images) {
      let file: string;
      try {
        file = containedPath(root, image.src);
      } catch (error) {
        issues.push({ file: chapter.path, message: `Image "${image.src}" cannot be used: ${errorMessage(error)}. Keep image files inside the project.` });
        continue;
      }
      try {
        await ensureFile(file, "Image asset");
      } catch {
        issues.push({ file: chapter.path, message: `Image "${image.src}" is missing. Add the file inside the project or correct the path.` });
        continue;
      }
      if (!IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
        issues.push({ file: chapter.path, message: `Unsupported image format "${image.src}". Use JPG, PNG, WebP, or GIF.` });
      }
    }
  }));
}

function issuePath(issue: z.core.$ZodIssue): string {
  return issue.path.length ? issue.path.map(String).join(".") : "manifest";
}

function withoutChapterId(message: string, id: string): string {
  return message.startsWith(`${id}: `) ? message.slice(id.length + 2) : message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").trim() : String(error);
}

function sortIssues(issues: LintIssue[]): LintIssue[] {
  return [...issues].sort((left, right) => left.file.localeCompare(right.file, "en", { numeric: true, sensitivity: "base" }) || left.message.localeCompare(right.message));
}
