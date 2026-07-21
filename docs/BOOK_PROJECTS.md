# Book Projects

A Bookforge project is a directory with a `book.yaml` manifest, one or more
Markdown chapters, and any local images, themes, or print profiles the book
uses. The manifest is strict: unknown keys, duplicate YAML keys, missing
required values, and an empty `outputs` object are rejected.

```text
my-book/
  book.yaml
  chapters/
    01-opening.md
  assets/
    map.png
  theme/                 # optional project-local theme
  profiles/              # optional project-local print profiles
```

`bookforge init my-book` creates a minimal starting project. This page is the
complete reference for `book.yaml`, including options beyond that starter.

## Manifest structure

```yaml
schema: 1
id: my-book
title: My Book
subtitle: An optional subtitle
language: en
authors:
  - name: Example Author
theme: classic
chapters:
  - id: opening
    path: chapters/01-opening.md
    role: bodymatter
outputs:
  web: {}
  epub: {}
  pdf: {}
```

Only the following root keys are accepted:

| Key | Required | Default | Meaning |
| --- | --- | --- | --- |
| `schema` | Yes | — | Must be the number `1`. |
| `id` | Yes | — | Stable book identifier. It must use lowercase letters, digits, dots, underscores, or hyphens, and start with a lowercase letter or digit. |
| `title` | Yes | — | Non-empty publication title. |
| `subtitle` | No | — | Non-empty subtitle when supplied. |
| `language` | No | `en` | Nonempty string with at least two characters. Use a BCP 47 language tag such as `en` or `ko`; BCP 47 syntax is recommended but not enforced. |
| `authors` | Yes | — | A non-empty list of author objects. Every object must contain a non-empty `name`. |
| `theme` | No | `classic` | Theme identifier, using the same identifier syntax as `id`. |
| `chapters` | Yes | — | A non-empty ordered list of chapter entries. |
| `colophon` | No | `false` | When `true`, append a generated Colophon end-matter section naming theme, typefaces context, and build seal. |
| `editions` | No | `[]` | Sibling editions that share the chapter tree with optional title/theme/overlays. |
| `outputs` | Yes | — | An object that enables one or more output formats. |

Every project has at least one `authors` entry. When `init` runs without an
`--author` flag, it writes `Unknown author` as an intentional placeholder;
replace it with the real attribution before publishing.

## Chapters

`chapters` is the book's reading order. Each entry accepts only these keys:

| Key | Required | Default | Meaning |
| --- | --- | --- | --- |
| `id` | Yes | — | Unique stable chapter identifier, using the same syntax as the book `id`. |
| `path` | Yes | — | Existing Markdown file within the project. It must end in `.md`. |
| `role` | No | `bodymatter` | One of `frontmatter`, `bodymatter`, `backmatter`, or `part`. The role is carried into the publication's semantic structure. |
| `title` | No | — | Non-empty title override for this publication section. |
| `status` | No | `ready` | One of `draft`, `ready`, or `locked`. Draft chapters are omitted from `build` unless `--include-drafts`; `lint --ship` and `check --ship` refuse drafts. |
| `layout` | No | `prose` | `prose` for ordinary chapters, `verse` for poetry measure (hanging indent + line-length lint). |

Chapter paths are relative to the project directory. Absolute paths, paths
that escape the project, and symbolic links that resolve outside it are
rejected. Chapter IDs must be unique.

When a chapter has no manifest `title`, a level-one heading is used as its
section title only when it is the first parsed block in the Markdown file; that
heading is then omitted from the prose body. A configured `title` takes
precedence and prevents this automatic title extraction. See
[Supported Markdown](MARKDOWN.md) for the accepted Markdown dialect and
heading rules.

## Outputs and builds

The keys present in `outputs` enable the book's normal build formats. At least
one of `web`, `epub`, or `pdf` is required; no other format keys are accepted.
With no `--format` flag, `bookforge build <project>` produces exactly the
formats enabled here.

### Web

```yaml
outputs:
  web:
    reading: paged
```

`web` accepts an object with the optional `reading` setting:

- `paged` (the default) generates an index and one page per chapter.
- `continuous` generates one scrolling web edition.

### EPUB

```yaml
outputs:
  epub: {}
```

`epub` currently accepts only an empty object. Publication metadata, the
chapter order, and the selected theme supply its content and presentation.

### PDF

```yaml
outputs:
  pdf:
    profile: paperback-7x10
    margins: 20mm 18mm 22mm 25mm
```

