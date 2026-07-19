#!/usr/bin/env bash
# CI-only prerequisite setup. End-user installation is documented in RELEASES.md.
set -euo pipefail

target=${1:?usage: install-prerequisites.sh TARGET}

case "$target" in
  darwin-arm64|darwin-x64)
    brew install pandoc epubcheck poppler
    if [ ! -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
      brew install --cask google-chrome
    fi
    ;;
  linux-x64-gnu)
    sudo apt-get update
    sudo apt-get install --yes pandoc epubcheck poppler-utils chromium
    ;;
  *)
    echo "Unknown release target: $target" >&2
    exit 2
    ;;
esac
