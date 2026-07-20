import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { ZipFile } from "yazl";
import type { Publication, PublicationTheme } from "./model.js";
import { coverMarkup, sectionArticle, sectionKickers } from "./html.js";
import { themeCss, writeThemeAssets } from "./theme-loader.js";
import { escapeXml, inlineText, sourceEpochDate } from "./util.js";
import { writeAssets } from "./assets.js";

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>`;

function xhtml(title: string, language: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(language)}" xml:lang="${escapeXml(language)}">
<head>
<meta charset="UTF-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>${body}</body>
</html>`;
}

function packageOpf(publication: Publication, theme: PublicationTheme, svgSections: Set<string>, modified: string): string {
  const subtitle = publication.metadata.subtitle
    ? `<dc:title id="subtitle">${escapeXml(publication.metadata.subtitle)}</dc:title><meta refines="#subtitle" property="title-type">subtitle</meta>`
    : "";
  const creators = publication.metadata.authors.map((author) => `<dc:creator>${escapeXml(author)}</dc:creator>`).join("");
  const manifestChapters = publication.spine.map((section) =>
    `<item id="item-${section.id}" href="${section.id}.xhtml" media-type="application/xhtml+xml"${svgSections.has(section.id) ? ` properties="svg"` : ""}/>`).join("");
  const manifestAssets = publication.assets.map((asset) =>
    `<item id="${asset.id}" href="assets/${asset.outputName}" media-type="${asset.mediaType}"/>`).join("");
  const manifestThemeAssets = theme.assets.map((asset, index) =>
    `<item id="theme-asset-${index + 1}" href="theme-assets/${asset.outputName}" media-type="${asset.mediaType}"/>`).join("");
  const spine = publication.spine.map((section) => `<itemref idref="item-${section.id}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${escapeXml(publication.metadata.language)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="pub-id">urn:bookforge:${escapeXml(publication.id)}</dc:identifier>
<dc:title>${escapeXml(publication.metadata.title)}</dc:title>
${subtitle}
<dc:language>${escapeXml(publication.metadata.language)}</dc:language>
${creators}
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="styles.css" media-type="text/css"/>
<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
${manifestChapters}${manifestAssets}${manifestThemeAssets}
</manifest>
<spine>
<itemref idref="cover"/>
${spine}
</spine>
</package>`;
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
    await writeFile(path.join(epubDir, "cover.xhtml"), xhtml("Cover", publication.metadata.language, coverMarkup(publication)));
    const navItems = publication.spine.map((section) => `<li><a href="${section.id}.xhtml">${escapeXml(inlineText(section.title))}</a></li>`).join("");
    const beginReading = publication.spine.find((section) => section.role === "bodymatter");
    const beginReadingLandmark = beginReading ? `<li><a epub:type="bodymatter" href="${beginReading.id}.xhtml">Begin reading</a></li>` : "";
    const navBody = `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${navItems}</ol></nav><nav epub:type="landmarks" hidden="hidden"><ol><li><a epub:type="cover" href="cover.xhtml">Cover</a></li>${beginReadingLandmark}</ol></nav>`;
    await writeFile(path.join(epubDir, "nav.xhtml"), xhtml("Contents", publication.metadata.language, navBody));
    const modified = sourceEpochDate().toISOString().replace(/\.\d{3}Z$/, "Z");
    await writeFile(path.join(epubDir, "package.opf"), packageOpf(publication, theme, svgSections, modified));
    await zipEpub(work, outputFile);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function zipEpub(root: string, outputFile: string): Promise<void> {
  const zip = new ZipFile();
  const mtime = sourceEpochDate();
  zip.addBuffer(Buffer.from("application/epub+zip"), "mimetype", { compress: false, mtime, mode: 0o100644 });
  const files = ["META-INF/container.xml", "EPUB/package.opf", "EPUB/nav.xhtml", "EPUB/styles.css"];
  const epubRoot = path.join(root, "EPUB");
  const epubFiles = await readdir(epubRoot, { recursive: true, withFileTypes: true });
  const entries = epubFiles
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const relative = path.relative(epubRoot, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/");
      return `EPUB/${relative}`;
    })
    .filter((name) => !files.includes(name))
    .sort();
  for (const name of [...files, ...entries]) {
    const data = await readFile(path.join(root, name));
    zip.addBuffer(data, name, { mtime, mode: 0o100644 });
  }
  await mkdir(path.dirname(outputFile), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(outputFile)).on("close", resolve).on("error", reject);
    zip.end();
  });
}
