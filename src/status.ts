import path from "node:path";
import { createPublication } from "./build.js";
import { loadConfig } from "./config.js";
import type { Section } from "./model.js";
import { visitSection } from "./traversal.js";
import { inlineText } from "./util.js";

export interface ChapterPulse {
  id: string;
  title: string;
  role: string;
  status: string;
  layout: string;
  words: number;
  readingMinutes: number;
  sceneBreaks: number;
}

export interface ManuscriptPulse {
  id: string;
  title: string;
  words: number;
  readingMinutes: number;
  chapters: ChapterPulse[];
  drafts: number;
  ready: number;
  locked: number;
}

/** Approximate adult silent reading pace used for manuscript pulse estimates. */
const WORDS_PER_MINUTE = 238;

export async function statusProject(project: string): Promise<ManuscriptPulse> {
  const root = path.resolve(project);
  const config = await loadConfig(root);
  const { publication } = await createPublication(root, undefined, { includeDrafts: true, injectColophon: false });
  const byId = new Map(config.chapters.map((chapter) => [chapter.id, chapter]));
  const chapters: ChapterPulse[] = publication.spine.map((section) => {
    const words = countWords(section);
    const chapter = byId.get(section.id);
    return {
      id: section.id,
      title: inlineText(section.title),
      role: section.role,
      status: chapter?.status ?? "ready",
      layout: section.layout,
      words,
      readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
      sceneBreaks: countSceneBreaks(section),
    };
  });
  const words = chapters.reduce((sum, chapter) => sum + chapter.words, 0);
  return {
    id: config.id,
    title: config.title,
    words,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    chapters,
    drafts: chapters.filter((chapter) => chapter.status === "draft").length,
    ready: chapters.filter((chapter) => chapter.status === "ready").length,
    locked: chapters.filter((chapter) => chapter.status === "locked").length,
  };
}

export function formatPulse(pulse: ManuscriptPulse): string {
  const lines = [
    `${pulse.title} (${pulse.id})`,
    `${pulse.words} words · ~${pulse.readingMinutes} min · ${pulse.chapters.length} chapters (${pulse.drafts} draft, ${pulse.ready} ready, ${pulse.locked} locked)`,
    "",
    "id\tstatus\twords\tmin\tscene\ttitle",
  ];
  const maxWords = Math.max(1, ...pulse.chapters.map((chapter) => chapter.words));
  for (const chapter of pulse.chapters) {
    const bar = sparkline(chapter.words, maxWords);
    lines.push(`${chapter.id}\t${chapter.status}\t${chapter.words}\t${chapter.readingMinutes}\t${chapter.sceneBreaks}\t${bar} ${chapter.title}`);
  }
  return `${lines.join("\n")}\n`;
}

function sparkline(value: number, max: number): string {
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const index = value <= 0 ? 0 : Math.min(blocks.length - 1, Math.round((value / max) * (blocks.length - 1)));
  return blocks[index] ?? "▁";
}

function countWords(section: Section): number {
  let words = 0;
  visitSection(section, {
    inline: (inline) => {
      if (inline.type === "text" || inline.type === "code") {
        const trimmed = inline.value.trim();
        if (trimmed) words += trimmed.split(/\s+/).filter(Boolean).length;
      }
    },
  }, { includeTitles: true });
  return words;
}

function countSceneBreaks(section: Section): number {
  let count = 0;
  visitSection(section, {
    block: (block) => { if (block.type === "sceneBreak") count += 1; },
  }, { includeTitles: false });
  return count;
}
