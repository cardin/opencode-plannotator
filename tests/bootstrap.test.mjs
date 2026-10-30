import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { sandbox } from "./helpers/sandbox.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

for (const mode of ["success", "download-error", "node-error"]) {
  test(`Bash bootstrap: ${mode}, no network or real installer`, { skip: process.platform === "win32" }, async t => {
    const directory = await sandbox(t);
    const bin = path.join(directory, "bin");
    const temp = path.join(directory, "temp");
    await mkdir(bin); await mkdir(temp);
    const curl = path.join(bin, "curl");
    await writeFile(curl, `#!${process.execPath}\nconst fs = require('node:fs');\nif (process.env.BOOTSTRAP_MODE === 'download-error') process.exit(22);\nfs.writeFileSync(process.argv[process.argv.indexOf('-o') + 1], process.env.BOOTSTRAP_CODE);\n`);
    await chmod(curl, 0o755);
    const result = spawnSync("bash", [path.join(root, "install.sh")], {
      encoding: "utf8", timeout: 10_000,
      env: {
        ...process.env, TMPDIR: temp,
        PATH: [bin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter),
        BOOTSTRAP_MODE: mode,
        BOOTSTRAP_CODE: `console.log('BOOTSTRAP_OK'); process.exit(${mode === "node-error" ? 7 : 0});`,
      },
    });
    assert.equal(result.status, mode === "download-error" ? 22 : mode === "node-error" ? 7 : 0, result.stderr);
    assert.deepEqual(await readdir(temp), []);
    if (mode !== "download-error") assert.match(result.stdout, /BOOTSTRAP_OK/);
  });
}

test("Bash bootstrap downloads and runs the real installer", { skip: process.platform === "win32" }, async t => {
  const directory = await sandbox(t);
  const server = createServer(async (request, response) => {
    if (request.url !== "/install.mjs") { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end(await readFile(path.join(root, "scripts", "install.mjs")));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await new Promise(resolve => {
    const child = spawn("bash", [path.join(root, "install.sh")], {
      env: {
        ...process.env,
        HOME: directory,
        XDG_CONFIG_HOME: path.join(directory, "config"),
        OPENCODE_PLANNOTATOR_INSTALL_MJS_URL: `http://127.0.0.1:${server.address().port}/install.mjs`,
        PLANNOTATOR_BIN: path.join(directory, "no-plannotator-here"),
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 15_000);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr + result.stdout, /Install the plannotator binary first/);
});
