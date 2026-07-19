# Bookforge supported-target setup

This guide covers source development and local output validation on Bookforge's
supported targets:

| Target | CPU and C library |
| --- | --- |
| macOS | Apple Silicon (arm64) |
| Linux | x86_64 with glibc; tested in CI on Ubuntu 24.04 |

Musl-based Linux distributions and other CPU architectures are outside the
current support policy. Ubuntu 24.04 is the tested Linux release target; other
glibc distributions may work, but older glibc versions are not guaranteed.
GitHub Release bundles choose the target automatically; source checkouts should
use the same baseline before reporting a portability issue.

## Shared requirements

The exact compatibility baseline is intentionally narrow:

| Tool | Required version or capability |
| --- | --- |
| Node.js | 24.18.0 exactly (doctor-enforced) |
| pnpm | 10.26.1 for source installation, activated through Corepack |
| Pandoc | 3.7.0.2 (doctor-enforced) |
| EPUBCheck | 5.3.0 with a compatible Java runtime (doctor-enforced) |
| Vivliostyle CLI | 11.1.0, installed as a project dependency (doctor-enforced) |
| Browser | A runnable Google Chrome, Chromium, or Microsoft Edge for PDF rendering |
| Poppler | A runnable `pdfinfo` command |

Install Node.js from a trusted source appropriate for the host, such as the
official distribution or a version manager. Confirm that its `bin` directory
is already on `PATH`; do not copy a machine-specific path into a shell profile.
In a checkout, activate pnpm and validate the toolchain with:

```sh
node --version                 # v24.18.0
corepack enable
corepack install --global pnpm@10.26.1
pnpm install --frozen-lockfile
pnpm run build
node lib/cli.js doctor
```

The commands above use POSIX shell syntax. Release installation and update use
`bash`; macOS's bundled Bash 3.2 and the usual Bash releases on supported Linux
systems are sufficient.

`doctor` enforces the exact Node, Pandoc, EPUBCheck, and project-local
Vivliostyle versions, and requires that the selected browser and `pdfinfo` run
successfully. It does not require or report pnpm: pnpm is only needed to build
from a source checkout. Browser and Poppler versions are not locked. `pdfinfo`
is also the Poppler command Bookforge uses to validate completed PDF output.

## macOS examples

No macOS package manager is required. If Homebrew is the chosen package
manager, these commands install the external tools after Node is available on
`PATH`:

```sh
brew install pandoc epubcheck poppler
brew install --cask google-chrome
```

An existing Chromium or Microsoft Edge installation is also acceptable if
Bookforge can discover it. Set `BOOKFORGE_BROWSER` to an executable path when
automatic discovery is unsuitable. `node lib/cli.js doctor` does not modify
shell configuration or relink a system Node installation.

Package-manager formulas can move beyond the exact Pandoc and EPUBCheck
baselines. When `doctor` reports a version mismatch, install the corresponding
upstream release rather than treating a current package-manager formula as
compatible.

## Linux examples

Use a glibc-based x86_64 distribution and install the equivalents supplied by
its package manager. Ubuntu 24.04 is the only CI-tested Linux target; older
glibc versions and other distributions are not guaranteed. On Debian/Ubuntu-
derived systems, the typical packages are:

```sh
sudo apt-get update
sudo apt-get install --yes pandoc epubcheck default-jre chromium poppler-utils
```

Other distributions use different package names. Install the Pandoc,
EPUBCheck/Java, Chromium, Chrome, or Microsoft Edge, and Poppler equivalents,
then run
`node lib/cli.js doctor`. Distribution packages may not provide the exact
baseline versions; use the upstream tool release when the doctor check reports
an incompatible version.

## Not required

- Python or a Python environment
- LaTeX, MacTeX, BasicTeX, or TinyTeX
- A globally installed Vivliostyle command
- Docker
- A hosting account

PDF output goes through Vivliostyle and a local Chrome, Chromium, or Microsoft
Edge browser rather than Pandoc's LaTeX pathway. Optional later validators
include DAISY Ace and Calibre. For author-facing PDF geometry, profiles, and
overrides, see [Print Profiles](PRINT_PROFILES.md).
