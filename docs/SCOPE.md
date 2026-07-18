# Bookforge Project Scope

## 1. Objective

Build a local command-line publishing system that converts an ordered Markdown
manuscript into beautiful, consistent HTML, EPUB, and PDF editions.

Bookforge is personal-first: it should solve the immediate need to read the
same work comfortably on a computer, phone, ereader, or printed page. Its
internal boundaries should nevertheless be clean enough to support additional
books and themes without copying an application for every manuscript.

## 2. Product principles

1. The publication model owns meaning; no output format is canonical.
2. Pandoc is a parser at the boundary, not the internal data model.
3. HTML, EPUB, and PDF receive format-specific rendering behavior.
4. Themes share tokens and prose typography, not every layout mechanism.
5. Generated books are static and remain readable without an application
   server.
6. Builds must be inspectable, reproducible where practical, and explicit
   about external tool versions.
7. Unsupported Markdown fails with a useful diagnostic rather than silently
   degrading.

## 3. MVP deliverable

The first complete vertical slice will produce all three formats from one
project:

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

Development order will be:

1. Parse and validate the book project.
2. Establish the owned publication IR and stable identifiers.
3. Render and preview static HTML.
4. Package and validate EPUB.
5. Add a deliberately narrow PDF renderer through Vivliostyle.
6. Run cross-format fixtures and visual checks.

This order prevents debugging the IR and the slowest renderer simultaneously,
but PDF remains part of the first complete release.

## 4. Input project contract

Version one accepts an explicit project manifest and an ordered list of
Markdown files. Automatic chapter splitting of one large Markdown file is
deferred.

Illustrative structure:

```text
my-book/
  book.yaml
  chapters/
    01-opening.md
    02-second-chapter.md
  assets/
    cover.jpg
    figures/
  theme/
    theme.yaml
    tokens.css
    body.css
    web.css
    epub.css
    print.css
```

Illustrative `book.yaml`:

```yaml
schema: 1
id: lantern-atlas
title: The Lantern Atlas
subtitle: A small publication
language: en
authors:
  - name: Example Author
theme: classic
cover:
  path: assets/cover.jpg
  alt: Abstract orbital diagram on parchment
chapters:
  - id: the-give
    path: chapters/01-the-give.md
    role: bodymatter
  - id: the-witness
    path: chapters/02-the-witness.md
    role: bodymatter
outputs:
  web: {}
  epub: {}
  pdf:
    profile: screen-a5
```

Chapter IDs are explicit and stable. Renaming a chapter or its file must not
invalidate saved reading positions, EPUB fragment links, or bookmarks.

## 5. Supported Markdown in version one

Supported:

- Paragraphs and hard/soft line breaks
- Headings levels 1 through 4
- Emphasis, strong emphasis, and inline code
- Ordered and unordered lists
- Block quotations
- Local links and internal links
- Local raster images with required alternative text
- Figures with captions
- Footnotes
- Fenced code blocks
- Simple tables
- Horizontal rules interpreted as semantic scene breaks when configured by
  the book or theme

Rejected or deferred:

- Raw HTML
- Executable code blocks
- Remote assets fetched during a build
- Scripted SVG
- Embedded JavaScript supplied by a manuscript
- Complex row/column-spanning tables
- Citations and bibliographies
- Math rendering
- Audio, video, and EPUB media overlays
- Automatic single-file chapter splitting

The supported dialect will be documented as a contract and covered by fixture
tests.

## 6. Canonical publication model

Pandoc JSON exists only between parsing and adaptation. Bookforge converts it
immediately into a constrained, versioned TypeScript model.

```ts
interface Publication {
  schemaVersion: 1;
  id: string;
  metadata: PublicationMetadata;
  cover?: Figure;
  spine: Section[];
  assets: Asset[];
}

interface Section {
  id: string;
  role: "frontmatter" | "bodymatter" | "backmatter" | "part";
  title: Inline[];
  subtitle?: Inline[];
  blocks: Block[];
}

type Block =
  | Paragraph
  | Heading
  | BlockQuote
  | SceneBreak
  | Figure
  | List
  | Table
  | CodeBlock;

type Inline =
  | Text
  | Emphasis
  | Strong
  | Link
  | InlineImage
  | InlineCode
  | FootnoteReference;
```

