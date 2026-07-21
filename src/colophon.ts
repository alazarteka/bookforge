import type { BookConfig, Publication, PublicationTheme, PrintProfile, Section } from "./model.js";
import { BOOKFORGE_VERSION } from "./util.js";

export function buildColophonSection(
  publication: Publication,
  config: BookConfig,
  theme: PublicationTheme,
  options: { printProfile?: PrintProfile; sourceHash: string },
): Section {
  const authors = publication.metadata.authors.join(", ");
  const lines = [
    `${publication.metadata.title} was set with Bookforge ${BOOKFORGE_VERSION}.`,
    `Theme: ${theme.name} (${theme.id} v${theme.version}).`,
    options.printProfile ? `Print profile: ${options.printProfile.name} (${options.printProfile.id}).` : undefined,
    `Language: ${publication.metadata.language}.`,
    `Authors: ${authors}.`,
    `Source seal: ${options.sourceHash.slice(0, 12)}.`,
  ].filter((line): line is string => Boolean(line));

  return {
    id: "colophon",
    role: "backmatter",
    title: [{ type: "text", value: "Colophon" }],
    layout: "prose",
    blocks: lines.map((line) => ({
      type: "paragraph" as const,
      children: [{ type: "text" as const, value: line }],
    })),
  };
}

export function shouldInjectColophon(config: BookConfig, publication: Publication): boolean {
  if (!config.colophon) return false;
  return !publication.spine.some((section) => section.id === "colophon");
}
