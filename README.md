# Plannotator for OpenCode: terminal fallback

**Review plans in your terminal when a browser isn't an option.**

This patched build sends OpenCode's `submit_plan` reviews to `plannotator-tui` on
headless or remote machines—or whenever you choose. The browser stays the default.

## Prerequisites

- **OpenCode 2.2.0+**
- **Git**
- **Node.js 22+** with npm

### plannotator (required)

macOS, Linux or WSL:

```sh
curl -fsSL https://plannotator.ai/install.sh | bash -s -- --minimal
```

Windows and other options: [Plannotator on GitHub](https://github.com/backnotprop/plannotator#install).

### plannotator-tui (optional, 0.9.9+)

Only needed for terminal review.

```sh
brew trust plannotator/tap
brew install plannotator/tap/plannotator-tui
# Or: cargo install plannotator-tui
```

More options: [Plannotator TUI on GitHub](https://github.com/plannotator/plannotator-tui#install).

## Install

### One command

**macOS / Linux / WSL**

```sh
curl -fsSL https://raw.githubusercontent.com/cardin/opencode-plannotator/main/install.sh | bash
```

**PowerShell 7 or Windows PowerShell**

```powershell
$p = "$env:TEMP\opencode-plannotator.mjs"; curl.exe -sSLo $p https://raw.githubusercontent.com/cardin/opencode-plannotator/main/scripts/install.mjs
try { node $p } finally { Remove-Item $p -Force -ErrorAction SilentlyContinue }
if ($LASTEXITCODE -ne 0) { throw "Installer failed (exit $LASTEXITCODE)." }
```

This updates your OpenCode config, preserves other plugins and options, and backs
up an existing config. Rerun to update. Then run `/reload` if OpenCode is open.

### Manual install

Command Prompt users: follow these steps.

```sh
git clone https://github.com/cardin/opencode-plannotator.git
cd opencode-plannotator
npm ci --ignore-scripts
npm run assemble
```

Replace any existing Plannotator entry in `~/.config/opencode/opencode.jsonc` with
the path printed by the build:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/absolute/path/opencode-plannotator/.build/package",
      "options": { "workflow": "all-agents", "runtime": "auto" }
    }
  ]
}
```

Keep your other plugins; don't add a second Plannotator entry.

## Use it

`submit_plan` opens the browser by default. In a headless environment it uses
`plannotator-tui` if installed. Set `runtime: "tui"` to always use the terminal.

Feedback and approvals return to the agent. Terminal approval keeps the current
agent; switch to `build` when ready to implement.

## Runtime options

| Value | Behavior |
| --- | --- |
| `"auto"` (default) | Browser, falling back to the terminal in a headless environment when `plannotator-tui` is installed. |
| `"tui"` | Always use the terminal. Requires `plannotator-tui`. |
| `"cli"` | Browser through the installed `plannotator` CLI. |

Only plan review changes; code review and other annotation commands stay in the
browser. Set `PLANNOTATOR_TUI_BIN` if `plannotator-tui` is not on PATH.

## Development

```sh
npm run check
npm test
```

Tests assemble and pack the plugin, then exercise the tarball with stub reviewers
and temporary config/data. They don't touch your OpenCode config or Inbox.

## How it works

This is a small patch-and-repackage project, not a monorepo fork. It downloads the
pinned official `@plannotator/opencode@0.28.38` release, verifies its hash, patches
the OpenCode adapters, and compiles only the terminal modules. Browser assets and
the embedded server are reused unchanged; no Bun build.

OpenCode loads `.build/package/`, not the repository root. For non-standard paths,
set `OPENCODE_PLANNOTATOR_CONFIG` or `OPENCODE_PLANNOTATOR_INSTALL_DIR`.

To upgrade, update `upstream.json`, review `patches/upstream.mjs`, and bump
`distribution.version`. Run the checks and tests before sharing.

### Packaging for maintainers

```sh
npm run package
```

Creates an npm archive in `artifacts/`. It is not needed for installation, and
nothing is pushed or published.

## Credits and license

Plannotator is by [backnotprop](https://github.com/backnotprop/plannotator) and is
dual-licensed under MIT or Apache-2.0; both license texts are included. The
terminal modules originated in
[`cardin/plannotator`, `tui-runtime`](https://github.com/cardin/plannotator/tree/tui-runtime),
commit `4e1cf221f`. See `PATCH-NOTICE.md` for the modifications.
