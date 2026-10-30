import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const [directory, scenario] = process.argv.slice(2);
const scratch = process.env.TEST_SCRATCH;
const log = path.join(scratch, "review-log.jsonl");
const events = [];

async function executable(file, body) {
  await writeFile(file, `#!${process.execPath}\n${body}\n`);
  await chmod(file, 0o755);
}

await executable(process.env.PLANNOTATOR_TUI_BIN, `
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  console.log("plannotator-tui ${scenario === "stale" ? "0.9.4" : "0.9.9"}");
} else {
  const args = process.argv.slice(2);
  if (!args.includes("--gate") || !args.includes("--json")) process.exit(81);
  const plan = fs.readFileSync(args[0], "utf8");
  const result = args[args.indexOf("--result-file") + 1];
  const logfile = ${JSON.stringify(log)};
  const count = fs.existsSync(logfile) ? fs.readFileSync(logfile, "utf8").trim().split("\\n").length : 0;
  fs.appendFileSync(logfile, JSON.stringify({ plan, args }) + "\\n");
  if (${JSON.stringify(scenario)} === "cancel") {
    process.on("SIGTERM", () => { fs.writeFileSync(logfile + ".terminated", "yes"); process.exit(0); });
    setInterval(() => {}, 1000);
  } else {
    fs.writeFileSync(result, JSON.stringify(count === 0
      ? { decision: "feedback", feedback: "Use safe mode" }
      : { decision: "approved", feedback: "Keep the tests" }));
  }
}
`);
await executable(process.env.PLANNOTATOR_BIN, `
const fs = require("node:fs");
if (${JSON.stringify(scenario)} !== "cli") process.exit(82);
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const data = JSON.parse(input);
  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ plan: data.plan }));
  console.log(JSON.stringify({ approved: true, feedback: "CLI branch preserved", agentSwitch: "build" }));
});
`);

const { default: server } = await import(pathToFileURL(path.join(directory, "dist", "server.js")));
const { default: tui } = await import(pathToFileURL(path.join(directory, "dist", "tui.js")));
assert.equal(server.id, "plannotator");
const tools = new Map();
const location = { directory: scratch, project: { id: "test", directory: scratch, canonical: scratch } };
let handlers;
const ctx = {
  options: { workflow: "all-agents", runtime: scenario === "cli" ? "cli" : "tui" },
  agent: { list: async () => ({ data: [{ name: "plan", mode: "primary" }, { name: "build", mode: "primary" }] }) },
  rpc: { register: async (_definition, implementation) => {
    handlers = implementation;
    return { dispose: async () => {} };
  } },
  tool: { transform: async callback => {
    callback({ add: definition => tools.set(definition.name, definition) });
    return { dispose: async () => {} };
  } },
  session: {
    get: async () => ({ location }),
    switchAgent: async input => { events.push(`agent:${input.agent}`); },
  },
};
const cleanup = await server.setup(ctx);
assert.ok(handlers, "the patched setup must register the terminal RPC");
const tool = tools.get("submit_plan");
assert.ok(tool);
let cleanupTui;
const controller = new AbortController();
let cancelChild;

try {
  if (scenario !== "cli" && scenario !== "stale") {
    cleanupTui = tui.setup({
      client: { rpc: () => handlers }, location,
      data: { session: { get: () => ({ location }) }, location: { default: () => location } },
      ui: {
        router: { current: () => ({ type: "session", sessionID: "ses_test" }) },
        dialog: { clear: () => {} },
        toast: { show: () => {} },
      },
      renderer: {
        suspend: async () => events.push("suspend"),
        resume: async () => events.push("resume"),
        requestRender: () => events.push("render"),
      },
    });
  }
  const invoke = edits => tool.execute({ edits }, { sessionID: "ses_test", agent: "plan", signal: controller.signal });

  if (scenario === "feedback") {
    const first = await invoke([{ start: 1, content: "# Plan\nUnsafe step" }]);
    assert.match(first.content, /Use safe mode/);
    assert.match(first.content, /Current Plan \(2 lines\)/);
    const second = await invoke([{ start: 2, end: 2, content: "Safe step" }]);
    assert.match(second.content, /approved/i);
    assert.match(second.content, /Keep the tests/);
    const plans = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line).plan);
    assert.deepEqual(plans, ["# Plan\nUnsafe step", "# Plan\nSafe step"]);
    await setImmediate();
    assert.deepEqual(events.filter(event => event === "suspend" || event === "resume"), ["suspend", "resume", "suspend", "resume"]);
    assert.equal(events.includes("agent:build"), false, "a terminal decision selects no agent; upstream keeps the current one");
  } else if (scenario === "cli") {
    const result = await invoke([{ start: 1, content: "# Browser fallback" }]);
    assert.match(result.content, /CLI branch preserved/);
    assert.equal(JSON.parse(await readFile(log, "utf8")).plan, "# Browser fallback");
    assert.deepEqual(events.filter(event => event === "suspend"), []);
    assert.ok(events.includes("agent:build"), "the unchanged CLI decision can still request an agent handoff");
  } else if (scenario === "stale") {
    const result = await invoke([{ start: 1, content: "# Do not launch an old reviewer" }]);
    assert.match(result.content, /0\.9\.4.*0\.9\.9/s);
    assert.equal(existsSync(log), false);
  } else if (scenario === "cancel") {
    // Trigger cancellation only after the fake child starts, not before pickup.
    cancelChild = setInterval(() => {
      if (existsSync(log)) controller.abort();
    }, 20);
    await assert.rejects(invoke([{ start: 1, content: "# Cancel me" }]), /abort/i);
    clearInterval(cancelChild);
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => { clearInterval(check); reject(new Error("Canceled reviewer was not terminated")); }, 3000);
      const check = setInterval(() => {
        if (existsSync(log + ".terminated")) {
          clearInterval(check); clearTimeout(deadline); resolve();
        }
      }, 20);
    });
  }
  console.log("SMOKE_OK", scenario);
} finally {
  if (cancelChild) clearInterval(cancelChild);
  cleanupTui?.();
  cleanup?.();
}
