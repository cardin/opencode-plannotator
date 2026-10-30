#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
	printf '%s\n' 'Install Node.js 22+ first: https://nodejs.org/' >&2
	exit 1
fi

temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT
temporary="$temporary_dir/install.mjs"
installer_url="${OPENCODE_PLANNOTATOR_INSTALL_MJS_URL:-https://raw.githubusercontent.com/cardin/opencode-plannotator/main/scripts/install.mjs}"
curl -fsSL "$installer_url" -o "$temporary"
node "$temporary"
