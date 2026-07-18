# Source and provenance

This fixture contains the 61-chapter novel text of Jane Austen's *Pride and
Prejudice*, first published in 1813 and in the public domain in the United
States.

- Source: Project Gutenberg eBook #1342
- Source URL: https://www.gutenberg.org/ebooks/1342
- Plain-text file: https://www.gutenberg.org/cache/epub/1342/pg1342.txt
- Retrieved: 2026-07-18
- Source edition last updated: 2026-02-10

For fixture use, the Project Gutenberg header and footer, George Saintsbury's
preface, Hugh Thomson illustration descriptions, contents/list-of-illustrations
matter, and printer colophon were removed. The source's hard-wrapped prose was
reflowed into Markdown paragraphs, and each novel chapter was placed in its own
file. The wording and punctuation of the novel were otherwise left unchanged.

The full Project Gutenberg license supplied with the source is preserved in
`PROJECT-GUTENBERG-LICENSE.txt`. Users outside the United States should check
the copyright laws of their country before redistributing the text.

## Build and preview

From the repository root, after compiling Bookforge:

```sh
pnpm run build
node lib/cli.js build tests/fixtures/pride-and-prejudice --format web,epub
node lib/cli.js preview tests/fixtures/pride-and-prejudice
```

The fixture is intentionally excluded from the routine test suite because a
full build invokes Pandoc once for each of its 61 chapters.
