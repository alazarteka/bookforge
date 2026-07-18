import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Publication, PublicationTheme } from "./model.js";
import { sectionArticle } from "./html.js";
import { themeCss, writeThemeAssets } from "./theme-loader.js";
import { escapeHtml, inlineText } from "./util.js";
import { writeAssets } from "./assets.js";

const readerJs = `
(() => {
  const root = document.documentElement;
  let saved = {}; try { saved = JSON.parse(localStorage.getItem("bookforge-reader") || "{}"); } catch {}
  root.dataset.theme = saved.theme || "sepia";
  if (saved.size) root.style.fontSize = saved.size + "px";
  if (saved.width) root.style.setProperty("--measure", saved.width + "rem");
  const measure = () => parseFloat(getComputedStyle(root).getPropertyValue("--measure"));
  const persist = () => localStorage.setItem("bookforge-reader", JSON.stringify({ theme: root.dataset.theme, size: parseFloat(getComputedStyle(root).fontSize), width: measure() }));
  const swatches = [...document.querySelectorAll("[data-theme-set]")];
  const syncTheme = () => swatches.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeSet === root.dataset.theme)));
  swatches.forEach(b => b.addEventListener("click", () => { root.dataset.theme = b.dataset.themeSet; syncTheme(); persist(); }));
  syncTheme();
  const widthButton = document.querySelector("[data-width]");
  const syncWidth = () => widthButton?.setAttribute("aria-pressed", String(measure() >= 48));
  widthButton?.addEventListener("click", () => { root.style.setProperty("--measure", (measure() >= 48 ? 42 : 50) + "rem"); syncWidth(); persist(); });
  syncWidth();
  document.querySelector("[data-size-down]")?.addEventListener("click", () => { root.style.fontSize = Math.max(14, parseFloat(getComputedStyle(root).fontSize) - 1) + "px"; persist(); });
  document.querySelector("[data-size-up]")?.addEventListener("click", () => { root.style.fontSize = Math.min(24, parseFloat(getComputedStyle(root).fontSize) + 1) + "px"; persist(); });
  const progress = document.querySelector(".reading-progress");
  const update = () => { const max = document.documentElement.scrollHeight - innerHeight; const value = max > 0 ? scrollY / max * 100 : 0; progress?.style.setProperty("--progress", value + "%"); localStorage.setItem("bookforge-position:" + location.pathname, String(scrollY)); };
  addEventListener("scroll", update, { passive: true }); update();
  const last = Number(localStorage.getItem("bookforge-position:" + location.pathname)); if (last > 0) scrollTo(0, last);
})();`;

function bar(publication: Publication): string {
  const swatch = (id: string, label: string) =>
    `<button class="swatch" type="button" data-theme-set="${id}" aria-pressed="false" aria-label="${label} theme"><span class="sw sw-${id}" aria-hidden="true"></span></button>`;
  const widthIcon = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 5v14M21 5v14M8 12h8M8 12l2.3-2.5M8 12l2.3 2.5M16 12l-2.3-2.5M16 12l-2.3 2.5"/></svg>`;
  return `<div class="reading-progress" aria-hidden="true"></div><nav class="reader-bar" aria-label="Reader controls"><a class="brand" href="../index.html">Bookforge <span>· ${escapeHtml(publication.metadata.title)}</span></a><div class="tools"><div class="seg" role="group" aria-label="Text size"><button class="sizer sm" type="button" data-size-down aria-label="Decrease text size">A</button><button class="sizer lg" type="button" data-size-up aria-label="Increase text size">A</button></div><button class="width" type="button" data-width aria-pressed="false" aria-label="Toggle wide reading width">${widthIcon}</button><div class="seg themes" role="group" aria-label="Color theme">${swatch("sepia", "Sepia")}${swatch("light", "Light")}${swatch("night", "Night")}</div></div></nav>`;
}

function documentShell(title: string, language: string, body: string, cssHref: string, scriptHref?: string): string {
  return `<!doctype html><html lang="${escapeHtml(language)}" data-theme="sepia"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)}</title><script>(()=>{const root=document.documentElement;let saved={};try{saved=JSON.parse(localStorage.getItem("bookforge-reader")||"{}")}catch{}root.dataset.theme=saved.theme||"sepia";if(saved.size)root.style.fontSize=saved.size+"px";if(saved.width)root.style.setProperty("--measure",saved.width+"rem")})();</script><link rel="stylesheet" href="${cssHref}"></head><body>${body}${scriptHref ? `<script src="${scriptHref}"></script>` : ""}</body></html>`;
}

export async function renderWeb(publication: Publication, theme: PublicationTheme, directory: string): Promise<void> {
  const chaptersDirectory = path.join(directory, "chapters");
  await mkdir(chaptersDirectory, { recursive: true });
  await writeFile(path.join(directory, "reader.css"), themeCss(theme, "web"));
  await writeFile(path.join(directory, "reader.js"), readerJs);
  await writeThemeAssets(theme, path.join(directory, "theme-assets"));
  await writeAssets(publication.assets, path.join(directory, "assets"));
  const toc = publication.spine.map((section, index) => `<li><a href="chapters/${section.id}.html"><span class="number">${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(inlineText(section.title))}</span><span class="role">${section.role}</span></a></li>`).join("");
  const cover = `<main><section class="cover"><div class="cover-inner"><div class="sigil" aria-hidden="true"></div><p class="cover-label">A Bookforge edition</p><h1>${escapeHtml(publication.metadata.title)}</h1>${publication.metadata.subtitle ? `<p class="subtitle">${escapeHtml(publication.metadata.subtitle)}</p>` : ""}<p class="authors">${publication.metadata.authors.map(escapeHtml).join(" · ")}</p></div></section><section class="toc"><h2>Contents</h2><ol>${toc}</ol></section></main>`;
  await writeFile(path.join(directory, "index.html"), documentShell(publication.metadata.title, publication.metadata.language, cover, "reader.css"));
  const assets = new Map(publication.assets.map((asset) => [asset.id, asset]));
  for (let index = 0; index < publication.spine.length; index++) {
    const section = publication.spine[index]!;
    const context = { flavor: "web" as const, assets, chapterFile: (id: string) => `${id}.html`, assetPrefix: "../assets/" };
    const previous = publication.spine[index - 1];
    const next = publication.spine[index + 1];
    const nav = `<nav class="chapter-nav" aria-label="Chapter navigation"><span>${previous ? `<a rel="prev" href="${previous.id}.html">← ${escapeHtml(inlineText(previous.title))}</a>` : ""}</span><span>${next ? `<a rel="next" href="${next.id}.html">${escapeHtml(inlineText(next.title))} →</a>` : `<a href="../index.html">Contents</a>`}</span></nav>`;
    const body = `${bar(publication)}<main>${sectionArticle(section, publication, context)}${nav}</main>`;
    await writeFile(path.join(chaptersDirectory, `${section.id}.html`), documentShell(`${inlineText(section.title)} — ${publication.metadata.title}`, publication.metadata.language, body, "../reader.css", "../reader.js"));
  }
}
