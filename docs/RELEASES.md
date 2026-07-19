# Bookforge releases, installation, and updates

Bookforge is distributed as verified GitHub Release assets, not through npm. The
`package.json` package remains private. Each release provides a lean archive for
one supported host that includes Bookforge and its production JavaScript
dependencies; it deliberately **does not include Node.js**.

## Supported release targets

| Release target | Host requirement |
| --- | --- |
| `darwin-arm64` | macOS on Apple Silicon |
| `linux-x64-gnu` | x86_64 Linux using glibc; built and tested on Ubuntu 24.04 |

Linux musl distributions and other processor architectures are not supported by
the release bundles. Ubuntu 24.04 is the tested Linux target; compatibility
with other distributions, particularly those with older glibc, is not
guaranteed. The installer selects the target from `uname` and rejects
unsupported hosts rather than attempting a fallback.

## Prerequisites

Install these before Bookforge. `bookforge doctor` is the final compatibility
check and reports the detected version and remediation when a prerequisite is
missing or incompatible.

- Node.js **24.18.0 exactly**. It is intentionally not bundled so that users
  retain control of the runtime's security updates and system integration.
- Pandoc 3.7.0.2.
- EPUBCheck 5.3.0 and a compatible Java runtime.
- Google Chrome, Chromium, or Microsoft Edge for Vivliostyle PDF rendering.
- Poppler (`pdfinfo` and `pdftoppm`).
- The managed installer is a Bash script, not a POSIX `sh` script. Its bootstrap
  dependencies are `bash`, `curl`, `tar`, `mktemp`, `find`, `awk`, `readlink`,
  and either `shasum` (macOS) or `sha256sum` (Linux), plus standard file
  utilities. On Linux it also requires `getconf` to identify glibc.

`bookforge doctor` enforces the exact Node, Pandoc, EPUBCheck, and project-local
Vivliostyle versions. It checks that a browser and `pdfinfo` run, but does not
pin their versions; a full PDF build also needs `pdftoppm`.

No package manager is required on macOS. If Homebrew is the chosen package
manager, it can supply the external tools:

```sh
brew install pandoc epubcheck poppler
brew install --cask google-chrome
```

Package-manager formulas can move beyond the exact Pandoc and EPUBCheck
baselines. When `doctor` reports a version mismatch, install the corresponding
upstream release rather than treating a current package-manager formula as
compatible.

On glibc Linux, install the distribution equivalents of `pandoc`, `epubcheck`,
a Java runtime, Chromium, Chrome, or Microsoft Edge, and `poppler-utils`. On
Debian/Ubuntu-derived systems, a typical command is:

```sh
sudo apt-get update
sudo apt-get install --yes pandoc epubcheck default-jre chromium poppler-utils
```

Package names and tool versions vary between distributions. Use `bookforge
doctor` to confirm the result instead of assuming that a package name provides
the required baseline.

## Install

Download the installer from a GitHub Release, inspect it if desired, then run
it. Do not run an installer copied from an untrusted mirror.

```sh
curl --fail --location --remote-name \
  https://github.com/alazarteka/bookforge/releases/latest/download/bookforge-install.sh
bash bookforge-install.sh
```

The default managed layout is:

```text
~/.local/share/bookforge/
  releases/vX.Y.Z/<target>/
  current -> releases/vX.Y.Z/<target>/
  previous -> releases/vX.Y.Z/<target>/
~/.local/bin/bookforge
```

Add `~/.local/bin` to `PATH` if necessary, then verify the complete toolchain:

```sh
bookforge doctor
```

The installer accepts `--version vX.Y.Z` to select a particular release. It
also accepts `--home` and `--bin-dir` for a non-default managed location.
`BOOKFORGE_RELEASE_BASE_URL` can point to an approved GitHub fork in controlled
environments; it must be an HTTPS `github.com/OWNER/REPOSITORY` URL.

## Integrity and provenance

The installer downloads `bookforge-release-manifest.json` from the selected
GitHub Release, selects only its host's declared archive, verifies the
archive's SHA-256, rejects unsafe archive paths or links, validates
the extracted manifest, and only then switches `current`. It never invokes npm
or pnpm at install/update time.

Each release additionally contains `SHA256SUMS`. For a manual check after
downloading an archive:

On macOS:

```sh
shasum -a 256 --check bookforge-<version>-<target>.tar.gz.sha256
```

On Linux:

```sh
sha256sum --check bookforge-<version>-<target>.tar.gz.sha256
```

When Bookforge is published from a repository tier that supports GitHub build
attestations, the release also has GitHub provenance. Verify it with:

```sh
gh attestation verify bookforge-<version>-<target>.tar.gz \
  --repo alazarteka/bookforge
```

The checksum protects the downloaded archive. When available, provenance also
binds the archive to the GitHub Actions release build.

## Update, check, and rollback

The launcher manages releases independently from book projects:

```sh
bookforge update --check          # show the latest compatible release
bookforge update                  # verify, stage, then activate it
bookforge update --version v0.2.0 # install a chosen release
bookforge rollback                # restore the previous release
```

An update leaves the existing `current` release usable until the archive is
verified and extracted. On activation it records the old release as `previous`.
`rollback` swaps those managed links; it does not delete released files. Users
may remove old directories only after confirming that the newer release works.

## Release and compatibility policy

- Release tags are `vX.Y.Z` and must exactly match `package.json` before the
  tag-triggered workflow can publish assets.
- Patch releases preserve the documented CLI behavior and `book.yaml`
  `schema: 1` behavior. Feature releases may add capabilities but must retain
  schema-1 compatibility or document a migration before release.
- A breaking book-project, theme, or print-profile change requires a new
  explicit schema version, a migration guide, and an entry in the GitHub
  Release notes. Bookforge will not silently rewrite a user's manuscript.
- Generated output records the Bookforge version and external tool versions in
  its build manifest. Rebuilds remain reproducible only within the documented
  toolchain/platform constraints.
- Every release runs locked dependency installation, fails on published
  dependency advisories, checks web/EPUB/PDF output and every print profile on
  both supported targets, smoke-tests the production archive, generates
  checksums, and publishes the GitHub Release. Provenance is added when the
  repository supports GitHub attestations.
