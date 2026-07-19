# Supported Markdown

Bookforge version 0.1 accepts GitHub-flavored Markdown plus footnotes. Each
manifest chapter is one publication section. When the manifest does not supply
a chapter `title`, a level-one heading is promoted to the chapter title and
removed from the prose only when it is the first parsed block.

Supported constructs include paragraphs, line breaks, headings, emphasis,
strong emphasis, strikethrough (`~~text~~`), inline and fenced code, block
quotations, ordered and unordered lists, local and internal links, local raster
images with non-empty alternative text, simple tables, footnotes, and
horizontal-rule scene breaks. Links may also use `http:`, `https:`, `mailto:`,
or `tel:`; other URL protocols are rejected. Fenced code is rendered literally
and is never executed.

The following fail validation rather than being silently passed through:

- Raw HTML
- Remote or embedded image data
- SVG
- Images without alternative text
- Complex tables with row or column spans
- Math, citations, media, or unknown Pandoc constructs
- Absolute paths or project-relative paths that escape the project root

## Literal syntax and chapter headings

Bookforge rejects raw HTML to keep every edition safe and portable. When prose
needs to show angle-bracket syntax such as `<rev-list-options>`, write it as
inline code: `` `<rev-list-options>` ``. The same applies to longer snippets:
use a fenced code block.

After title extraction, Bookforge normalizes a body whose shallowest heading is
deeper than level two, then rejects hierarchy jumps of more than one level (for
example, an effective level-two heading followed directly by level four). It
does not impose a source-level heading ceiling.

Chapter IDs in `book.yaml` are the stable cross-format identity. Generated
heading IDs use the chapter ID plus a deterministic Unicode-aware slug and
stable duplicate suffix. An explicit heading ID such as `{#methods}` is
preserved as the ID base; other heading attributes are not a supported
Bookforge contract.
