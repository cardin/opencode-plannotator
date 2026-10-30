# Modified Plannotator distribution

Upstream: https://github.com/backnotprop/plannotator

Copyright (c) 2025 backnotprop. Licensed under MIT OR Apache-2.0.
The original licenses are included, and original bundle notices are retained.

This is an unofficial patched distribution. The official prebuilt npm archive
and its integrity hash are recorded in `upstream-release.json` in the assembled
package (and `upstream.json` in the source repository).

The terminal-review modules originate from cardin/plannotator's `tui-runtime`
branch, commit 4e1cf221f. They have been separated from the monorepo, use the SDK
only for development-time types, key the binary probe cache by executable, and
stop a terminal child when its server waiter has been canceled and removed.

Changes to the official release:

- `dist/server.js`: accept the `tui` runtime, register its RPC, route terminal
  reviews, forward tool cancellation, and recognize the replacement package name.
- `dist/index.js`: recognize the runtime and package name and route explicit
  terminal requests to the same guard (legacy OpenCode has no terminal half).
- `dist/tui-runtime.js` and `dist/tui.js`: new terminal review queue/RPC and TUI half.
- `package.json` and `README.md`: replacement metadata, terminal export and
  documentation; upstream build and prepublish hooks removed.

Browser pages, the embedded server, diagram engine, commands, skill and normal
postinstall installer are reused byte-for-byte. Nothing is claimed to be an
official upstream release or upstream-signed build.
