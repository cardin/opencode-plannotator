import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { root } from "./fetch-upstream.mjs";

const directory = path.join(root, ".build", "package");
const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
if (manifest.scripts.prepublishOnly || manifest.scripts.prepare || manifest.scripts.prepack) {
  throw new Error("Refusing to pack a package with build lifecycle hooks.");
}
const destination = path.join(root, "artifacts");
await mkdir(destination, { recursive: true });
// Call npm's JS entrypoint directly: works on Windows without shell interpolation.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this script using npm run package.");
const packed = spawnSync(process.execPath, [
  npmCli, "pack", "--ignore-scripts", "--pack-destination", destination,
], { cwd: directory, stdio: "inherit" });
if (packed.error) throw packed.error;
process.exitCode = packed.status ?? 1;