The IR contains semantics and stable identity, not web controls, EPUB package
details, or print pagination instructions.

### Stable identifiers

- Publication ID: explicit `book.yaml` value.
- Chapter ID: explicit manifest value, unique within the publication.
- Heading ID: explicit Markdown ID when present; otherwise a deterministic
  slug scoped to the chapter, with stable duplicate suffixing.
- Footnote ID: chapter ID plus the source footnote label.
- Asset ID: normalized project-relative path plus a content hash.

The slug algorithm will have an explicit version before fixtures are created.

## 7. Renderers

### 7.1 Static web reader

Required:

- Semantic static HTML
- One index/cover page and one page per chapter
- Table of contents and previous/next navigation
- Responsive typography
- Light, sepia, and dark reading modes
- Adjustable text size and reading width
- Saved chapter and reading position
- Progressive enhancement; prose remains usable without JavaScript
- Local preview server with live rebuild
- Folder output with relative URLs

Deferred:

- Single-file HTML with embedded assets
- Search
- Annotations and highlights
- Hosted deployment
- Accounts or cross-device synchronization
- Client-side application routing

### 7.2 EPUB 3.3

Required:

- Reflowable EPUB 3.3
- One XHTML content document per spine section
- Navigation document and landmarks
- Correct language and publication metadata
- Cover image and cover document
- Semantic footnotes
- Conservative EPUB-specific CSS
- Embedded local fonts only when explicitly supplied
- Deterministic zip order and timestamps
- First `mimetype` entry stored uncompressed
- EPUBCheck errors fail the build

Accessibility checks initially produce actionable diagnostics. Missing figure
alt text, invalid heading order, broken reading order, or missing language are
structural errors and fail the build.

### 7.3 PDF through Vivliostyle

The initial PDF scope is intentionally narrow:

- A4, A5, US Letter, and 6 x 9 inch page presets
- Custom page width and height
- Configurable margins
- Chapter-opening pages
- Page numbers
- Running headers
- Basic widow and orphan control
- Footnotes supported to the extent provided reliably by the pinned
  Vivliostyle version
- Embedded local fonts
- Screen- and ordinary-printer-friendly output

Deferred:

- Crop marks and bleed
- CMYK conversion
- Imposition and signatures
- Commercial-printer profiles
- Automatic font subsetting
- Sophisticated page balancing
- Manual page-specific corrections

## 8. Theme system

Themes are loadable built-in or project-local packages:

```text
themes/classic/
  theme.yaml
  tokens.css
  body.css
  web.css
  epub.css
  print.css
```

Shared across outputs:

- Font roles and fallback stacks
- Color roles
- Spacing scale
- Reading measure
- Paragraph, heading, quotation, figure, epigraph, and scene-break treatment
- Ornament assets

Format-specific:

- Web controls and interaction
- EPUB navigation, landmarks, and footnote markup
- Print page boxes, running heads, folios, breaks, and footnote placement

Bookforge owns the semantic markup and themes own CSS plus declared local
assets. Physical trim, margins, binding, color mode, bleed, and cover mode are
selected through a separate validated print profile.

The built-in `classic` theme supplies the first visual language through
publication primitives rather than application components.

## 9. Technical architecture

Runtime and orchestration: TypeScript on Node.js 24 LTS.

Proposed source layout:

```text
src/
  cli/
  config/
  pandoc/
  ir/
  transforms/
  renderers/
    web/
    epub/
    print/
  themes/
  validation/
  assets/
tests/
  fixtures/
```

External process boundaries:

- Pandoc: Markdown parsing only
- EPUBCheck: conformance validation
- Vivliostyle CLI: paginated PDF production

The implemented dependency boundary is deliberately small:

- Configuration and validation: `zod` and `yaml`
- EPUB archive assembly: `yazl`
- Raster decoding and metadata stripping: `sharp`
- PDF: project-local `@vivliostyle/cli`
- Development: `typescript` and exact Node type definitions

Argument parsing, subprocesses, file watching, preview serving, tests, and
HTML/XHTML serialization use Node.js built-ins. Generated publications do not
contain React, a bundler runtime, or a template engine.

