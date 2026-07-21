import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildProject } from "./build.js";
import { listBuiltInThemes } from "./theme-loader.js";

export interface ThemeContractResult {
  themeId: string;
  ok: boolean;
  message: string;
}

/** Builds a fixed edge-case manuscript against each built-in theme. */
export async function testBuiltInThemes(): Promise<ThemeContractResult[]> {
  const themes = await listBuiltInThemes();
  const results: ThemeContractResult[] = [];
  for (const theme of themes) {
    const root = await mkdtemp(path.join(tmpdir(), `bookforge-theme-contract-${theme.id}-`));
    try {
      await mkdir(path.join(root, "chapters"), { recursive: true });
      await writeFile(path.join(root, "chapters", "01.md"), [
        "# Opening",
        "",
        "A first paragraph with a footnote.[^1]",
        "",
        "---",
        "",
        "After the breath between scenes.",
        "",
        "```",
        "code fence",
        "```",
        "",
        "[^1]: A note.",
        "",
      ].join("\n"));
      await writeFile(path.join(root, "book.yaml"), [
        "schema: 1",
        `id: contract-${theme.id}`,
        `title: Contract ${theme.name}`,
        "authors:",
        "  - name: Theme Contract",
        `theme: ${theme.id}`,
        "chapters:",
        "  - id: opening",
        "    path: chapters/01.md",
        "    layout: prose",
        "outputs:",
        "  web: {}",
        "  epub: {}",
        "",
      ].join("\n"));
      await buildProject(root, ["web", "epub"]);
      results.push({ themeId: theme.id, ok: true, message: "passed web+epub contract build" });
    } catch (error) {
      results.push({
        themeId: theme.id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  return results;
}
