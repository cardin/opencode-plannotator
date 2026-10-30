import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function sandbox(t) {
  const base = process.platform === "linux" ? "/tmp/opencode" : os.tmpdir();
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, "plannotator-installer-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

export async function fakePlugin(directory) {
  await mkdir(path.join(directory, "dist"), { recursive: true });
  await writeFile(path.join(directory, "package.json"), JSON.stringify({
    name: "@cardinal4/opencode-plannotator",
    exports: { ".": "./dist/server.js", "./tui": "./dist/tui.js" },
  }));
  for (const file of ["server.js", "tui.js"]) await writeFile(path.join(directory, "dist", file), "export default {};\n");
}
