import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { parse } from "jsonc-parser";
import { configurePlugin, editConfig, selectConfig } from "../scripts/configure.mjs";
import { fakePlugin, sandbox } from "./helpers/sandbox.mjs";

test("fresh config points to the built package with both browser-first defaults", async t => {
  const home = await sandbox(t);
  const pluginDirectory = path.join(home, "plugin with spaces");
  await fakePlugin(pluginDirectory);
  const configPath = path.join(home, ".config", "opencode", "opencode.jsonc");
  const result = await configurePlugin({ configPath, pluginDirectory, home });
  const config = parse(await readFile(configPath, "utf8"));
  assert.equal(config.$schema, "https://opencode.ai/config.json");
  assert.deepEqual(config.plugins, [{
    package: pathToFileURL(pluginDirectory).href,
    options: { workflow: "all-agents", runtime: "auto" },
  }]);
  assert.equal(result.changed, true);
  assert.equal(result.backup, undefined);
  if (process.platform !== "win32") assert.equal((await stat(configPath)).mode & 0o777, 0o600);
});

test("editing JSONC preserves other plugins, comments, line endings and explicit options", async t => {
  const home = await sandbox(t);
  const source = '{\r\n\t// keep the model choice\r\n\t"model": "test/model",\r\n\t"plugins": [\r\n\t\t"other-plugin",\r\n\t\t{\r\n\t\t\t"package": "@plannotator/opencode@latest",\r\n\t\t\t"options": {\r\n\t\t\t\t// keep this preference\r\n\t\t\t\t"workflow": "plan-agent",\r\n\t\t\t\t"runtime": "tui",\r\n\t\t\t},\r\n\t\t},\r\n\t],\r\n}\r\n';
  const pluginDirectory = path.join(home, "new-plugin");
  const result = await editConfig(source, { configPath: path.join(home, "opencode.jsonc"), pluginDirectory, home });
  const config = parse(result);
  assert.equal(config.model, "test/model");
  assert.equal(config.plugins[0], "other-plugin");
  assert.equal(config.plugins[1].package, pathToFileURL(pluginDirectory).href);
  assert.deepEqual(config.plugins[1].options, { workflow: "plan-agent", runtime: "tui" });
  assert.ok(result.includes("// keep this preference\r\n"));
  assert.ok(result.includes('\t// keep the model choice\r\n\t"model": "test/model",'));
  assert.equal(/(?<!\r)\n/.test(result), false);
});

test("versioned upstream and replacement entries become one, keeping existing options", async t => {
  const home = await sandbox(t);
  const result = await editConfig(JSON.stringify({ plugins: [
    "unrelated", "@plannotator/opencode@0.28.38",
    ["@cardinal4/opencode-plannotator@0.28.38-tui.1", { planningAgents: ["plan", "design"] }],
  ] }), { configPath: path.join(home, "opencode.json"), pluginDirectory: path.join(home, "plugin"), home });
  const config = parse(result);
  assert.equal(config.plugins.length, 2);
  assert.equal(config.plugins[0], "unrelated");
  assert.deepEqual(config.plugins[1].options, { workflow: "all-agents", runtime: "auto", planningAgents: ["plan", "design"] });
});

test("a UTF-8 BOM is retained so Windows editors can still read the config", async t => {
  const home = await sandbox(t);
  const result = await editConfig('\ufeff{\n  "plugins": []\n}\n', {
    configPath: path.join(home, "opencode.jsonc"), pluginDirectory: path.join(home, "plugin"), home,
  });
  assert.ok(result.startsWith("\ufeff"));
  assert.equal(parse(result.slice(1)).plugins.length, 1);
});

test("an old local checkout is recognized by package identity, not a guessed folder name", async t => {
  const home = await sandbox(t);
  const old = path.join(home, "custom old checkout");
  await mkdir(old);
  await writeFile(path.join(old, "package.json"), JSON.stringify({ name: "@plannotator/opencode" }));
  const result = await editConfig(JSON.stringify({ plugins: ["./custom old checkout"] }), {
    configPath: path.join(home, "opencode.json"), pluginDirectory: path.join(home, "new"), home,
  });
  assert.equal(parse(result).plugins.length, 1);
  assert.equal(parse(result).plugins[0].package, pathToFileURL(path.join(home, "new")).href);
});

test("rerunning is a no-op and never overwrites the original config backup", async t => {
  const home = await sandbox(t);
  const configPath = path.join(home, "opencode.jsonc");
  const source = '{\n  // an unrelated setting\n  "model": "test/model"\n}\n';
  await writeFile(configPath, source);
  const pluginDirectory = path.join(home, "plugin");
  await fakePlugin(pluginDirectory);
  const first = await configurePlugin({ configPath, pluginDirectory, home });
  assert.equal(await readFile(first.backup, "utf8"), source);
  const installed = await readFile(configPath, "utf8");
  const second = await configurePlugin({ configPath, pluginDirectory, home });
  assert.equal(second.changed, false);
  assert.equal(await readFile(configPath, "utf8"), installed);
  assert.equal(await readFile(first.backup, "utf8"), source);
  assert.equal((await readdir(home)).some(file => file.endsWith(".tmp")), false);
});

for (const source of ['{ "plugins": [ }', '{ "plugins": "wrong" }', '{ "plugins": [{ "package": "@plannotator/opencode", "options": null }] }']) {
  test(`invalid config is left byte-for-byte intact: ${source}`, async t => {
    const home = await sandbox(t);
    const configPath = path.join(home, "opencode.jsonc");
    await writeFile(configPath, source);
    const pluginDirectory = path.join(home, "plugin");
    await fakePlugin(pluginDirectory);
    await assert.rejects(configurePlugin({ configPath, pluginDirectory, home }), /config|array|options/i);
    assert.equal(await readFile(configPath, "utf8"), source);
    assert.equal((await readdir(home)).some(file => file.endsWith(".bak")), false);
  });
}

test("a missing build never replaces a working configuration", async t => {
  const home = await sandbox(t);
  const configPath = path.join(home, "opencode.jsonc");
  await writeFile(configPath, "{}\n");
  await assert.rejects(configurePlugin({ configPath, pluginDirectory: path.join(home, "not-built"), home }));
  assert.equal(await readFile(configPath, "utf8"), "{}\n");
});

test("config discovery honors an existing JSON file, XDG and an explicit target without guessing between two files", async t => {
  const home = await sandbox(t);
  const env = { XDG_CONFIG_HOME: path.join(home, "xdg") };
  const json = path.join(env.XDG_CONFIG_HOME, "opencode", "opencode.json");
  await mkdir(path.dirname(json), { recursive: true });
  await writeFile(json, "{}");
  assert.equal(await selectConfig({ env, home }), json);
  await writeFile(json + "c", "{}");
  await assert.rejects(selectConfig({ env, home }), /Both/);
  assert.equal(await selectConfig({ env: { ...env, OPENCODE_PLANNOTATOR_CONFIG: json }, home }), json);
});

test("dotfile symlinks survive configuration updates", { skip: process.platform === "win32" }, async t => {
  const home = await sandbox(t);
  const target = path.join(home, "dotfiles.jsonc");
  const configPath = path.join(home, "opencode.jsonc");
  await writeFile(target, "{}\n");
  await symlink(target, configPath);
  const pluginDirectory = path.join(home, "plugin");
  await fakePlugin(pluginDirectory);
  await configurePlugin({ configPath, pluginDirectory, home });
  assert.equal((await lstat(configPath)).isSymbolicLink(), true);
  assert.equal(parse(await readFile(target, "utf8")).plugins.length, 1);
});
