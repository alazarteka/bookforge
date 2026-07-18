import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrintProfile, Publication, PublicationTheme } from "./model.js";
import { sectionArticle } from "./html.js";
import { themeCss, writeThemeAssets } from "./theme-loader.js";
import { escapeHtml, inlineText, run } from "./util.js";
import { writeAssets } from "./assets.js";

export async function renderPdf(publication: Publication, theme: PublicationTheme, profile: PrintProfile, workDirectory: string, outputFile: string): Promise<void> {
  const printDirectory = path.join(workDirectory, "print");
  await mkdir(printDirectory, { recursive: true });
  await writeAssets(publication.assets, path.join(printDirectory, "assets"));
  await writeThemeAssets(theme, path.join(printDirectory, "theme-assets"));
  await writeFile(path.join(printDirectory, "print.css"), `:root { --book-page: ${profile.page}; --book-margin: ${profile.margins}; --book-bleed: ${profile.bleed}; }\n${themeCss(theme, "print")}`);
  const assets = new Map(publication.assets.map((asset) => [asset.id, asset]));
  const context = { flavor: "print" as const, assets, chapterFile: (id: string) => `#${id}`, assetPrefix: "assets/" };
  const toc = publication.spine.map((section) => `<li><a href="#${section.id}">${escapeHtml(inlineText(section.title))}</a></li>`).join("");
  const cover = profile.cover === "none" ? "" : `<section class="print-cover"><div class="print-cover-inner"><p class="print-cover-label">A Bookforge edition</p><h1>${escapeHtml(publication.metadata.title)}</h1>${publication.metadata.subtitle ? `<p class="subtitle">${escapeHtml(publication.metadata.subtitle)}</p>` : ""}<p class="authors">${publication.metadata.authors.map(escapeHtml).join(" · ")}</p></div></section>`;
  const body = `${cover}<nav class="print-toc"><h1>Contents</h1><ol>${toc}</ol></nav>${publication.spine.map((section) => sectionArticle(section, publication, context)).join("\n")}`;
  const html = `<!doctype html><html lang="${escapeHtml(publication.metadata.language)}" data-color="${profile.color}" data-binding="${profile.binding}"><head><meta charset="utf-8"><title>${escapeHtml(publication.metadata.title)}</title><link rel="stylesheet" href="print.css"></head><body>${body}</body></html>`;
  const inputFile = path.join(printDirectory, "index.html");
  await writeFile(inputFile, html);
  const executable = process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "";
  const args = ["exec", "vivliostyle", "build", inputFile, "--output", outputFile, "--size", profile.page, "--timeout", "120", "--log-level", "info"];
  if (executable) args.push("--executable-browser", executable);
  const result = await run("pnpm", args, { cwd: path.resolve(import.meta.dirname, ".."), env: { NO_UPDATE_NOTIFIER: "1" } });
  if (result.code !== 0) throw new Error(`Vivliostyle PDF build failed (${result.code})`);
  await rm(printDirectory, { recursive: true, force: true });
}