## 10. Validation and reproducibility

Every build must emit `build-manifest.json` containing:

- Bookforge version
- Book schema version
- Source and asset hashes
- Theme identifier and hash
- Node.js version
- Pandoc version
- EPUBCheck version
- Vivliostyle version when PDF is built
- Build timestamp derived from `SOURCE_DATE_EPOCH` when present

Build checks:

- Manifest schema validation
- Unique and valid identifiers
- Supported Markdown constructs only
- Heading hierarchy
- Local asset existence and path containment
- Alternative text for figures
- Internal and local link validity
- Safe asset formats
- EPUBCheck
- PDF existence, page count, and metadata sanity
- Deterministic EPUB comparison fixture

Security rules:

- Project-relative asset paths may not escape the project root.
- No network access during normal builds.
- Raw HTML is rejected in version one.
- SVG is rejected until a sanitizer and threat model are implemented.
- Image metadata is stripped from copied output assets.

## 11. CLI scope

```text
bookforge init <directory>
bookforge build [project]
bookforge build [project] --format web,epub,pdf
bookforge preview [project]
bookforge check [project]
bookforge doctor
```

- `init`: creates a minimal book project.
- `build`: validates, parses once, renders requested formats, and reports
  artifact locations.
- `preview`: rebuilds and serves the web edition locally.
- `check`: runs structural and output validators without changing source.
- `doctor`: reports missing or incompatible external tools and exact remedies.

## 12. Test strategy

A synthetic fixture committed to the repository exercises parts, front matter,
back matter, footnotes, figures, lists, tables, internal links, non-ASCII text,
scene breaks, emphasis, and block quotations. Long-form manuscripts remain
user-owned inputs rather than repository fixtures.

Tests include:

- Pandoc adapter unit tests
- IR schema and invariant tests
- Stable-ID golden tests
- Renderer snapshots at the semantic HTML/XHTML level
- EPUB archive structure and reproducibility tests
- EPUBCheck integration test
- PDF smoke test and rendered-page visual regression for representative pages
- Web-reader keyboard and no-JavaScript smoke tests

## 13. Definition of done for the first complete release

- A new sample project can be created with `bookforge init`.
- The synthetic fixture builds to web, EPUB, and PDF with one command.
- The EPUB has zero EPUBCheck errors.
- The web edition is readable on desktop and mobile with JavaScript disabled.
- Reading preferences and location persist when JavaScript is enabled.
- The PDF supports all four page presets and contains working chapter breaks,
  running heads, and page numbers.
- Repeating an EPUB build with identical inputs and `SOURCE_DATE_EPOCH` yields
  identical bytes.
- `bookforge doctor` accurately describes this machine's tool state.
- No build reads outside the project or accesses the network.

## 14. Explicit non-goals

- A hosted publishing service
- A WYSIWYG editor
- DRM
- Kindle-specific proprietary output
- DOCX output
- Collaborative editing
- Commercial print prepress
- Automatic copyright or font-license determination
- Arbitrary plugins or manuscript-supplied scripts
- Full CommonMark/Pandoc feature parity in version one

## 15. Delivery phases

### Phase 0: scaffold and contracts

- Create the TypeScript package and CLI shell.
- Pin Node and package-manager versions.
- Implement `doctor`.
- Finalize `book.yaml` schema, IR schema, and ID algorithm.
- Add the synthetic fixture.

### Phase 1: parse and web

- Invoke Pandoc once per chapter.
- Adapt the supported Pandoc nodes into the owned IR.
- Implement transforms and structural validation.
- Establish the first static built-in theme.
- Generate and preview the web reader.

### Phase 2: EPUB

- Generate XHTML, OPF, navigation, landmarks, and container files.
- Normalize images and copy assets.
- Assemble deterministic EPUB archives.
- Integrate EPUBCheck.

### Phase 3: PDF

- Render print HTML and paged-media CSS.
- Integrate the pinned Vivliostyle CLI.
- Implement page presets and print furniture.
- Add PDF smoke and representative-page checks.

### Phase 4: hardening

- Run both fixture books across all formats.
- Improve diagnostics and failure recovery.
- Record build provenance.
- Document theme authoring and supported Markdown.
