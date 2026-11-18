#!/bin/bash
# Builds Spotlight launcher apps from launchers/*.applescript into /Applications, and
# installs the dev-app-port helper they use into ~/.local/bin. Safe to rerun.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-/Applications}"
MARK="devdashboard-launcher"

mkdir -p "$HOME/.local/bin"
install -m 755 "$PROJECT_DIR/scripts/dev-app-port" "$HOME/.local/bin/dev-app-port"
echo "Installed ~/.local/bin/dev-app-port"

for src in "$PROJECT_DIR"/launchers/*.applescript; do
  name="$(basename "$src" .applescript)"
  app="$DEST/$name.app"
  if [[ -e "$app" && ! -f "$app/Contents/Resources/$MARK" ]]; then
    echo "SKIPPED $app: it exists and wasn't made by this script."
    continue
  fi
  tmp="$(mktemp -d)/$name.app"
  osacompile -o "$tmp" "$src" 2>/dev/null
  touch "$tmp/Contents/Resources/$MARK"
  # Re-sign after adding the marker, so macOS keeps one identity for its permission prompts.
  codesign --force --sign - "$tmp" 2>/dev/null
  rm -rf "$app"
  mv "$tmp" "$app"
  mdimport "$app" 2>/dev/null || true
  echo "Installed $app"
done
