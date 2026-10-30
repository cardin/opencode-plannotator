import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "jsonc-parser";
import { defaultInstallDirectory, install } from "../scripts/install.mjs";
import { sandbox } from "./helpers/sandbox.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const repository = "https://example.invalid/test-repository.git";

function runner({ dirty = false, failBuild = false } = {}) {
  const calls = [];
  const run = (command, args, options = {}) => {
    calls.push({ command, args, ...options });
    if (command === "git" && args[0] === "clone") {
      const directory = args.at(-1);
      mkdirSync(path.join(directory, ".git"), { recursive: true });
      mkdirSync(path.join(directory, "scripts"));
      writeFileSync(path.join(directory, "package.json"), '{"name":"opencode-plannotator-patch"}');
      cpSync(path.join(root, "scripts", "configure.mjs"), path.join(directory, "scripts", "configure.mjs"));
      mkdirSync(path.join(directory, "node_modules"));
      cpSync(path.join(root, "node_modules", "jsonc-parser"), path.join(directory, "node_modules", "jsonc-parser"), { recursive: true });
    }
    if (command === "git" && args[0] === "remote") return repository;
    if (command === "git" && args[0] === "status") return dirty ? " M README.md" : "";
    if (command === "git" && args[0] === "branch") return "main";
    if (command === "npm" && args[0] === "run") {
      if (failBuild) throw new Error("fixture build failed");
      const directory = path.join(options.cwd, ".build", "package");
      mkdirSync(path.join(directory, "dist"), { recursive: true });
      writeFileSync(path.join(directory, "package.json"), JSON.stringify({
        name: "@cardinal4/opencode-plannotator", exports: { ".": "./dist/server.js", "./tui": "./dist/tui.js" },
      }));
      for (const file of ["server.js", "tui.js"]) writeFileSync(path.join(directory, "dist", file), "export default {};");
    }
    return "";
  };
  return { run, calls };
}

test("one installer clones, builds, then configures without running real CLIs or touching user config", async t => {
  const home = await sandbox(t);
  const env = { XDG_DATA_HOME: path.join(home, "data"), XDG_CONFIG_HOME: path.join(home, "config") };
  const commands = runner();
  const result = await install({ home, env, repository, run: commands.run, log: () => {} });
  const config = parse(await readFile(result.configPath, "utf8"));
  assert.equal(config.plugins[0].options.runtime, "auto");
  assert.equal(commands.calls.filter(call => call.command === "git" && call.args[0] === "clone").length, 1);
  assert.deepEqual(commands.calls.filter(call => call.command === "npm").map(call => call.args), [
    ["--version"], ["ci", "--ignore-scripts"], ["run", "assemble"],
  ]);
  assert.equal(commands.calls.some(call => call.command === "plannotator" && call.args.includes("--version")), true);
});

test("rerun updates an existing managed checkout without adding another plugin", async t => {
  const home = await sandbox(t);
  const env = { OPENCODE_PLANNOTATOR_INSTALL_DIR: path.join(home, "install"), OPENCODE_PLANNOTATOR_CONFIG: path.join(home, "opencode.jsonc") };
  const commands = runner();
  await install({ home, env, repository, run: commands.run, log: () => {} });
  const result = await install({ home, env, repository, run: commands.run, log: () => {} });
  assert.equal(result.changed, false);
  assert.equal(parse(await readFile(result.configPath, "utf8")).plugins.length, 1);
  assert.equal(commands.calls.filter(call => call.command === "git" && call.args[0] === "clone").length, 1);
  assert.ok(commands.calls.some(call => call.command === "git" && call.args.join(" ") === "pull --ff-only origin main"));
});

test("a failed build leaves the current OpenCode config unchanged", async t => {
  const home = await sandbox(t);
  const configPath = path.join(home, "opencode.jsonc");
  const source = '{"plugins":["@plannotator/opencode"]}';
  await writeFile(configPath, source);
  await assert.rejects(install({
    home, env: { OPENCODE_PLANNOTATOR_INSTALL_DIR: path.join(home, "install"), OPENCODE_PLANNOTATOR_CONFIG: configPath },
    repository, run: runner({ failBuild: true }).run, log: () => {},
  }), /build failed/);
  assert.equal(await readFile(configPath, "utf8"), source);
});

test("local changes or an unrelated installation directory are never discarded", async t => {
  const home = await sandbox(t);
  const directory = path.join(home, "install");
  const env = { OPENCODE_PLANNOTATOR_INSTALL_DIR: directory, OPENCODE_PLANNOTATOR_CONFIG: path.join(home, "opencode.jsonc") };
  await mkdir(directory);
  await writeFile(path.join(directory, "user-work.txt"), "keep");
  await assert.rejects(install({ home, env, repository, run: runner().run, log: () => {} }), /already exists/);
  assert.equal(await readFile(path.join(directory, "user-work.txt"), "utf8"), "keep");
  mkdirSync(path.join(directory, ".git"));
  const commands = runner({ dirty: true });
  await assert.rejects(install({ home, env, repository, run: commands.run, log: () => {} }), /local changes/);
  assert.equal(commands.calls.some(call => call.args[0] === "pull"), false);
});

test("importing the installer module never runs an installation", async t => {
  const home = await sandbox(t);
  const script = `await import(${JSON.stringify(pathToFileURL(path.join(root, "scripts", "install.mjs")).href)}); console.log("IMPORTED_ONLY");`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: script, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, HOME: home, PLANNOTATOR_BIN: "/bin/true" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "IMPORTED_ONLY");
});

test("platform defaults keep the checkout outside auto-discovered plugin folders", async t => {
  const home = await sandbox(t);
  assert.equal(defaultInstallDirectory({ home, env: {}, platform: "linux" }), path.join(home, ".local", "share", "opencode-plannotator"));
  const appData = path.join(home, "LocalAppData");
  assert.equal(defaultInstallDirectory({ home, env: { LOCALAPPDATA: appData }, platform: "win32" }), path.join(appData, "opencode-plannotator"));
});
