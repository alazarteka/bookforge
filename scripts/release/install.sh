#!/usr/bin/env bash
# Installs only assets published by the official Bookforge GitHub Release.
# It never runs a package manager and never embeds a Node.js runtime.
set -euo pipefail

readonly DEFAULT_BASE_URL="https://github.com/alazarteka/bookforge"
readonly EXPECTED_NODE="v24.18.0"

fail() { echo "bookforge-install: $*" >&2; exit 1; }
note() { echo "bookforge-install: $*"; }

require_node() {
  local found
  found=$(node --version 2>/dev/null) || fail "Node.js 24.18.0 is required; install it before Bookforge"
  [ "$found" = "$EXPECTED_NODE" ] || fail "Node.js 24.18.0 is required; found $found"
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}';
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  else fail "shasum or sha256sum is required to verify release assets"; fi
}

safe_version() {
  local value=${1#v}
  [[ "$value" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || fail "invalid release version: $1"
  printf '%s' "$value"
}

safe_base_url() {
  [[ "$1" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "base URL must be an https://github.com/OWNER/REPOSITORY URL"
}

release_target() {
  local os arch
  os=$(uname -s)
  arch=$(uname -m)
  case "$os/$arch" in
    Darwin/arm64) printf 'darwin-arm64' ;;
    Linux/x86_64)
      getconf GNU_LIBC_VERSION >/dev/null 2>&1 || fail "Linux releases require glibc (musl is unsupported)"
      printf 'linux-x64-gnu'
      ;;
    *) fail "unsupported platform: $os $arch (supported: macOS Apple Silicon, Linux x86_64 glibc)" ;;
  esac
}

download() {
  local url=$1 destination=$2
  command -v curl >/dev/null 2>&1 || fail "curl is required to download a GitHub Release"
  curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --output "$destination" "$url"
}

manifest_value() {
  local manifest=$1 field=$2 target=${3:-}
  node --input-type=module - "$manifest" "$field" "$target" <<'NODE'
import { readFile } from "node:fs/promises";
const [file, field, target] = process.argv.slice(2);
const manifest = JSON.parse(await readFile(file, "utf8"));
const value = target ? manifest.targets?.[target]?.[field] : manifest[field];
if (typeof value !== "string" || !value || /[\r\n]/.test(value)) process.exit(2);
process.stdout.write(value);
NODE
}

assert_archive_paths() {
  local archive=$1 entry
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    case "$entry" in
      /*|../*|*'/../'*|..|*'//'*) fail "release archive contains an unsafe path" ;;
    esac
  done < <(tar -tzf "$archive")
}

assert_safe_links() {
  node --input-type=module - "$1" <<'NODE'
import { execFileSync } from "node:child_process";
import path from "node:path";

const archive = process.argv[2];
const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const root = listing[0]?.split("/", 1)[0];
if (!root) process.exit(2);
const detail = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" }).trim().split("\n");
for (const line of detail) {
  if (line.startsWith("h")) throw new Error("release archive contains a hard link");
  if (!line.startsWith("l")) continue;
  const marker = " -> ";
  const offset = line.indexOf(marker);
  if (offset === -1) throw new Error("release archive has an unparseable symbolic link");
  const link = line.slice(0, offset).trim().split(/\s+/).at(-1);
  const target = line.slice(offset + marker.length);
  if (!link || !target || target.startsWith("/") || target.includes("\0")) throw new Error("release archive contains an unsafe symbolic link");
  const resolved = path.posix.resolve("/", path.posix.dirname(link), target);
  if (resolved !== `/${root}` && !resolved.startsWith(`/${root}/`)) throw new Error("release archive symbolic link escapes its bundle");
}
NODE
}

atomic_link() {
  local target=$1 link=$2 temporary="${2}.new"
  rm -f "$temporary"
  ln -s "$target" "$temporary"
  rm -f "$link"
  mv "$temporary" "$link"
}

check_only=false
version=""
base_url=${BOOKFORGE_RELEASE_BASE_URL:-$DEFAULT_BASE_URL}
home_dir=${BOOKFORGE_HOME:-"$HOME/.local/share/bookforge"}
bin_dir=${BOOKFORGE_BIN_DIR:-"$HOME/.local/bin"}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check) check_only=true ;;
    --version) shift; [ "$#" -gt 0 ] || fail "--version requires a value"; version=$(safe_version "$1") ;;
    --base-url) shift; [ "$#" -gt 0 ] || fail "--base-url requires a value"; base_url=$1 ;;
    --home) shift; [ "$#" -gt 0 ] || fail "--home requires a value"; home_dir=$1 ;;
    --bin-dir) shift; [ "$#" -gt 0 ] || fail "--bin-dir requires a value"; bin_dir=$1 ;;
    --help|-h)
      cat <<'USAGE'
Usage: install.sh [--version vX.Y.Z] [--check] [--base-url URL] [--home DIR] [--bin-dir DIR]

Downloads a verified Bookforge GitHub Release for this host. --check only reports
the available version. The installer requires an existing exact Node.js 24.18.0.
USAGE
      exit 0
      ;;
    *) fail "unknown option: $1" ;;
  esac
  shift
done

require_node
safe_base_url "$base_url"
target=$(release_target)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/bookforge-install.XXXXXX")
lock_dir="${home_dir}.install.lock"
cleanup() { rm -rf "$temporary"; rmdir "$lock_dir" 2>/dev/null || true; }
trap cleanup EXIT HUP INT TERM
mkdir "$lock_dir" 2>/dev/null || fail "another Bookforge install or update is already running"

manifest_url="$base_url/releases/latest/download/bookforge-release-manifest.json"
if [ -n "$version" ]; then manifest_url="$base_url/releases/download/v$version/bookforge-release-manifest.json"; fi
manifest_file="$temporary/bookforge-release-manifest.json"
download "$manifest_url" "$manifest_file"
available_version=$(manifest_value "$manifest_file" version) || fail "release manifest is invalid"
[ -z "$version" ] || [ "$available_version" = "$version" ] || fail "release manifest version does not match requested version"
asset=$(manifest_value "$manifest_file" asset "$target") || fail "release does not contain a bundle for $target"
expected_sha=$(manifest_value "$manifest_file" sha256 "$target") || fail "release manifest has no checksum for $target"
[[ "$asset" =~ ^bookforge-[0-9A-Za-z._-]+-${target}\.tar\.gz$ ]] || fail "release manifest has an unsafe asset name"
[[ "$expected_sha" =~ ^[a-fA-F0-9]{64}$ ]] || fail "release manifest has an invalid SHA-256"

if "$check_only"; then
  current="none"
  [ -L "$home_dir/current" ] && current=$(readlink "$home_dir/current" || printf 'unknown')
  note "latest compatible release: v$available_version ($target; current: $current)"
  exit 0
fi

archive="$temporary/$asset"
download "$base_url/releases/download/v$available_version/$asset" "$archive"
actual_sha=$(sha256_file "$archive")
[ "$actual_sha" = "$expected_sha" ] || fail "checksum mismatch for $asset"
assert_archive_paths "$archive"
assert_safe_links "$archive"
tar -xzf "$archive" -C "$temporary"

bundle="$(find "$temporary" -mindepth 1 -maxdepth 1 -type d -name "bookforge-${available_version}-${target}" -print -quit)"
[ -n "$bundle" ] || fail "release archive has no expected bundle directory"
[ -x "$bundle/bin/bookforge" ] || fail "release bundle has no executable launcher"
[ -f "$bundle/lib/cli.js" ] || fail "release bundle has no compiled CLI"
[ -f "$bundle/release-manifest.json" ] || fail "release bundle has no manifest"
bundle_version=$(manifest_value "$bundle/release-manifest.json" version) || fail "bundle manifest is invalid"
bundle_target=$(manifest_value "$bundle/release-manifest.json" target) || fail "bundle manifest is invalid"
[ "$bundle_version" = "$available_version" ] && [ "$bundle_target" = "$target" ] || fail "bundle manifest does not match the requested release"

destination="$home_dir/releases/v$available_version/$target"
mkdir -p "$(dirname "$destination")" "$bin_dir"
if [ ! -d "$destination" ]; then mv "$bundle" "$destination"; fi
[ -x "$destination/bin/bookforge" ] || fail "managed release installation is incomplete"

previous=""
[ -L "$home_dir/current" ] && previous=$(readlink "$home_dir/current" || fail "cannot read current release")
atomic_link "$destination" "$home_dir/current"
if [ -n "$previous" ] && [ "$previous" != "$destination" ]; then atomic_link "$previous" "$home_dir/previous"; fi

BOOKFORGE_STATE_BASE_URL="$base_url" BOOKFORGE_STATE_BIN_DIR="$bin_dir" BOOKFORGE_STATE_TARGET="$target" BOOKFORGE_STATE_VERSION="$available_version" \
  node --input-type=module - "$home_dir/install-state.json" <<'NODE'
import { writeFile } from "node:fs/promises";
const file = process.argv[2];
const state = {
  schema: 1,
  baseUrl: process.env.BOOKFORGE_STATE_BASE_URL,
  binDir: process.env.BOOKFORGE_STATE_BIN_DIR,
  target: process.env.BOOKFORGE_STATE_TARGET,
  version: process.env.BOOKFORGE_STATE_VERSION,
};
await writeFile(file, `${JSON.stringify(state)}\n`);
NODE
BOOKFORGE_LAUNCHER_TARGET="$home_dir/current/bin/bookforge" \
  node --input-type=module - "$bin_dir/bookforge" <<'NODE'
import { writeFile } from "node:fs/promises";
const file = process.argv[2];
const target = process.env.BOOKFORGE_LAUNCHER_TARGET;
const quote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
await writeFile(file, `#!/usr/bin/env sh\nexec ${quote(target)} "$@"\n`);
NODE
chmod 755 "$bin_dir/bookforge"
note "installed Bookforge v$available_version for $target"
note "add $bin_dir to PATH, then run: bookforge doctor"
