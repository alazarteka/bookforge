# Bookforge Machine Setup

Verified 2026-07-18 on macOS 26.5.1 with Apple Homebrew.

| Tool | Verified version | Location or policy |
| --- | --- | --- |
| Node.js | 24.18.0 | `/opt/homebrew/opt/node@24/bin/node` |
| pnpm | 10.26.1 | Pinned by `packageManager` |
| Pandoc | 3.7.0.2 | `/opt/homebrew/bin/pandoc` |
| EPUBCheck | 5.3.0 | Homebrew formula |
| Vivliostyle CLI | 11.1.0 | Project-local dependency |
| Vivliostyle Core | 2.44.1 | Transitive locked dependency |
| Poppler | 25.06.0 | `pdfinfo` and `pdftoppm` |
| Chrome | 150.0.7871.127 | Local headless PDF renderer |
| OpenJDK | 26.0.1 | Homebrew dependency of EPUBCheck |

Node 24 is keg-only because another Node release remains globally linked. Use
the project baseline without modifying the user's shell profile:

```sh
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin"
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm run build
node lib/cli.js doctor
```

`bookforge doctor` checks the exact Node, pnpm, Pandoc, EPUBCheck, and
Vivliostyle baselines and confirms Poppler is present. Java does not need a
global symlink because the Homebrew EPUBCheck launcher resolves its own
runtime.

## Not required

- Python or a Python environment
- LaTeX, MacTeX, BasicTeX, or TinyTeX
- A globally installed Vivliostyle command
- Docker
- A hosting account

PDF output goes through Vivliostyle and local Chrome rather than Pandoc's
LaTeX pathway. Optional later validators include DAISY Ace and Calibre.
