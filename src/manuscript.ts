import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BookConfig, ChapterConfig, EditionConfig, Publication, Section } from "./model.js";
import { loadConfig } from "./config.js";
import { parseMarkdown } from "./pandoc.js";
import { rewriteChapterLinks } from "./links.js";
import { containedPath, defaultConcurrency, mapPool } from "./util.js";

export interface ManuscriptSpineOptions {
  includeDrafts?: boolean;
  editionId?: string;
  config?: BookConfig;
}

export interface ManuscriptSpine {
  publication: Publication;
  config: BookConfig;
  edition?: EditionConfig;
  /** Selected chapter configs after edition/draft filtering. */
  chapters: ChapterConfig[];
}

/** Light path for status/diff: parse chapters only (no theme or sharp). */
export async function loadManuscriptSpine(
  projectRoot: string,
  options: ManuscriptSpineOptions = {},
): Promise<ManuscriptSpine> {
  const config = options.config ?? await loadConfig(projectRoot);
  const edition = options.editionId ? requireEdition(config, options.editionId) : undefined;
  const includeDrafts = options.includeDrafts ?? false;
  const selectedChapters = selectChapters(config, edition, includeDrafts);
  const spine = await parseChapters(projectRoot, selectedChapters, edition);
  const publication: Publication = {
    schemaVersion: 1,
    id: edition ? `${config.id}--${edition.id}` : config.id,
    metadata: {
      title: edition?.title ?? config.title,
      ...((edition?.subtitle ?? config.subtitle) ? { subtitle: edition?.subtitle ?? config.subtitle } : {}),
      language: config.language,
      authors: config.authors.map((author) => author.name),
    },
    spine,
    assets: [],
  };
  rewriteChapterLinks(publication, projectRoot, selectedChapters);
  return { publication, config, chapters: selectedChapters, ...(edition ? { edition } : {}) };
}

export function requireEdition(config: BookConfig, editionId: string): EditionConfig {
  const edition = config.editions.find((entry) => entry.id === editionId);
  if (!edition) throw new Error(`Unknown edition: ${editionId}`);
  return edition;
}

export function selectChapters(config: BookConfig, edition: EditionConfig | undefined, includeDrafts: boolean): ChapterConfig[] {
  const ordered = edition?.chapters
    ? edition.chapters.map((id) => {
      const chapter = config.chapters.find((entry) => entry.id === id);
      if (!chapter) throw new Error(`Edition ${edition.id} references unknown chapter ${id}`);
      return chapter;
    })
    : config.chapters;
  return ordered.filter((chapter) => includeDrafts || chapter.status !== "draft");
}

export async function parseChaptersWithSources(
  projectRoot: string,
  selectedChapters: ChapterConfig[],
  edition: EditionConfig | undefined,
): Promise<Array<{ source: string; section: Section }>> {
  // Parse chapters concurrently; Pandoc process startup dominates multi-chapter books.
  return mapPool(selectedChapters, defaultConcurrency(), async (chapter) => {
    const relativePath = edition?.overlays?.[chapter.id] ?? chapter.path;
    const file = containedPath(projectRoot, relativePath);
    const source = await readFile(file, "utf8");
    const section = await parseMarkdown(file, projectRoot, chapter.id, chapter.role, chapter.title, chapter.layout, source);
    return { source, section };
  });
}

async function parseChapters(
  projectRoot: string,
  selectedChapters: ChapterConfig[],
  edition: EditionConfig | undefined,
): Promise<Section[]> {
  const parsed = await parseChaptersWithSources(projectRoot, selectedChapters, edition);
  return parsed.map((entry) => entry.section);
}

/** Convenience for callers that already have book.yaml bytes elsewhere. */
export async function readBookYaml(projectRoot: string): Promise<string> {
  return readFile(path.join(projectRoot, "book.yaml"), "utf8");
}
