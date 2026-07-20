import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Publication, PublicationTheme } from "./model.js";
import { coverMarkup, roleLabels, sectionArticle, sectionKickers } from "./html.js";
import { themeCss, writeThemeAssets } from "./theme-loader.js";
import { escapeHtml, inlineText } from "./util.js";
import { writeAssets } from "./assets.js";

// This is emitted both before the stylesheet and in reader.js. Keeping it in one
// template prevents a malformed saved preference from making either path throw.
const readerPreferenceBootstrapJs = `
  const root = document.documentElement;
  let saved = {};
  try {
    const parsed = JSON.parse(localStorage.getItem("bookforge-reader") || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed;
  } catch {}
  root.dataset.theme = saved.theme || "sepia";
  if (saved.size) root.style.fontSize = saved.size + "px";
  if (saved.width) root.style.setProperty("--measure", saved.width + "rem");`;

export const readerJs = `
(() => {
  ${readerPreferenceBootstrapJs}
  const measure = () => parseFloat(getComputedStyle(root).getPropertyValue("--measure"));
  const persist = () => localStorage.setItem("bookforge-reader", JSON.stringify({ theme: root.dataset.theme, size: parseFloat(getComputedStyle(root).fontSize), width: measure() }));
  const swatches = [...document.querySelectorAll("[data-theme-set]")];
  const syncTheme = () => swatches.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeSet === root.dataset.theme)));
  swatches.forEach(b => b.addEventListener("click", () => { root.dataset.theme = b.dataset.themeSet; syncTheme(); persist(); }));
  syncTheme();
  const widthButton = document.querySelector("[data-width]");
  const syncWidth = () => widthButton?.setAttribute("aria-pressed", String(measure() >= 45));
  widthButton?.addEventListener("click", () => { root.style.setProperty("--measure", (measure() >= 45 ? 42 : 46) + "rem"); syncWidth(); persist(); });
  syncWidth();
  document.querySelector("[data-size-down]")?.addEventListener("click", () => { root.style.fontSize = Math.max(14, parseFloat(getComputedStyle(root).fontSize) - 1) + "px"; persist(); });
  document.querySelector("[data-size-up]")?.addEventListener("click", () => { root.style.fontSize = Math.min(24, parseFloat(getComputedStyle(root).fontSize) + 1) + "px"; persist(); });
  const progress = document.querySelector(".reading-progress");
  const positionKey = "bookforge-position:" + location.pathname;
  const last = Number(localStorage.getItem(positionKey)); if (last > 0) scrollTo(0, last);
  const update = () => { const max = document.documentElement.scrollHeight - innerHeight; const value = max > 0 ? scrollY / max * 100 : 0; progress?.style.setProperty("--progress", value + "%"); localStorage.setItem(positionKey, String(scrollY)); };
  addEventListener("scroll", update, { passive: true }); update();
})();`;

