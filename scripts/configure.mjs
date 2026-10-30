import { applyEdits, modify, parse, printParseErrorCode } from "jsonc-parser";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageNames = ["@plannotator/opencode", "@cardinal4/opencode-plannotator"];

async function exists(file) {
  try { await stat(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

export async function selectConfig({ env = process.env, home = os.homedir() } = {}) {
  if (env.OPENCODE_PLANNOTATOR_CONFIG) return path.resolve(env.OPENCODE_PLANNOTATOR_CONFIG);
  const directory = path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "opencode");
  const jsonc = path.join(directory, "opencode.jsonc");
  const json = path.join(directory, "opencode.json");
  const [hasJsonc, hasJson] = await Promise.all([exists(jsonc), exists(json)]);
  if (hasJsonc && hasJson) {
    throw new Error("Both opencode.json and opencode.jsonc exist. Set OPENCODE_PLANNOTATOR_CONFIG to the file you want to update.");
  }
  return hasJson ? json : jsonc;
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function isPlannotator(entry, configDirectory, pluginDirectory, home) {
  const spec = typeof entry === "string" ? entry : Array.isArray(entry) ? entry[0] : entry?.package;
  if (typeof spec !== "string") return false;
  if (packageNames.some(name => spec === name || spec.startsWith(name + "@"))) return true;
  if (!/^(file:|\.{1,2}[\\/]|[\\/]|~[\\/]|[A-Za-z]:[\\/])/.test(spec)) return false;
  let directory;
  try {
    directory = spec.startsWith("file:") ? fileURLToPath(spec)
      : path.resolve(configDirectory, spec.replace(/^~[\\/]/, home + path.sep));
    if (path.resolve(directory) === path.resolve(pluginDirectory)) return true;
    const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    return packageNames.includes(pkg.name);
  } catch { return false; }
}

export async function editConfig(source, { configPath, pluginDirectory, home = os.homedir() }) {
  const bom = source.startsWith("\ufeff") ? "\ufeff" : "";
  if (bom) source = source.slice(1);
  if (!source.trim()) source = "{}\n";
  const errors = [];
  const config = parse(source, errors, { allowTrailingComma: true, allowEmptyContent: false });
  if (errors.length) {
    throw new Error(`Invalid OpenCode config: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}. Nothing was changed.`);
  }
  if (!object(config)) throw new Error("OpenCode config must be an object. Nothing was changed.");
  if (config.plugins !== undefined && !Array.isArray(config.plugins)) {
    throw new Error("OpenCode plugins must be an array. Nothing was changed.");
  }
  const directory = path.dirname(configPath);
  const matches = [];
  for (const [index, entry] of (config.plugins || []).entries()) {
    if (await isPlannotator(entry, directory, pluginDirectory, home)) matches.push(index);
  }
  const legacy = Array.isArray(config.plugin) ? config.plugin : config.plugin ? [config.plugin] : [];
  for (const entry of legacy) {
    if (await isPlannotator(entry, directory, pluginDirectory, home)) {
      throw new Error("Plannotator is configured in the legacy plugin field. Move it to the V2 plugins array before running this installer. Nothing was changed.");
    }
  }
  const options = { workflow: "all-agents", runtime: "auto" };
  for (const index of matches) {
    const entry = config.plugins[index];
    if (typeof entry === "string") continue;
    const existing = Array.isArray(entry) ? entry[1] : entry.options;
    if (existing === undefined) continue;
    if (!object(existing)) throw new Error("Existing Plannotator options must be an object. Nothing was changed.");
    Object.assign(options, existing);
  }
  const indentation = /\n([\t ]+)\S/.exec(source)?.[1];
  const formattingOptions = {
    insertSpaces: !indentation?.includes("\t"), tabSize: indentation?.length || 2,
    eol: source.includes("\r\n") ? "\r\n" : "\n",
  };
  let result = source;
  const set = (location, value) => {
    result = applyEdits(result, modify(result, location, value, { formattingOptions }));
  };
  if (!config.$schema) set(["$schema"], "https://opencode.ai/config.json");
  const pluginUrl = pathToFileURL(path.resolve(pluginDirectory)).href;
  if (!matches.length) {
    if (!config.plugins) set(["plugins"], [{ package: pluginUrl, options }]);
    else set(["plugins", -1], { package: pluginUrl, options });
  } else {
    const first = matches[0];
    // Remove duplicates back-to-front; update individual fields so comments
    // and options on the entry we keep are not replaced by a whole-array edit.
    for (const index of matches.slice(1).reverse()) set(["plugins", index], undefined);
    if (typeof config.plugins[first] === "string" || Array.isArray(config.plugins[first])) {
      set(["plugins", first], { package: pluginUrl, options });
    } else {
      if (config.plugins[first].package !== pluginUrl) set(["plugins", first, "package"], pluginUrl);
      for (const [key, value] of Object.entries(options)) {
        if (JSON.stringify(config.plugins[first].options?.[key]) !== JSON.stringify(value)) {
          set(["plugins", first, "options", key], value);
        }
      }
    }
  }
  return bom + result;
}

export async function configurePlugin({ configPath, pluginDirectory, home = os.homedir() }) {
  const pkg = JSON.parse(await readFile(path.join(pluginDirectory, "package.json"), "utf8"));
  if (pkg.name !== "@cardinal4/opencode-plannotator" || !pkg.exports?.["."] || !pkg.exports?.["./tui"]) {
    throw new Error("The assembled plugin is missing or incomplete; configuration was not changed.");
  }
  for (const entry of [pkg.exports["."], pkg.exports["./tui"]]) {
    if (!await exists(path.resolve(pluginDirectory, entry))) throw new Error(`Missing plugin entry: ${entry}`);
  }
  const existed = await exists(configPath);
  // Preserve dotfile symlinks by updating their target, not replacing the link.
  const destination = existed ? await realpath(configPath) : path.resolve(configPath);
  const source = existed ? await readFile(destination, "utf8") : "{}\n";
  const content = await editConfig(source, { configPath, pluginDirectory, home });
  if (source === content) return { configPath, changed: false };
  const backup = existed ? destination + ".plannotator-patch.bak" : undefined;
  if (backup) {
    try { await copyFile(destination, backup, constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    const mode = existed ? (await stat(destination)).mode & 0o777 : 0o600;
    await writeFile(temporary, content, { flag: "wx", mode });
    if (existed && await readFile(destination, "utf8") !== source) {
      throw new Error("OpenCode config changed during installation; refusing to overwrite it.");
    }
    if (!existed && await exists(destination)) throw new Error("OpenCode config was created during installation; refusing to overwrite it.");
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return { configPath, backup, changed: true };
}
