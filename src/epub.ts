import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { ZipFile } from "yazl";
import type { Publication, PublicationTheme } from "./model.js";
import { sectionArticle, sectionKickers } from "./html.js";
import { themeCss, writeThemeAssets } from "./theme-loader.js";
import { escapeXml, inlineText, sourceEpochDate } from "./util.js";
import { writeAssets } from "./assets.js";

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

function xhtml(title: string, language: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(language)}" xml:lang="${escapeXml(language)}"><head><meta charset="UTF-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head><body>${body}</body></html>`;
}

export async function renderEpub(publication: Publication, theme: PublicationTheme, outputFile: string): Promise<void> {
  const work = await mkdtemp(path.join(tmpdir(), "bookforge-epub-"));
  try {
    const epubDir = path.join(work, "EPUB");
    await mkdir(path.join(work, "META-INF"), { recursive: true });
    await mkdir(path.join(epubDir, "assets"), { recursive: true });
    await writeFile(path.join(work, "mimetype"), "application/epub+zip");
    await writeFile(path.join(work, "META-INF", "container.xml"), containerXml);
    await writeFile(path.join(epubDir, "styles.css"), themeCss(theme, "epub"));
    await writeAssets(publication.assets, path.join(epubDir, "assets"));
    await writeThemeAssets(theme, path.join(epubDir, "theme-assets"));
    const assets = new Map(publication.assets.map((asset) => [asset.id, asset]));
    const kickers = sectionKickers(publication.spine);
    const svgSections = new Set<string>();
    for (const section of publication.spine) {
      const context = { flavor: "epub" as const, assets, chapterFile: (id: string) => `${id}.xhtml`, assetPrefix: "assets/" };
      const article = sectionArticle(section, publication, context, kickers.get(section.id) ?? "");
      if (article.includes("<svg")) svgSections.add(section.id);
      await writeFile(path.join(epubDir, `${section.id}.xhtml`), xhtml(inlineText(section.title), publication.metadata.language, article));
    }
    const navItems = publication.spine.map((section) => `<li><a href="${section.id}.xhtml">${escapeXml(inlineText(section.title))}</a></li>`).join("");
    const nav = xhtml("Contents", publication.metadata.language, `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${navItems}</ol></nav><nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="bodymatter" href="${publication.spine.find((s) => s.role === "bodymatter")?.id ?? publication.spine[0]!.id}.xhtml">Begin reading</a></li></ol></nav>`);
    await writeFile(path.join(epubDir, "nav.xhtml"), nav);
    const manifestChapters = publication.spine.map((section) => `<item id="item-${section.id}" href="${section.id}.xhtml" media-type="application/xhtml+xml"${svgSections.has(section.id) ? ` properties="svg"` : ""}/>`).join("");
    const manifestAssets = publication.assets.map((asset) => `<item id="${asset.id}" href="assets/${asset.outputName}" media-type="${asset.mediaType}"/>`).join("");
    const manifestThemeAssets = theme.assets.map((asset, index) => `<item id="theme-asset-${index + 1}" href="theme-assets/${asset.outputName}" media-type="${asset.mediaType}"/>`).join("");
    const spine = publication.spine.map((section) => `<itemref idref="item-${section.id}"/>`).join("");
    const modified = sourceEpochDate().toISOString().replace(/\.\d{3}Z$/, "Z");
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${escapeXml(publication.metadata.language)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="pub-id">urn:bookforge:${escapeXml(publication.id)}</dc:identifier><dc:title>${escapeXml(publication.metadata.title)}</dc:title>${publication.metadata.subtitle ? `<dc:title id="subtitle">${escapeXml(publication.metadata.subtitle)}</dc:title><meta refines="#subtitle" property="title-type">subtitle</meta>` : ""}<dc:language>${escapeXml(publication.metadata.language)}</dc:language>${publication.metadata.authors.map((author) => `<dc:creator>${escapeXml(author)}</dc:creator>`).join("")}<meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="styles.css" media-type="text/css"/>${manifestChapters}${manifestAssets}${manifestThemeAssets}</manifest><spine>${spine}</spine></package>`;
    await writeFile(path.join(epubDir, "package.opf"), opf);
    await zipEpub(work, outputFile);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function zipEpub(root: string, outputFile: string): Promise<void> {
  const zip = new ZipFile();
  const mtime = sourceEpochDate();
  zip.addBuffer(Buffer.from("application/epub+zip"), "mimetype", { compress: false, mtime, mode: 0o100644 });
  const files = ["META-INF/container.xml", "EPUB/package.opf", "EPUB/nav.xhtml", "EPUB/styles.css"];
  const entries = await import("node:fs/promises").then(async ({ readdir }) => {
    const epubFiles = await readdir(path.join(root, "EPUB"), { recursive: true });
    return epubFiles.filter((entry) => typeof entry === "string" && !files.includes(`EPUB/${entry}`)).map((entry) => `EPUB/${entry}`).sort();
  });
  for (const name of [...files, ...entries]) {
    const full = path.join(root, name);
    const data = await readFile(full).catch(() => undefined);
    if (data) zip.addBuffer(data, name, { mtime, mode: 0o100644 });
  }
  await mkdir(path.dirname(outputFile), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(outputFile)).on("close", resolve).on("error", reject);
    zip.end();
  });
}
