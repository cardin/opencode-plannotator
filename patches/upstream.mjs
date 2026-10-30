// Exact edits against the integrity-pinned, unminified npm bundles. Every
// anchor must occur once; an upstream layout change stops the assembly.
export function upstreamPatches(packageName) {
  const shared = [
    {
      label: "accept the terminal runtime",
      before: 'var RUNTIMES = new Set(["auto", "embedded", "cli"]);',
      after: 'var RUNTIMES = new Set(["auto", "embedded", "cli", "tui"]);',
    },
    {
      label: "recognize the replacement package for Inbox version reporting",
      before: 'if (pkg.name === "@plannotator/opencode")',
      after: `if (pkg.name === "@plannotator/opencode" || pkg.name === ${JSON.stringify(packageName)})`,
    },
  ];
  const terminalReview = `  if (await shouldUseTuiRuntime(input.runtime)) {
    return await runTuiPlanReview({
      planContent: input.planContent,
      sessionID: input.sessionID,
      timeoutSeconds: input.timeoutSeconds,
      abortSignal: input.abortSignal
    });
  }
`;
  return [
    {
      file: "dist/server.js",
      imports: 'import { registerTuiRpc, runTuiPlanReview, shouldUseTuiRuntime } from "./tui-runtime.js";',
      changes: [
        ...shared,
        {
          label: "register the terminal RPC",
          before: "    const workflowOptions = normalizeWorkflowOptions(ctx.options);",
          after: `    const workflowOptions = normalizeWorkflowOptions(ctx.options);
    if (typeof ctx.rpc?.register === "function") {
      try {
        await registerTuiRpc(ctx.rpc);
      } catch (error) {
        console.error("[Plannotator] Could not register the terminal-review RPC:", error);
      }
    }`,
        },
        {
          label: "forward cancellation to the plan executor",
          before: "              sessionId: toolContext.sessionID,\n              directory,",
          after: "              sessionId: toolContext.sessionID,\n              abortSignal: toolContext.signal,\n              directory,",
        },
        {
          label: "forward the session and cancellation to the review runtime",
          before: `              reviewPlan: async ({ planContent }) => await runPlanReview({
                client,
                runtime: workflowOptions.runtime,
                planContent,`,
          after: `              reviewPlan: async ({ planContent, abortSignal }) => await runPlanReview({
                client,
                runtime: workflowOptions.runtime,
                planContent,
                sessionID: toolContext.sessionID,
                abortSignal,`,
        },
        {
          label: "route terminal plans without replacing the upstream executor",
          before: "async function runPlanReview(input) {\n",
          after: "async function runPlanReview(input) {\n" + terminalReview,
        },
      ],
    },
    {
      file: "dist/index.js",
      imports: 'import { runTuiPlanReview, shouldUseTuiRuntime } from "./tui-runtime.js";',
      changes: [
        ...shared,
        {
          label: "forward the legacy session to the runtime",
          before: "              runtime: workflowOptions.runtime,\n              planContent,",
          after: "              runtime: workflowOptions.runtime,\n              planContent,\n              sessionID: context.sessionID,",
        },
        {
          label: "fail explicitly when terminal mode is requested on a legacy host",
          before: "async function runPlanReview(input) {\n  input.abortSignal.throwIfAborted();\n",
          after: "async function runPlanReview(input) {\n  input.abortSignal.throwIfAborted();\n" + terminalReview,
        },
      ],
    },
  ];
}
