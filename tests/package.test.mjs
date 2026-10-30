import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { t as listArchive, x as extract } from "tar";
import { fileDigests, output } from "../scripts/assemble.mjs";
import { root } from "../scripts/fetch-upstream.mjs";

const project = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const archive = path.join(root, "artifacts", `${project.distribution.name.replace(/^@/, "").replace("/", "-")}-${project.distribution.version}.tgz`);

test("the packed artifact includes both plugin halves and no tooling or workspace sources", async () => {
  const files = [];
  await listArchive({ file: archive, onReadEntry: entry => files.push(entry.path) });
  for (const file of ["dist/server.js", "dist/index.js", "dist/tui.js", "dist/tui-runtime.js", "LICENSE-MIT", "LICENSE-APACHE", "upstream-release.json"]) {
    assert.ok(files.includes("package/" + file), `missing ${file}`);
  }
  assert.equal(files.some(file => /\/(src|node_modules|patches|\.cache|tests)\//.test(file)), false);
  assert.deepEqual(files.filter(file => file.startsWith("package/scripts/")), ["package/scripts/postinstall.cjs"]);
});

test("the assembled package preserves every browser/runtime asset byte-for-byte", async () => {
  const origin = JSON.parse(await readFile(path.join(output, "upstream-release.json"), "utf8"));
  const actual = await fileDigests(output);
  for (const [file, hash] of Object.entries(origin.unchangedFiles)) assert.equal(actual[file], hash, file);
  for (const file of ["plannotator.html", "review-editor.html", "dist/embedded.js", "diagram-engine/engine.js"]) {
    assert.ok(origin.unchangedFiles[file], `${file} must be reused, not rebuilt`);
  }
});

test("the replacement has no workspace dependencies or build/publish lifecycle traps", async () => {
  const manifest = JSON.parse(await readFile(path.join(output, "package.json"), "utf8"));
  assert.equal(manifest.exports["."], "./dist/server.js");
  assert.equal(manifest.exports["./tui"], "./dist/tui.js");
  assert.equal(manifest.main, "dist/index.js");
  assert.deepEqual(Object.keys(manifest.scripts), ["postinstall"]);
  assert.equal(manifest.devDependencies, undefined);
  assert.equal(manifest.dependencies, undefined);
  assert.ok(!JSON.stringify(manifest).includes("workspace:"));
});

for (const scenario of ["feedback", "cli", "cancel", "stale"]) {
  test(`assembled adapters: ${scenario}, isolated from the checkout and real user config`, {
    skip: process.platform === "win32" ? "The stub reviewer uses a POSIX executable shebang." : false,
    timeout: 20_000,
  }, async () => {
    const temporaryRoot = process.env.OPENCODE_TEST_TMP || (process.platform === "linux" ? "/tmp/opencode" : process.env.TMPDIR || "/tmp");
    await mkdir(temporaryRoot, { recursive: true });
    const scratch = await mkdtemp(path.join(temporaryRoot, "plannotator-repack-test-"));
    try {
      // No ancestor node_modules: this catches accidental runtime SDK imports.
      const installed = path.join(scratch, "plugin");
      await mkdir(installed);
      const needed = new Set(["package/package.json", "package/dist/server.js", "package/dist/tui.js", "package/dist/tui-runtime.js"]);
      await extract({ file: archive, cwd: installed, strip: 1, filter: name => needed.has(name) });
      const home = path.join(scratch, "home");
      await mkdir(home);
      const run = spawnSync(process.execPath, [path.join(root, "tests", "fixtures", "smoke.mjs"), installed, scenario], {
        cwd: scratch, timeout: 15_000, encoding: "utf8",
        env: {
          ...process.env,
          HOME: home, USERPROFILE: home,
          XDG_CONFIG_HOME: path.join(scratch, "config"),
          XDG_DATA_HOME: path.join(scratch, "data"),
          PLANNOTATOR_DATA_DIR: path.join(scratch, "plannotator-data"),
          PLANNOTATOR_TEST_SANDBOX: scratch,
          PLANNOTATOR_INBOX_TOOL: "0", PLANNOTATOR_AGENT_TOOL: "0",
          PLANNOTATOR_PLAN_TIMEOUT_SECONDS: "5",
          PLANNOTATOR_ASK_AI_CHILD: "0",
          PLANNOTATOR_REMOTE: "0", CI: "false", DISPLAY: ":test", WAYLAND_DISPLAY: "",
          SSH_CONNECTION: "", SSH_TTY: "",
          TMPDIR: scratch, TMP: scratch, TEMP: scratch,
          // Valid executable, not a sentinel value; no real browser can open.
          PLANNOTATOR_BROWSER: "/usr/bin/true",
          PLANNOTATOR_BIN: path.join(scratch, "fake-cli"),
          PLANNOTATOR_TUI_BIN: path.join(scratch, "fake-tui"),
          TEST_SCRATCH: scratch,
          GH_CONFIG_DIR: path.join(scratch, "gh"), GH_TOKEN: "test-not-a-token", GITHUB_TOKEN: "",
        },
      });
      assert.equal(run.error, undefined, run.error?.message);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.match(run.stdout, /SMOKE_OK/);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
}
