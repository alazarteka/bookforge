import path from "node:path";
import type { Publication, Section } from "./model.js";
import { visitBlocks, visitPublication, visitSection } from "./traversal.js";

export function normalizedProjectPath(root: string, value: string): string {
  return path.relative(root, path.resolve(root, value)).replaceAll("\\", "/");
}

export function headingTargets(section: Section): Map<string, string> {
  const targets = new Map<string, string>();
  const register = (id: string) => {
    const prefix = `${section.id}--`;
    targets.set(id, id);
    if (id.startsWith(prefix)) targets.set(id.slice(prefix.length), id);
  };
  if (section.titleAnchor) register(section.titleAnchor);
  targets.set(section.id, section.id);
  visitBlocks(section.blocks, {
    block: (block) => {
      if (block.type === "heading") register(block.id);
    },
  });
  return targets;
}

export function rewriteChapterLinks(
  publication: Publication,
  projectRoot: string,
  chapters: Array<{ id: string; path: string }>,
): void {
  const chapterPaths = new Map(chapters.map((chapter) => [normalizedProjectPath(projectRoot, chapter.path), chapter.id]));
  const headings = new Map(publication.spine.map((section) => [section.id, headingTargets(section)]));
  const resolveFragment = (sectionId: string, fragment: string, href: string): string => {
    const target = headings.get(sectionId)?.get(fragment);
    if (!target) throw new Error(`Broken heading link: ${href}`);
    return target;
  };
  visitPublication(publication, {
    inline: (inline, context) => {
      if (inline.type !== "link") return;
      const sectionId = context.section?.id;
      if (!sectionId) throw new Error("Link traversal requires a publication section");
      const [file, fragment] = inline.href.split("#", 2);
      if (!file && fragment) inline.href = `#${resolveFragment(sectionId, fragment, inline.href)}`;
      else if (file && /\.md$/i.test(file)) {
        const targetId = chapterPaths.get(normalizedProjectPath(projectRoot, file));
        if (!targetId) throw new Error(`Broken chapter link: ${inline.href}`);
        const targetFragment = fragment ? `#${resolveFragment(targetId, fragment, inline.href)}` : "";
        inline.href = `${targetId}.md${targetFragment}`;
      }
    },
  }, { includeTitles: true });
}

export function collectLinkIssues(
  root: string,
  sections: Array<{ chapter: { id: string; path: string }; section: Section }>,
  chapters: Array<{ id: string; path: string }> = sections.map(({ chapter }) => chapter),
): Array<{ file: string; message: string }> {
  const issues: Array<{ file: string; message: string }> = [];
  const byPath = new Map(chapters.map((chapter) => [normalizedProjectPath(root, chapter.path), chapter.id]));
  const headings = new Map(sections.map(({ section }) => [section.id, headingTargets(section)]));
  for (const { chapter, section } of sections) {
    visitSection(section, {
      inline: (inline) => {
        if (inline.type !== "link") return;
        const [file, fragment] = inline.href.split("#", 2);
        let target = section.id;
        if (file && /\.md$/i.test(file)) {
          target = byPath.get(normalizedProjectPath(root, file)) ?? "";
          if (!target) {
            issues.push({ file: chapter.path, message: `Broken chapter link "${inline.href}". Add that chapter to book.yaml or correct the link.` });
            return;
          }
        }
        if (fragment && (!file || /\.md$/i.test(file)) && headings.has(target) && !headings.get(target)?.has(fragment)) {
          issues.push({ file: chapter.path, message: `Broken heading link "${inline.href}". Use a heading id that exists in the target chapter.` });
        }
      },
    }, { includeTitles: true });
  }
  return issues;
}
