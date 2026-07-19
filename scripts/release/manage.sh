#!/usr/bin/env bash
set -euo pipefail

fail() { echo "bookforge: $*" >&2; exit 1; }

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
HOME_DIR=${BOOKFORGE_HOME:-$(CDPATH= cd -- "$ROOT/../../.." && pwd -P)}
STATE_FILE="$HOME_DIR/install-state.json"
CURRENT_LINK="$HOME_DIR/current"
PREVIOUS_LINK="$HOME_DIR/previous"

node_value() {
  local field=$1
  node --input-type=module - "$STATE_FILE" "$field" <<'NODE'
import { readFile } from "node:fs/promises";
const [file, field] = process.argv.slice(2);
const state = JSON.parse(await readFile(file, "utf8"));
const value = state[field];
if (typeof value !== "string" || !value || /[\r\n]/.test(value)) process.exit(2);
process.stdout.write(value);
NODE
}

atomic_link() {
  local target=$1 link=$2 temporary="${2}.new"
  rm -f "$temporary"
  ln -s "$target" "$temporary"
  # GNU and BSD mv both replace a symlink rather than its referent here.
  rm -f "$link"
  mv "$temporary" "$link"
}

case "${1:-}" in
  update)
    shift
    [ -f "$STATE_FILE" ] || fail "managed install state is missing: $STATE_FILE"
    base_url=$(node_value baseUrl) || fail "managed install state is invalid"
    bin_dir=$(node_value binDir) || fail "managed install state is invalid"
    exec "$ROOT/installer/install.sh" --home "$HOME_DIR" --bin-dir "$bin_dir" --base-url "$base_url" "$@"
    ;;
  rollback)
    shift
    [ "$#" -eq 0 ] || fail "rollback accepts no arguments"
    [ -L "$PREVIOUS_LINK" ] || fail "there is no previous managed release to roll back to"
    previous=$(readlink "$PREVIOUS_LINK") || fail "cannot read previous release"
    [ -x "$previous/bin/bookforge" ] || fail "previous release is incomplete: $previous"
    current=""
    if [ -L "$CURRENT_LINK" ]; then current=$(readlink "$CURRENT_LINK") || fail "cannot read current release"; fi
    atomic_link "$previous" "$CURRENT_LINK"
    if [ -n "$current" ]; then atomic_link "$current" "$PREVIOUS_LINK"; else rm -f "$PREVIOUS_LINK"; fi
    echo "Rolled back to $previous"
    ;;
  *)
    fail "usage: bookforge update [--check] [--version vX.Y.Z] | bookforge rollback"
    ;;
esac
