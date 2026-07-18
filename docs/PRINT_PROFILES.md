# Print Profiles

Print profiles describe physical production choices independently from visual
themes. A book selects one under `outputs.pdf`:

```yaml
outputs:
  pdf:
    profile: paperback-7x10
```

Resolution order is `<book>/profiles/<id>.yaml`, followed by Bookforge's
built-in `profiles/<id>.yaml`. The built-in profiles are:

- `screen-a5`: color A5 for screens and ordinary home printing
- `paperback-7x10`: grayscale 7×10 inch perfect-bound interior
- `paperback-b5`: grayscale JIS B5 perfect-bound interior
- `coil-letter`: grayscale US Letter coil-bound study copy

Profile schema:

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

`page` accepts a supported preset or an absolute `width,height` pair. Margins
use CSS order (top, right, bottom, left). Book-level `page` and `margins` values
may override the selected profile; their resolved values participate in the
profile hash.

Version 0.1 produces an interior PDF with an optional simple title cover.
Calculated paperback wraps, spine-width formulas, barcode zones, crop marks,
commercial bleed, and imposition remain deliberately outside this profile
contract.
