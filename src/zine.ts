import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrintProfile, Publication } from "./model.js";
import { escapeHtml } from "./util.js";

/** Writes a home-printer fold-and-staple guide when a booklet imposition profile is used. */
export async function writeZineGuide(stage: string, publication: Publication, profile: PrintProfile): Promise<void> {
  const dir = path.join(stage, "print");
  await mkdir(dir, { recursive: true });
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Zine night kit — ${escapeHtml(publication.metadata.title)}</title>
<style>
  body { margin: 2rem auto; max-width: 36rem; font: 1rem/1.55 Georgia, serif; color: #222; }
  h1 { font-weight: 600; font-size: 1.6rem; }
  ol { padding-left: 1.2rem; }
  code { font: .9em/1.4 ui-monospace, monospace; }
</style>
</head>
<body>
<h1>Zine night kit</h1>
<p><strong>${escapeHtml(publication.metadata.title)}</strong> is ready for a home-printer booklet using profile <code>${escapeHtml(profile.id)}</code> (${escapeHtml(profile.page)}).</p>
<p>Bookforge does not rewrite PDF page order for commercial imposition. Use this ritual instead:</p>
<ol>
  <li>Open <code>book.pdf</code>.</li>
  <li>Print as a booklet / booklet-fold if your printer driver offers it; otherwise print single-sided, fold in half, and nest signatures.</li>
  <li>Staple along the fold. Trim only if you mean to.</li>
  <li>Keep <code>release-seal.json</code> with the copy you give away.</li>
</ol>
<p>Page geometry: ${escapeHtml(profile.page)}; margins ${escapeHtml(profile.margins)}; binding ${escapeHtml(profile.binding)}.</p>
</body>
</html>
`;
  await writeFile(path.join(dir, "zine-guide.html"), html);
  await writeFile(path.join(dir, "fold-and-staple.txt"), [
    `Zine night kit — ${publication.metadata.title}`,
    "",
    `Profile: ${profile.id} (${profile.page})`,
    "1. Print book.pdf as a booklet if your driver supports it.",
    "2. Otherwise print, fold in half, nest, and staple the spine.",
    "3. Keep release-seal.json with gifted copies.",
    "",
  ].join("\n"));
}
