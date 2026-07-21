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

Bookforge's npm package is private; verified GitHub Release bundles are its
distribution channel for macOS on Apple Silicon and glibc Linux x86_64. They
include no Node runtime: install Node.js 24.18.0 plus the publishing
prerequisites first, then use the verified GitHub Release installer. See
[release installation and updates](docs/RELEASES.md) for prerequisites,
checksums, managed updates, and rollback.

## Build from source

Source development is supported on macOS on Apple Silicon and on x86_64 Linux
with glibc. Linux release builds and checks run on Ubuntu 24.04; other glibc
distributions, especially ones with older glibc, are not guaranteed. The
commands below use POSIX shell syntax and work in the standard shells on those
platforms.

Install Node.js **24.18.0 exactly** and make `node` available on `PATH`. Then
activate the pinned pnpm release with Corepack and install from the lockfile:

```sh
node --version                 # v24.18.0
corepack enable
corepack install --global pnpm@10.26.1
pnpm install --frozen-lockfile
pnpm run build
node lib/cli.js doctor
```

Building every output also requires Pandoc 3.7.0.2, EPUBCheck 5.3.0 with Java,
Poppler, and Google Chrome, Chromium, or Microsoft Edge. The project-local
Vivliostyle 11.1.0 dependency is installed by pnpm. See [supported target
setup](docs/MACHINE_SETUP.md) for platform-specific package examples and
verification notes.

## Start a book

### Installed release

```sh
bookforge init ../my-book
bookforge build ../my-book
bookforge preview ../my-book
```

### Source checkout

```sh
node lib/cli.js init ../my-book
node lib/cli.js build ../my-book
node lib/cli.js preview ../my-book
```

### Import existing Markdown chapters

To start a new project from an existing directory of Markdown files, Bookforge
copies the `.md` files into a new project and writes their natural file order
(for example, `2-intro.md` before `10-ending.md`) into `book.yaml`. The source
directory is never changed. Nested directories are kept, symbolic links are
ignored, and chapter IDs are derived deterministically from their paths.

```sh
bookforge init ../my-book --from-existing ../my-draft --author "Ada Lovelace"
bookforge init ../my-book --from-existing ../my-draft --dry-run
```

Use `--id`, `--title`, `--language`, and one or more `--author` flags to set
metadata up front. Without `--author`, the manifest deliberately says
`Unknown author` so it cannot be mistaken for a real attribution; replace it
before publishing.

### Validate a manuscript before building

`lint` validates only `book.yaml`, Markdown chapters, chapter links, and local
image references. It needs Pandoc to parse chapters, but not a previous `dist/`
build, a theme, EPUBCheck, Vivliostyle, a browser, or Poppler. It reports every
problem it can find in one run.

```sh
bookforge lint ../my-book
# `preflight` is an alias for `lint`
```

A project contains `book.yaml`, an ordered chapter list, and local assets. Use
this lifecycle while authoring:

```sh
bookforge status ../my-book
bookforge lint ../my-book
bookforge build ../my-book
bookforge check ../my-book
bookforge gift ../my-book --to Sam
bookforge archive ../my-book --label v1
```

`status` shows chapter word counts and draft/ready/locked pacing. A normal build
renders every output declared in `book.yaml`, omits `draft` chapters (unless
`--include-drafts`), writes `release-seal.json`, and can emit a zine fold guide
when the print profile sets `imposition: booklet`. `check` requires fresh
`dist/` artifacts whose formats match those configured outputs, and rejects
stale or partial artifacts; pass `--seal` to verify the release seal and
`--ship` to refuse draft chapters. Use `build --format …` for an ad-hoc partial
build; use `preview` for a live web-only editing view in `.bookforge-preview/`
without replacing `dist/`.

The release seal records a digest and word count for every chapter plus a
byte-level inventory of the generated artifacts. `check --seal` verifies the
seal metadata, chapter snapshot, and every base-edition file in `dist/`;
sibling builds under `dist/editions/` carry and verify their own seals. Run
`bookforge diff` after a build to compare the current manuscript with that
sealed chapter snapshot. A missing or older seal cannot be used as a proof
baseline and must be replaced with a fresh build.

Archives are immutable snapshots. Reusing the same label on the same date is
rejected instead of merging new output into an existing archive; choose a new
`--label` for a distinct snapshot.

A temporary `build --theme <id>` that differs from `book.yaml` also leaves a
theme-mismatched build manifest that `check` rejects. Prefer `preview --theme
<id>` for temporary inspection, then run an ordinary build with the configured
theme before `check`.

The default project created by `init` enables all three outputs, so its full
build produces:

```text
dist/
  web/
    index.html
    chapters/
    assets/
  book.epub
  book.pdf
  build-manifest.json
  release-seal.json
```

Useful source-checkout commands:

```sh
node lib/cli.js status [project]
node lib/cli.js build [project] --format web,epub,pdf
node lib/cli.js build [project] --theme meridian
node lib/cli.js build [project] --all-editions
node lib/cli.js gift [project] --to Sam
node lib/cli.js archive [project] --label v1
node lib/cli.js diff [project]
node lib/cli.js drift [project]
node lib/cli.js preview [project] --theme riso-club
node lib/cli.js themes
node lib/cli.js themes show classic
node lib/cli.js themes preview [project]
node lib/cli.js themes test
node lib/cli.js lint [project]
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

Use `bookforge themes` to list the built-in collection and
`bookforge themes show <id>` to inspect a theme's styles and assets. `--theme <id>` is a
one-command build or preview override and never rewrites `book.yaml`. To
compare all built-ins without touching `dist/`, run `bookforge themes preview
[project]`; it creates an atomic static comparison set at
`.bookforge-theme-previews/`.

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

- [Book project reference](docs/BOOK_PROJECTS.md)
- [Supported Markdown](docs/MARKDOWN.md)
- [Theme authoring](docs/THEMES.md)
- [Print profiles](docs/PRINT_PROFILES.md)
- [Dependency security](docs/SECURITY.md)
- [Supported target setup](docs/MACHINE_SETUP.md)
- [Release installation and compatibility](docs/RELEASES.md)
- [Project scope and planning record](docs/SCOPE.md)
- [Architecture decision record](docs/DECISIONS.md)
