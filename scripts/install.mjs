// Standalone bootstrap: built-in Node modules only. The Bash and PowerShell
// entry points download this file before a checkout or npm install exists.
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPOSITORY = "https://github.com/cardin/opencode-plannotator.git";

export function defaultInstallDirectory({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const base = platform === "win32"
    ? env.LOCALAPPDATA || path.join(home, "AppData", "Local")
    : env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.resolve(env.OPENCODE_PLANNOTATOR_INSTALL_DIR || path.join(base, "opencode-plannotator"));
}

export function commandRunner({ env = process.env, platform = process.platform } = {}) {
  return (command, args, { cwd, capture = false } = {}) => {
    let executable = command;
    let arguments_ = args;
    // npm is a .cmd file on Windows. Only fixed npm subcommands/flags enter
    // cmd.exe; user paths are passed as cwd, never interpolated into a shell.
    if (platform === "win32" && command === "npm") {
      if (!args.every(value => /^[a-z-]+$/i.test(value))) throw new Error("Unsafe npm arguments.");
      executable = env.ComSpec || "cmd.exe";
      arguments_ = ["/d", "/s", "/c", "npm.cmd " + args.join(" ")];
    }
    const result = spawnSync(executable, arguments_, {
      cwd, env, encoding: "utf8", windowsHide: true,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? result.signal}). ${capture ? result.stderr?.trim() || "" : ""}`);
    return result.stdout?.trim() || "";
  };
}

async function exists(file) {
  try { await access(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

export async function install({
  env = process.env, home = os.homedir(), platform = process.platform,
  repository = REPOSITORY, run = commandRunner({ env, platform }), log = console.log,
} = {}) {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Install Node.js 22 or newer first.");
  run("git", ["--version"], { capture: true });
  run("npm", ["--version"], { capture: true });
  try { run(env.PLANNOTATOR_BIN?.trim() || "plannotator", ["--version"], { capture: true }); }
  catch { throw new Error("Install the plannotator binary first: https://github.com/backnotprop/plannotator#install"); }

  const directory = defaultInstallDirectory({ env, home, platform });
  log(`Installing the Plannotator patch in ${directory}`);
  if (await exists(directory)) {
    if (!await exists(path.join(directory, ".git"))) {
      throw new Error(`Installation directory already exists and is not this repository: ${directory}`);
    }
    const origin = run("git", ["remote", "get-url", "origin"], { cwd: directory, capture: true });
    if (origin.replace(/\.git$/, "") !== repository.replace(/\.git$/, "")) {
      throw new Error("Existing checkout has a different origin. It was not changed.");
    }
    if (run("git", ["status", "--porcelain"], { cwd: directory, capture: true })) {
      throw new Error("The installation checkout has local changes. Commit or move them before rerunning the installer; nothing was discarded.");
    }
    if (run("git", ["branch", "--show-current"], { cwd: directory, capture: true }) !== "main") {
      throw new Error("The installation checkout is not on main. Switch it to main before updating.");
    }
    run("git", ["pull", "--ff-only", "origin", "main"], { cwd: directory });
  } else {
    await mkdir(path.dirname(directory), { recursive: true });
    run("git", ["clone", "--depth", "1", "--branch", "main", repository, directory]);
  }
  const project = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  if (project.name !== "opencode-plannotator-patch") throw new Error("Unexpected repository package; refusing to build it.");
  run("npm", ["ci", "--ignore-scripts"], { cwd: directory });
  run("npm", ["run", "assemble"], { cwd: directory });

  const { configurePlugin, selectConfig } = await import(pathToFileURL(path.join(directory, "scripts", "configure.mjs")));
  const configPath = await selectConfig({ env, home });
  const result = await configurePlugin({
    configPath, pluginDirectory: path.join(directory, ".build", "package"), home,
  });
  log(result.changed ? `Updated ${configPath}` : `Already configured in ${configPath}`);
  if (result.backup) log(`Original config backup: ${result.backup}`);
  log("Installed. runtime: auto (browser first, terminal/headless fallback); existing plugin options were preserved.");
  log("Run /reload in OpenCode if it is already open. Install plannotator-tui 0.9.9+ only if you want terminal review.");
  return { directory, ...result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await install(); }
  catch (error) { console.error(`Installation failed: ${error.message}`); process.exitCode = 1; }
}
