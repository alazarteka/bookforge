# Supported Markdown

Bookforge version 0.1 accepts GitHub-flavored Markdown plus footnotes and
heading attributes. Each manifest chapter is one publication section. Its first
level-one heading becomes the chapter title and is omitted from the prose body.

Supported constructs include paragraphs, line breaks, headings through level
four, emphasis, strong emphasis, inline and fenced code, block quotations,
ordered and unordered lists, local and internal links, local raster images with
non-empty alternative text, simple tables, footnotes, and horizontal-rule scene
breaks.

The following fail validation rather than being silently passed through:

- Raw HTML
- Executable code blocks
- Remote or embedded image data
- SVG
- Images without alternative text
- Complex tables with row or column spans
- Math, citations, media, or unknown Pandoc constructs
- Absolute paths or project-relative paths that escape the project root

Chapter IDs in `book.yaml` are the stable cross-format identity. Generated
heading IDs use the chapter ID plus a deterministic Unicode-aware slug and
stable duplicate suffix.
