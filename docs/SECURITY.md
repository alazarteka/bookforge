# Dependency and Build Security

Bookforge uses exact direct versions and a committed pnpm lockfile. Dependency
installation runs with lifecycle scripts disabled, strict engines and peers,
registry store-integrity verification, and a seven-day release cooling period.
Transitive git and tarball dependencies are blocked, and registry trust evidence
may not downgrade during future resolutions.

## Audited overrides

Vivliostyle 11.1.0 originally resolved three packages with published
advisories. Bookforge applies the narrowest available overrides:

| Dependency path | Original | Override | Reason |
| --- | ---: | ---: | --- |
| `@vivliostyle/vfm > … > trim` | 0.0.1 | 0.0.3 | High-severity regular-expression denial of service |
| `@vivliostyle/vfm > prismjs` | 1.27.0 | 1.30.0 | Moderate DOM-clobbering advisory |
| `press-ready > uuid` | 8.3.2 | 11.1.1 | Moderate buffer-bounds advisory |

The resulting 654-package graph reported zero info, low, moderate, high, or
critical advisories on 2026-07-18. It was installed with lifecycle scripts
disabled and successfully completed a normal Vivliostyle PDF smoke test.

Vivliostyle 11.1.0 has a package-specific exception to the seven-day release
cooling policy because it was manually selected, locked, audited, and tested.
The global cooling policy remains active.

Run the release gate with:

```sh
pnpm run security:verify
```

This verifies the frozen lockfile and fails on any published advisory,
including low-severity findings. It does not claim to prove that every line of
every dependency has been manually audited or that an unpublished compromise
is impossible.

The GitHub Release workflow also runs this advisory gate before it publishes
assets. End-user release installation never invokes a package manager: it
verifies the published target archive SHA-256 and can be independently checked
against GitHub build provenance. See [release installation and updates](RELEASES.md).

## Publication threat model

- Source and asset paths must remain inside the book project.
- Builds reject raw HTML, scripted or inline SVG, remote images, data URLs, and
  `javascript:` links.
- Normal builds fetch no manuscript resources from the network.
- Raster images are decoded and rewritten to strip source metadata.
- Generated web output escapes manuscript text and remains useful without
  JavaScript.
- Outputs are staged and validated before replacing the previous `dist`.
- Commercial press-ready processing is outside the initial PDF scope.
