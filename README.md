# Bookforge

Bookforge turns an ordered Markdown manuscript into three polished, local-first
reading formats from one semantic source:

- A static, responsive browser reader
- A reflowable EPUB 3.3 ebook
- A paginated PDF rendered with Vivliostyle

Pandoc is used only to parse Markdown. Bookforge immediately adapts its JSON
into a small owned publication model, then applies distinct web, EPUB, and
print policies backed by one shared theme.

## Install a release

Bookforge ships as private-package GitHub Release bundles for macOS arm64,
macOS x86_64, and glibc Linux x86_64. They include no Node runtime: install
Node.js 24.18.0 plus the publishing prerequisites first, then use the verified
GitHub Release installer. See [release installation and updates](docs/RELEASES.md)
for prerequisites, checksums/provenance, managed updates, and rollback.

## Requirements

This repository is pinned to Node.js 24.18.0 and pnpm 10.26.1. It also expects
Pandoc 3.7.0.2, EPUBCheck 5.3.0, Poppler, Chrome, and the project-local
Vivliostyle 11.1.0 package.

On this Mac, use the keg-only Node 24 without altering the global Node link:

```sh
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin"
pnpm install --frozen-lockfile
pnpm run build
node lib/cli.js doctor
```

## Start a book

```sh
node lib/cli.js init ../my-book
node lib/cli.js build ../my-book
node lib/cli.js preview ../my-book
```

A project contains `book.yaml`, an ordered chapter list, and local assets. A
complete build produces:

```text
dist/
  web/
    index.html
    chapters/
    assets/
  book.epub
  book.pdf
  build-manifest.json
```

Useful commands:

```sh
node lib/cli.js build [project] --format web,epub,pdf
node lib/cli.js check [project]
node lib/cli.js doctor
pnpm test
pnpm run security:verify
```

Set `SOURCE_DATE_EPOCH` for deterministic metadata and byte-identical EPUB
archives across repeated builds on the same toolchain (pinned Node/Pandoc and
the same installed `sharp`/libvips build) and platform, since image assets
are re-encoded through `sharp` at build time. Generated publications never
require Bookforge, Node, or a web framework at reading time.

## Themes and print profiles

`theme: classic` selects the built-in design. Books may provide a complete
project-local theme under `theme/` or `themes/<id>/`; Bookforge validates and
packages its CSS and declared assets for web, EPUB, and PDF.

The web edition reads as separate chapter pages by default, or as one
continuous scroll of the whole book:

```yaml
outputs:
  web:
    reading: continuous   # or "paged" (default)
```

PDF geometry is independent from the theme:

```yaml
outputs:
  pdf:
    profile: paperback-7x10
```

Bookforge includes A5 screen/home-print, 7×10 paperback, JIS B5 paperback, and
Letter coil profiles. Theme and resolved profile hashes are recorded in every
applicable build manifest.

## Documentation

- [Project scope](docs/SCOPE.md)
- [Supported Markdown](docs/MARKDOWN.md)
- [Theme authoring](docs/THEMES.md)
- [Print profiles](docs/PRINT_PROFILES.md)
- [Dependency security](docs/SECURITY.md)
- [Machine setup](docs/MACHINE_SETUP.md)
- [Release installation and compatibility](docs/RELEASES.md)
- [Architecture decisions](docs/DECISIONS.md)
