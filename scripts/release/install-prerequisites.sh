#!/usr/bin/env bash
# CI-only setup for the explicitly pinned GitHub-hosted runner targets. End-user
# setup is documented in RELEASES.md and MACHINE_SETUP.md; this is not a
# cross-platform installer.
set -euo pipefail

readonly PANDOC_VERSION="3.7.0.2"
readonly EPUBCHECK_VERSION="5.3.0"
readonly PANDOC_RELEASE_BASE="https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}"
readonly EPUBCHECK_RELEASE_URL="https://github.com/w3c/epubcheck/releases/download/v${EPUBCHECK_VERSION}/epubcheck-${EPUBCHECK_VERSION}.zip"
# SHA-256 values for the immutable upstream release assets above. Keep these
# paired with version/asset changes so CI fails closed on an unexpected file.
readonly PANDOC_ARM64_SHA256="6d0efa66c476783b50681256d2ef26510de07a0d56ba0571f5b34dbb59bf438d"
readonly PANDOC_X64_SHA256="c8d30dfd1d131d0004c58285c85e3013575706c5ae3a84422a974c39f942b9a3"
readonly PANDOC_LINUX_SHA256="4db8bad3d9f8451a3d52171664f3c58b08af6450fbd54a28dd05f6b00b0bbb04"
readonly EPUBCHECK_SHA256="6c07e68584b2e2ce2f89fe06e1246dfead3eb36b46b340e7d93524f29dcff6c5"
target=${1:?usage: install-prerequisites.sh TARGET}
tool_root="${RUNNER_TEMP:?RUNNER_TEMP is required for CI prerequisite setup}/bookforge-tools"

download() {
  curl --fail --location --retry 3 --proto '=https' --tlsv1.2 --output "$2" "$1"
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{ print $1 }';
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{ print $1 }';
  else echo "The selected runner has no SHA-256 utility" >&2; exit 1; fi
}

verify_checksum() {
  [ "$(sha256_file "$1")" = "$2" ] || { echo "Checksum mismatch for $1" >&2; exit 1; }
}

has_linux_browser() {
  command -v google-chrome >/dev/null 2>&1 \
    || command -v google-chrome-stable >/dev/null 2>&1 \
    || command -v chromium >/dev/null 2>&1 \
    || command -v chromium-browser >/dev/null 2>&1 \
    || command -v microsoft-edge >/dev/null 2>&1
}

write_wrapper() {
  local name=$1
  shift
  {
    printf '#!/usr/bin/env bash\nexec'
    printf ' %q' "$@"
    printf ' "$@"\n'
  } > "$tool_root/bin/$name"
  chmod 755 "$tool_root/bin/$name"
}

install_epubcheck() {
  local archive="$tool_root/epubcheck.zip"
  command -v unzip >/dev/null 2>&1 || { echo "The selected runner has no unzip" >&2; exit 1; }
  download "$EPUBCHECK_RELEASE_URL" "$archive"
  verify_checksum "$archive" "$EPUBCHECK_SHA256"
  unzip -q "$archive" -d "$tool_root"
  [ -f "$tool_root/epubcheck-${EPUBCHECK_VERSION}/epubcheck.jar" ] || {
    echo "The EPUBCheck archive has an unexpected layout" >&2
    exit 1
  }
  write_wrapper epubcheck java -jar "$tool_root/epubcheck-${EPUBCHECK_VERSION}/epubcheck.jar"
}

rm -rf "$tool_root"
mkdir -p "$tool_root/bin"

case "$target" in
  darwin-arm64|darwin-x64)
    command -v brew >/dev/null 2>&1 || { echo "The selected macOS runner has no Homebrew" >&2; exit 1; }
    if [ "$target" = "darwin-arm64" ]; then
      pandoc_asset="pandoc-${PANDOC_VERSION}-arm64-macOS.pkg"
      pandoc_checksum="$PANDOC_ARM64_SHA256"
    else
      pandoc_asset="pandoc-${PANDOC_VERSION}-x86_64-macOS.pkg"
      pandoc_checksum="$PANDOC_X64_SHA256"
    fi
    pandoc_package="$tool_root/$pandoc_asset"
    download "$PANDOC_RELEASE_BASE/$pandoc_asset" "$pandoc_package"
    verify_checksum "$pandoc_package" "$pandoc_checksum"
    sudo installer -pkg "$pandoc_package" -target /
    [ -x /usr/local/bin/pandoc ] || { echo "Pandoc package did not install /usr/local/bin/pandoc" >&2; exit 1; }
    write_wrapper pandoc /usr/local/bin/pandoc
    brew install poppler
    brew install --cask google-chrome
    install_epubcheck
    ;;
  linux-x64-gnu)
    command -v apt-get >/dev/null 2>&1 || { echo "The selected Linux runner has no apt-get" >&2; exit 1; }
    sudo apt-get update
    DEBIAN_FRONTEND=noninteractive sudo apt-get install --yes default-jre poppler-utils
    if ! has_linux_browser; then DEBIAN_FRONTEND=noninteractive sudo apt-get install --yes chromium; fi
    pandoc_package="$tool_root/pandoc-${PANDOC_VERSION}-1-amd64.deb"
    download "$PANDOC_RELEASE_BASE/pandoc-${PANDOC_VERSION}-1-amd64.deb" "$pandoc_package"
    verify_checksum "$pandoc_package" "$PANDOC_LINUX_SHA256"
    sudo apt-get install --yes "$pandoc_package"
    [ -x /usr/bin/pandoc ] || { echo "Pandoc package did not install /usr/bin/pandoc" >&2; exit 1; }
    write_wrapper pandoc /usr/bin/pandoc
    install_epubcheck
    ;;
  *)
    echo "Unknown release target: $target" >&2
    exit 2
    ;;
esac

printf '%s\n' "$tool_root/bin" >> "${GITHUB_PATH:?GITHUB_PATH is required for CI prerequisite setup}"