function bar(publication: Publication, opts: { home: string; contents?: string }): string {
  const swatch = (id: string, label: string) =>
    `<button class="swatch" type="button" data-theme-set="${id}" aria-pressed="false" aria-label="${label} theme"><span class="sw sw-${id}" aria-hidden="true"></span></button>`;
  const widthIcon = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 5v14M21 5v14M8 12h8M8 12l2.3-2.5M8 12l2.3 2.5M16 12l-2.3-2.5M16 12l-2.3 2.5"/></svg>`;
  const listIcon = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>`;
  const contents = opts.contents
    ? `<a class="pill contents" href="${opts.contents}" aria-label="Contents">${listIcon}</a>`
    : "";
  return `<div class="reading-progress" aria-hidden="true"></div><nav class="reader-bar" aria-label="Reader controls"><a class="brand" href="${opts.home}">Bookforge <span>· ${escapeHtml(publication.metadata.title)}</span></a><div class="tools">${contents}<div class="seg" role="group" aria-label="Text size"><button class="sizer sm" type="button" data-size-down aria-label="Decrease text size">A</button><button class="sizer lg" type="button" data-size-up aria-label="Increase text size">A</button></div><button class="pill width" type="button" data-width aria-pressed="false" aria-label="Toggle wide reading width">${widthIcon}</button><div class="seg themes" role="group" aria-label="Color theme">${swatch("sepia", "Sepia")}${swatch("light", "Light")}${swatch("night", "Night")}</div></div></nav>`;
}

function tocSection(publication: Publication, kickers: Map<string, string>, hrefFor: (id: string) => string): string {
  const rows = publication.spine.map((section) => {
    const index = kickers.get(section.id) ?? "";
    const role = roleLabels[section.role];
    return `<li><a href="${hrefFor(section.id)}"><span class="toc-index">${escapeHtml(index)}</span><span class="toc-title">${escapeHtml(inlineText(section.title))}</span><span class="toc-role">${escapeHtml(role)}</span></a></li>`;
  }).join("");
  return `<section class="toc" id="contents"><h2>Contents</h2><ol>${rows}</ol></section>`;
}

function documentShell(title: string, language: string, body: string, cssHref: string, scriptHref?: string): string {
  return `<!doctype html><html lang="${escapeHtml(language)}" data-theme="sepia"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)}</title><script>(()=>{${readerPreferenceBootstrapJs}})();</script><link rel="stylesheet" href="${cssHref}"></head><body>${body}${scriptHref ? `<script src="${scriptHref}"></script>` : ""}</body></html>`;
}

export type WebReading = "paged" | "continuous";

export async function renderWeb(publication: Publication, theme: PublicationTheme, directory: string, reading: WebReading = "paged"): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "reader.css"), themeCss(theme, "web"));
  await writeFile(path.join(directory, "reader.js"), readerJs);
  await writeThemeAssets(theme, path.join(directory, "theme-assets"));
  await writeAssets(publication.assets, path.join(directory, "assets"));
  const assets = new Map(publication.assets.map((asset) => [asset.id, asset]));
  const kickers = sectionKickers(publication.spine);

  if (reading === "continuous") {
    const context = { flavor: "web" as const, assets, chapterFile: (id: string) => `#${id}`, assetPrefix: "assets/" };
    const articles = publication.spine.map((section) => sectionArticle(section, publication, context, kickers.get(section.id) ?? "")).join("\n");
    const body = `${bar(publication, { home: "#top", contents: "#contents" })}<main class="continuous">${coverMarkup(publication)}${tocSection(publication, kickers, (id) => `#${id}`)}${articles}</main>`;
    await writeFile(path.join(directory, "index.html"), documentShell(publication.metadata.title, publication.metadata.language, body, "reader.css", "reader.js"));
    return;
  }

  const landing = `${bar(publication, { home: "#top", contents: "#contents" })}<main class="landing">${coverMarkup(publication)}${tocSection(publication, kickers, (id) => `chapters/${id}.html`)}</main>`;
  await writeFile(path.join(directory, "index.html"), documentShell(publication.metadata.title, publication.metadata.language, landing, "reader.css", "reader.js"));
  const chaptersDirectory = path.join(directory, "chapters");
  await mkdir(chaptersDirectory, { recursive: true });
  for (let index = 0; index < publication.spine.length; index++) {
    const section = publication.spine[index]!;
    const context = { flavor: "web" as const, assets, chapterFile: (id: string) => `${id}.html`, assetPrefix: "../assets/" };
    const previous = publication.spine[index - 1];
    const next = publication.spine[index + 1];
    const nav = `<nav class="chapter-nav" aria-label="Chapter navigation"><span class="prev">${previous ? `<a rel="prev" href="${previous.id}.html">← ${escapeHtml(inlineText(previous.title))}</a>` : ""}</span><span class="next">${next ? `<a rel="next" href="${next.id}.html">${escapeHtml(inlineText(next.title))} →</a>` : `<a href="../index.html">Contents ↑</a>`}</span></nav>`;
    const body = `${bar(publication, { home: "../index.html" })}<main>${sectionArticle(section, publication, context, kickers.get(section.id) ?? "")}${nav}</main>`;
    await writeFile(path.join(chaptersDirectory, `${section.id}.html`), documentShell(`${inlineText(section.title)} — ${publication.metadata.title}`, publication.metadata.language, body, "../reader.css", "../reader.js"));
  }
}
