# Print Profiles

Print profiles describe PDF page geometry and production choices independently
from visual themes. Enable PDF output with `outputs.pdf`; when it does not name
a profile, Bookforge resolves `screen-a5` from `<book>/profiles/screen-a5.yaml`
first, then from the bundled profiles:

```yaml
outputs:
  pdf: {}
```

Resolution order is `<book>/profiles/<id>.yaml`, followed by Bookforge's
built-in `profiles/<id>.yaml`. The built-in profiles are:

- `screen-a5`: color A5 for screens and ordinary home printing
- `paperback-7x10`: grayscale 7×10 inch perfect-bound interior
- `paperback-b5`: grayscale JIS B5 perfect-bound interior
- `coil-letter`: grayscale US Letter coil-bound study copy

Use a built-in profile by setting its ID. Project-local profiles with the same
ID take precedence, which lets a book customize a profile without changing
Bookforge:

```yaml
outputs:
  pdf:
    profile: paperback-7x10
```

## Profile fields

A profile is a YAML file at `profiles/<id>.yaml`. Its required fields are
`schema`, `id`, `name`, `page`, `margins`, and `binding`; `color`, `cover`, and
`bleed` have defaults.

```yaml
schema: 1
id: paperback-7x10
name: Paperback — 7 × 10 inch interior
page: 7in,10in
margins: 20mm 18mm 22mm 25mm
bleed: 0mm
binding: perfect
color: grayscale
cover: interior
```

| Field | Accepted values | Default |
| --- | --- | --- |
| `schema` | `1` | — |
| `id` | A lowercase stable identifier using letters, digits, `.`, `_`, or `-` | — |
| `name` | A non-empty display name | — |
| `page` | `A3`, `A4`, `A5`, `B4`, `B5`, `JIS-B4`, `JIS-B5`, `letter`, `legal`, `ledger`, or `width,height` | — |
| `margins` | One to four absolute lengths | — |
| `bleed` | One absolute length | `0mm` |
| `binding` | `screen`, `perfect`, or `coil` | — |
| `color` | `color` or `grayscale` | `color` |
| `cover` | `interior` or `none` | `interior` |

An absolute length is `0` or a decimal number followed by `mm`, `cm`, `in`, or
`pt`. Custom pages use two absolute lengths separated by a comma, such as
`7in,10in` or `148mm,210mm`. `margins` follow CSS shorthand order: one value
applies to every edge; two mean vertical then horizontal; three mean top,
horizontal, bottom; and four mean top, right, bottom, left.

`binding` and `color` are exposed to print themes as the `data-binding` and
`data-color` attributes on the rendered document. `cover: interior` includes
Bookforge's simple title cover; `cover: none` omits it. The initial PDF scope
does not calculate a paperback wrap, spine width, barcode zone, crop marks,
commercial bleed, or imposition.

## Book-level page and margin overrides

The `page` and `margins` fields under `outputs.pdf` override only those fields
from the selected profile. They do not modify the profile file or override its
`binding`, `color`, `cover`, or `bleed` settings:

```yaml
outputs:
  pdf:
    profile: paperback-7x10
    page: 6in,9in
    margins: 18mm 16mm 20mm 22mm
```

Bookforge resolves these values before rendering and includes the resulting
profile hash in `build-manifest.json`. See [theme authoring](THEMES.md) for the
separate presentation layer and [Supported Markdown](MARKDOWN.md) for the
manuscript syntax shared by all outputs. See [Book Projects](BOOK_PROJECTS.md)
for the complete manifest and output-format reference.
