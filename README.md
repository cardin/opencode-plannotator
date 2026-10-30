# Plannotator for OpenCode: terminal fallback

**Keep Plannotator's browser UI, with terminal plan review when a GUI isn't
available—or whenever you explicitly choose it.** This patch adds
`plannotator-tui` as a fallback for OpenCode's `submit_plan` reviews. Browser
review remains the default; code review and other annotation commands are unchanged.

## Get started

You'll need **OpenCode 2.2.0+** and the **`plannotator` binary** on PATH.
`plannotator-tui` is optional: install it only if you want terminal review.

**Install Plannotator (required)** — binary-only install for macOS, Linux or WSL:

```sh
curl -fsSL https://plannotator.ai/install.sh | bash -s -- --minimal
```

For Windows and other installation options, see
[Plannotator on GitHub](https://github.com/backnotprop/plannotator#install).

**Install plannotator-tui (optional, 0.9.9+)** — for automatic terminal fallback
or explicitly selecting the TUI:

```sh
brew trust plannotator/tap
brew install plannotator/tap/plannotator-tui
# Or: cargo install plannotator-tui
```

For prebuilt binaries, platform details and usage, see
[Plannotator TUI on GitHub](https://github.com/plannotator/plannotator-tui#install).

### 1. Clone and build the plugin

With Git, Node.js 22+ and npm installed, run:

```sh
git clone https://github.com/cardin/opencode-plannotator.git
cd opencode-plannotator
npm ci --ignore-scripts
npm run assemble
```

The build prints the full path to **`.build/package/`**. Copy that path for the
next step. Keep this folder in place: OpenCode will load the plugin from it.
You do not need the Plannotator monorepo or Bun.

### 2. Enable it in OpenCode

Open `~/.config/opencode/opencode.jsonc` (or your project's config). Add the entry
below, replacing `/absolute/path/opencode-plannotator/.build/package` with the
full path printed by the build. If Plannotator is already listed, replace that
entry instead of adding a second one:

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

Keep your other plugin entries. **Replace, don't duplicate:** the official and
patched Plannotator packages register the same plugin and tool names. You don't
need a separate entry in `cli.json`. Run `/reload` if OpenCode is already open.

### 3. Review a plan

Ask your agent to write a plan and submit it for review. When it calls
`submit_plan`, the browser opens as usual. In a headless environment, the patch
uses `plannotator-tui` if you've installed a supported version. Set
`runtime: "tui"` to use the terminal even when a GUI is available.

The agent waits for your decision in either mode:

- **Send feedback:** your comments return to the agent so it can revise the plan.
- **Approve:** the decision and any notes return to the agent.

After a terminal review, OpenCode's UI resumes. Terminal approval keeps your
current agent; switch to `build` yourself when you're ready to implement.

## Choose when to use the terminal

Set `runtime` in the plugin's `options`:

| Value | Behavior |
| --- | --- |
| `"auto"` (default) | Use the browser, falling back to the terminal when a GUI is unavailable and a supported `plannotator-tui` is installed. |
| `"tui"` | Explicitly use the terminal, even when a GUI is available. Requires `plannotator-tui`. |
| `"cli"` | Use the browser through the installed `plannotator` CLI. |

Without `plannotator-tui`, `"auto"` keeps the normal browser workflow. Automatic
selection uses headless/remote environment signals, not a failed browser launch.
Only plan review changes. Code review and other annotation commands still open
in the browser. Set `PLANNOTATOR_TUI_BIN` if your terminal reviewer isn't named
`plannotator-tui` or isn't on PATH.

## Development

```sh
npm run check
npm test
```

Tests assemble and pack the plugin, then exercise the actual tarball with stub
reviewers and temporary config/data directories. They do not open a browser or
touch your OpenCode config or Inbox.

## How this repository works

This is a small patch-and-repackage project, not a monorepo fork. It downloads
the pinned official `@plannotator/opencode@0.28.38` npm release, verifies its
SHA-512 hash, patches the OpenCode adapters, and compiles only the terminal
modules. Browser assets and the embedded server are reused unchanged: no full
Plannotator or Bun build. The output still includes upstream's ~64 MB of assets.

Downloads are cached for subsequent builds. Unexpected patch anchors or a corrupt
archive stop the build. The output's `upstream-release.json` records its origin
and hashes of unchanged files. OpenCode loads the generated `.build/package/`
directory, not the repository root.

To upgrade upstream, update `upstream.json`, review `patches/upstream.mjs`, and
adjust `package.json` → `distribution.version` to match the new base version.
Run the checks and tests before sharing. To distribute through npm, choose an
unused version under `distribution.version`. The current output name is
`@cardinal4/opencode-plannotator`.

### Packaging for maintainers

```sh
npm run package
```

This produces an npm package archive in `artifacts/` for a separate publishing
step. It is not needed for the installation steps above. No script pushes, tags
or publishes. Normal npm installs retain upstream's command/skill installer.

## Credits and license

Plannotator is by [backnotprop](https://github.com/backnotprop/plannotator), licensed
MIT OR Apache-2.0. The terminal modules originated in
[`cardin/plannotator`, `tui-runtime`](https://github.com/cardin/plannotator/tree/tui-runtime),
commit `4e1cf221f`. See `PATCH-NOTICE.md` for the modifications and included licenses.
