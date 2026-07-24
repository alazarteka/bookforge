import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BookConfig, EditionConfig, Publication, PublicationTheme, Section } from "./model.js";
import { loadConfigWithSource } from "./config.js";
import { collectAssets } from "./assets.js";
import { loadTheme } from "./theme-loader.js";
import { loadPrintProfile } from "./profile-loader.js";
import { rewriteChapterLinks } from "./links.js";
import { buildColophonSection, shouldInjectColophon } from "./colophon.js";
import {
  parseChaptersWithSources,
  requireEdition,
  selectChapters,
} from "./manuscript.js";
import { sha256 } from "./util.js";

export type Format = "web" | "epub" | "pdf";

export interface CreatePublicationOptions {
  includeDrafts?: boolean;
  editionId?: string;
  injectColophon?: boolean;
  /** Preloaded config to avoid a second book.yaml parse. */
  config?: BookConfig;
  /** Raw book.yaml text used for sourceHash when already read. */
  bookYaml?: string;
}

export interface PublicationBuild {
  publication: Publication;
  config: BookConfig;
  theme: PublicationTheme;
  sourceHash: string;
  edition?: EditionConfig;
}

export async function createPublication(
  projectRoot: string,
  themeOverride?: string,
  options: CreatePublicationOptions = {},
): Promise<PublicationBuild> {
  const loaded = options.config && options.bookYaml
    ? { config: options.config, bookYaml: options.bookYaml }
    : options.config
      ? { config: options.config, bookYaml: await readFile(path.join(projectRoot, "book.yaml"), "utf8") }
      : await loadConfigWithSource(projectRoot);
  const config = loaded.config;
  const edition = options.editionId ? requireEdition(config, options.editionId) : undefined;
  const themeId = themeOverride ?? edition?.theme ?? config.theme;
  const includeDrafts = options.includeDrafts ?? false;
  const selectedChapters = selectChapters(config, edition, includeDrafts);

  const [theme, chapterSources] = await Promise.all([
    loadTheme(projectRoot, themeId),
    parseChaptersWithSources(projectRoot, selectedChapters, edition),
  ]);

  const hashes: string[] = [loaded.bookYaml, edition?.id ?? ""];
  const spine: Section[] = [];
  for (const { source, section } of chapterSources) {
    hashes.push(source);
    spine.push(section);
  }
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
  await collectAssets(publication, projectRoot);
  hashes.push(theme.hash);
  for (const asset of [...publication.assets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) hashes.push(asset.hash);
  let sourceHash = sha256(hashes.join("\n\0\n"));
  if ((options.injectColophon ?? true) && shouldInjectColophon(config, publication)) {
    const printProfile = config.outputs.pdf ? await loadPrintProfile(projectRoot, config.outputs.pdf) : undefined;
    publication.spine.push(buildColophonSection(publication, config, theme, { ...(printProfile ? { printProfile } : {}), sourceHash }));
  }
  return { publication, config, theme, sourceHash, ...(edition ? { edition } : {}) };
}
