import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrintProfile, Publication, PublicationTheme } from "./model.js";
import { browserSetupMessage, resolveBrowser } from "./browser.js";
import { roleLabels, sectionArticle, sectionKickers } from "./html.js";
import { themeCss, writeThemeAssets } from "./theme-loader.js";
import { projectToolExecutable } from "./tool-paths.js";
import { ensureFile, escapeHtml, inlineText, run } from "./util.js";
import { writeAssets } from "./assets.js";

export interface PdfRenderDependencies {
  resolveBrowser?: typeof resolveBrowser;
  run?: typeof run;
  vivliostyle?: string;
}

export async function renderPdf(publication: Publication, theme: PublicationTheme, profile: PrintProfile, workDirectory: string, outputFile: string, dependencies: PdfRenderDependencies = {}): Promise<void> {
  await mkdir(workDirectory, { recursive: true });
  const printDirectory = await mkdtemp(path.join(workDirectory, ".bookforge-pdf-print-"));
  await mkdir(path.dirname(outputFile), { recursive: true });
  const outputDirectory = await mkdtemp(path.join(path.dirname(outputFile), ".bookforge-pdf-output-"));
  const stagedOutput = path.join(outputDirectory, path.basename(outputFile));
  try {
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
    const browser = await (dependencies.resolveBrowser ?? resolveBrowser)();
    if (!browser) throw new Error(browserSetupMessage());
    const vivliostyle = dependencies.vivliostyle ?? projectToolExecutable(path.resolve(import.meta.dirname, ".."), "vivliostyle");
    await access(vivliostyle, constants.X_OK).catch(() => { throw new Error(`Vivliostyle executable is unavailable: ${vivliostyle}. Reinstall Bookforge or set BOOKFORGE_VIVLIOSTYLE to its executable path.`); });
    const args = ["build", inputFile, "--output", stagedOutput, "--size", profile.page, "--timeout", "120", "--log-level", "info"];
    args.push("--executable-browser", browser.executable);
    const result = await (dependencies.run ?? run)(vivliostyle, args, { cwd: path.resolve(import.meta.dirname, ".."), env: { NO_UPDATE_NOTIFIER: "1" } });
    if (result.code !== 0) throw new Error(`Vivliostyle PDF build failed (${result.code}):\n${result.stdout}${result.stderr}`.trim());
    await ensureFile(stagedOutput, "Vivliostyle PDF output");
    await rename(stagedOutput, outputFile);
  } finally {
    await Promise.all([
      rm(printDirectory, { recursive: true, force: true }),
      rm(outputDirectory, { recursive: true, force: true }),
    ]);
  }
}
