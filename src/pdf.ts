import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrintProfile, Publication, PublicationTheme } from "./model.js";
import { browserSetupMessage, resolveBrowser } from "./browser.js";
import { roleLabels, sectionArticle, sectionKickers } from "./html.js";
import { themeCss, writeThemeAssets } from "./theme-loader.js";
import { projectToolExecutable } from "./tool-paths.js";
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
  const kickers = sectionKickers(publication.spine);
  const toc = publication.spine.map((section) => `<li><a href="#${section.id}"><span class="toc-index">${escapeHtml(kickers.get(section.id) ?? "")}</span><span class="toc-title">${escapeHtml(inlineText(section.title))}</span><span class="toc-role">${escapeHtml(roleLabels[section.role])}</span></a></li>`).join("");
  const cover = profile.cover === "none" ? "" : `<section class="print-cover"><div class="print-cover-inner"><div class="sigil" aria-hidden="true"></div><p class="print-cover-label">A Bookforge edition</p><h1>${escapeHtml(publication.metadata.title)}</h1>${publication.metadata.subtitle ? `<p class="subtitle">${escapeHtml(publication.metadata.subtitle)}</p>` : ""}<p class="authors">${publication.metadata.authors.map(escapeHtml).join(" · ")}</p></div></section>`;
  const body = `${cover}<nav class="print-toc"><h1>Contents</h1><ol>${toc}</ol></nav>${publication.spine.map((section) => sectionArticle(section, publication, context, kickers.get(section.id) ?? "")).join("\n")}`;
  const html = `<!doctype html><html lang="${escapeHtml(publication.metadata.language)}" data-color="${profile.color}" data-binding="${profile.binding}"><head><meta charset="utf-8"><title>${escapeHtml(publication.metadata.title)}</title><link rel="stylesheet" href="print.css"></head><body>${body}</body></html>`;
  const inputFile = path.join(printDirectory, "index.html");
  await writeFile(inputFile, html);
  const browser = await resolveBrowser();
  if (!browser) throw new Error(browserSetupMessage());
  const vivliostyle = projectToolExecutable(path.resolve(import.meta.dirname, ".."), "vivliostyle");
  await access(vivliostyle).catch(() => { throw new Error(`Vivliostyle executable is unavailable: ${vivliostyle}. Reinstall Bookforge or set BOOKFORGE_VIVLIOSTYLE to its executable path.`); });
  const args = ["build", inputFile, "--output", outputFile, "--size", profile.page, "--timeout", "120", "--log-level", "info"];
  args.push("--executable-browser", browser.executable);
  const result = await run(vivliostyle, args, { cwd: path.resolve(import.meta.dirname, ".."), env: { NO_UPDATE_NOTIFIER: "1" } });
  if (result.code !== 0) throw new Error(`Vivliostyle PDF build failed (${result.code}):\n${result.stdout}${result.stderr}`.trim());
  await rm(printDirectory, { recursive: true, force: true });
}
