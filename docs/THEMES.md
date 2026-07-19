# Theme Authoring

Bookforge themes control presentation while Bookforge retains ownership of the
semantic HTML/XHTML structures. A theme can be built into Bookforge or placed
inside an individual book project.

## Built-in themes

Set `theme: <id>` in `book.yaml`. Each bundles its own OFL fonts and renders
across web, EPUB, and print.

Discover the bundled options without opening the source tree:

```sh
bookforge themes                 # id, name, and version for every built-in theme
bookforge themes show meridian   # its style files and packaged assets
```

| id | Character |
| --- | --- |
| `classic` | Warm literary letterpress — sepia paper, Source Serif 4, copper accent, drop cap (default) |
| `meridian` | Engineer's manual — cool gridded sans-first (IBM Plex), signal-blue, crosshair sigil, first-class tables |
| `caesura` | A quiet room for poetry — bone paper, EB Garamond + Cormorant, hanging-indent verse, whitespace scene break |
| `riso-club` | Two-ink risograph zine — blue body text + fluorescent coral, Archivo Expanded, misregistration shadow |
| `lyceum` | Scholarly apparatus — STIX Two + Alegreya Sans, oxblood, numbered headings, small-caps versal opener |
| `acorn` | Early-reader / read-aloud — Andika + Baloo 2, round, leaf-green + marigold, big touch targets, lamplight night |

Resolution order for `theme: my-theme` is:

1. `<book>/theme/theme.yaml`, when that manifest declares `my-theme`
2. `<book>/themes/my-theme/theme.yaml`
3. Bookforge's built-in `themes/my-theme/theme.yaml`

Project themes therefore override built-ins without modifying Bookforge.

## Trying themes without changing a book

Use `--theme <id>` to override the configured theme for one build or live
preview. The override is never written back to `book.yaml`; a normal command
without `--theme` still uses the configured theme.

An overridden build whose theme differs from `book.yaml` leaves `dist/` with a
theme-mismatched manifest, so `bookforge check` rejects it. Prefer `preview
--theme <id>` for temporary inspection, then run an ordinary build with the
configured theme before `check`.

```sh
bookforge build . --format web --theme meridian
bookforge preview . --theme riso-club
```

For a side-by-side decision, generate static web previews for every built-in
theme in one pass:

```sh
bookforge themes preview .
```

This parses the manuscript once, writes an index plus one self-contained web
edition per built-in theme to `.bookforge-theme-previews/`, and replaces that
directory atomically only after all previews succeed. It does not change
`book.yaml`, `.bookforge-preview/`, or `dist/`; open its `index.html` to
compare the editions.

## Theme package

```text
theme/
  theme.yaml
  tokens.css
  body.css
  web.css
  epub.css
  print.css
  cover.css
  assets/
```

```yaml
schema: 1
id: my-theme
name: My Theme
version: 1.0.0
styles:
  tokens: tokens.css
  body: body.css
  web: web.css
  epub: epub.css
  print: print.css
  cover: cover.css
assets:
  - assets/body.woff2
  - assets/ornament.png
```

The six style files are required, although a file may be empty. Bookforge
assembles them in this order:

- Web: `tokens.css`, `body.css`, `web.css`
- EPUB: `tokens.css`, `body.css`, `epub.css`
- PDF: `tokens.css`, `body.css`, `print.css`, `cover.css`

Theme assets must be explicitly declared, have unique portable filenames, and
use WOFF/WOFF2, OTF/TTF, PNG, JPEG, WebP, or GIF. CSS refers to them as
`theme-assets/<filename>`; Bookforge copies and packages them for every output.

For safety and reproducibility, themes cannot use `@import`, remote URLs, data
URLs, executable URLs, undeclared files, absolute paths, or paths outside the
theme directory. The exact manifest, CSS, and asset contents produce the theme
hash recorded in `build-manifest.json`.

The complete built-in example is [the Classic theme](../themes/classic/theme.yaml).

## Stable semantic selectors

Version 0.1 themes may style these Bookforge-owned structures:

- `.cover`, `.cover-inner`, `.cover-label`, `.authors`, `.sigil`
- `.toc`
- `.reader-bar`, `.reading-progress`, `.chapter-nav`
- `.chapter`, `.chapter-header`, `.chapter-kicker`, `.prose`
- `.scene-break`, `.footnote-ref`, `.footnotes`
- `.print-cover`, `.print-cover-inner`, `.print-cover-label`, `.print-toc`

Themes do not provide arbitrary HTML templates in version 0.1. This preserves
escaping, accessibility, EPUB conformance, and cross-format structure.
