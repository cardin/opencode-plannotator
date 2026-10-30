import { build } from "esbuild";
import assert from "node:assert/strict";
import { test } from "node:test";
import { root } from "../scripts/fetch-upstream.mjs";

async function sourceModule(file) {
  const result = await build({
    absWorkingDir: root, entryPoints: [`src/${file}.ts`], bundle: true,
    format: "esm", platform: "node", target: "node22", write: false,
  });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}

test("old or prerelease reviewers cannot enter a gate they cannot complete", async () => {
  const { isSupportedTuiVersion, tuiTooOldMessage } = await sourceModule("tui-guard");
  assert.equal(isSupportedTuiVersion("plannotator-tui 0.9.4"), false);
  assert.equal(isSupportedTuiVersion("0.9.9-rc1"), false);
  assert.equal(isSupportedTuiVersion("unparseable"), false);
  assert.equal(isSupportedTuiVersion("plannotator-tui 0.9.9"), true);
  assert.equal(isSupportedTuiVersion("v0.10.0"), true);
  assert.match(tuiTooOldMessage("0.9.4"), /0\.9\.4.*0\.9\.9/s);
});

test("auto mode preserves a local browser unless the environment is headless", async () => {
  const { isHeadless } = await sourceModule("tui-guard");
  assert.equal(isHeadless({ DISPLAY: ":0" }, "linux"), false);
  assert.equal(isHeadless({}, "linux"), true);
  assert.equal(isHeadless({ CI: "true", DISPLAY: ":0" }, "linux"), true);
  assert.equal(isHeadless({ PLANNOTATOR_REMOTE: "0", DISPLAY: ":0" }, "linux"), false);
  assert.equal(isHeadless({ PLANNOTATOR_REMOTE: "1", DISPLAY: ":0" }, "linux"), true);
  assert.equal(isHeadless({ SSH_CONNECTION: "test" }, "darwin"), true);
  assert.equal(isHeadless({ SSH_CONNECTION: "test", DISPLAY: ":0" }, "darwin"), false);
});

test("the next queued reviewer cannot take over a running terminal", async () => {
  const { TuiQueue } = await sourceModule("tui-queue");
  const queue = new TuiQueue();
  for (const id of ["first", "second", "third"]) {
    queue.enqueue({ id, sessionID: "test", planPath: "unused", resultPath: "unused", createdAt: 0 });
  }
  assert.equal(queue.take().id, "first");
  assert.equal(queue.take(), undefined);
  queue.cancel("first", "aborted");
  assert.equal(queue.take().id, "second");
  queue.settle("second");
  queue.prune();
  assert.equal(queue.size, 1);
  assert.equal(queue.take().id, "third");
});