`pdf` accepts these optional settings:

| Key | Default | Meaning |
| --- | --- | --- |
| `profile` | `screen-a5`, resolved project-local first | Print-profile identifier. For the default ID, Bookforge first looks for `profiles/screen-a5.yaml` in the project, then uses the bundled profile. |
| `page` | Profile value | Overrides the selected profile's page size for this book. Use a supported preset or an absolute `width,height` pair. |
| `margins` | Profile value | Overrides the selected profile's margins. Use one to four absolute lengths in CSS shorthand order: top, right, bottom, left. |

The accepted page presets and exact profile schema are documented in [Print
Profiles](PRINT_PROFILES.md). The resolved profile, including `page` and
`margins` overrides, is recorded in the build manifest.

### Explicit and partial builds

`--format` replaces the normal format set for that command. Its list is not
limited to the formats enabled in `book.yaml`, so it can omit configured
formats or request additional ones:

```sh
bookforge build my-book --format web
bookforge build my-book --format web,epub,pdf
```

An explicit list that does not exactly match the formats enabled in `book.yaml`
replaces `dist/` with a build that `bookforge check` rejects: `check` requires
the formats in `dist/build-manifest.json` to match the configured outputs. Run
an unfiltered `bookforge build my-book` before running `bookforge check
my-book`.

## Editions

Optional sibling editions share the manuscript’s chapter ids while allowing a
different title, theme, chapter subset, or Markdown overlays:

```yaml
editions:
  - id: annotated
    title: The Lantern Atlas — Annotated
    theme: lyceum
    overlays:
      opening: editions/annotated/01-opening.md
```

`bookforge build --edition annotated` writes `dist/editions/annotated/`.
`bookforge build --all-editions` builds the base book into `dist/` and every
edition under `dist/editions/<id>/`.

## Proofs, seals, and archives

Every build writes `release-seal.json` with sorted chapter digests and a
byte-level inventory of its generated files. `bookforge check --seal` rejects
changed seal metadata, chapter snapshots, missing or unexpected artifacts, and
artifact bytes that no longer match. A base seal ignores `dist/editions/`;
each sibling edition has its own seal inside its output directory.

`bookforge diff` compares the current manuscript with the chapter snapshot in
`dist/release-seal.json`. Use `--against <project-or-dist>` to compare with
another project or sealed build. If the baseline is missing or predates proof
snapshots, rebuild it first.

`bookforge archive --label <name>` publishes an immutable archive and updates
`archives/INDEX.md` only after the copy succeeds. The same book, normalized
label, and date resolve to the same destination; Bookforge refuses that
collision so an existing archive can never retain files from a later build.

## Themes

Omit `theme` to use the bundled `classic` theme. For `theme: my-theme`,
Bookforge resolves a matching manifest in this order:

1. `<book>/theme/theme.yaml`
2. `<book>/themes/my-theme/theme.yaml`
3. The bundled `themes/my-theme/theme.yaml`

The theme manifest's `id` must match `my-theme`. Project themes override
built-in themes. See [Theme Authoring](THEMES.md) for the theme package schema,
CSS rules, and theme-asset requirements.

## Local assets and paths

`book.yaml` has no general asset list. Images are discovered from the Markdown
chapters. Write image paths relative to the chapter file, and keep their final
resolved locations inside the project. Bookforge rejects absolute paths,
project escapes, and symbolic-link escapes; it accepts local JPEG, PNG, WebP,
and GIF images and rewrites them into generated output.

For local chapter links, image alternative text, remote or embedded images,
and all other manuscript rules, see [Supported Markdown](MARKDOWN.md). Theme
assets and print-profile files have their own containment and validation rules;
see [Theme Authoring](THEMES.md) and [Print Profiles](PRINT_PROFILES.md).

## Complete example

```yaml
schema: 1
id: lantern-atlas
title: The Lantern Atlas
subtitle: A small publication
language: en
authors:
  - name: Ada Lovelace
theme: classic
chapters:
  - id: title-page
    path: chapters/00-title-page.md
    role: frontmatter
  - id: opening
    path: chapters/01-opening.md
    role: bodymatter
  - id: notes
    path: chapters/99-notes.md
    role: backmatter
outputs:
  web:
    reading: paged
  epub: {}
  pdf:
    profile: paperback-7x10
    margins: 20mm 18mm 22mm 25mm
```
