import type { Plugin } from "@opencode/plugin/tui";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { PlannotatorTuiRpc, type PendingPlanReview } from "./tui-contract";
import { probeTui, tuiBinary } from "./tui-probe";

type Location = NonNullable<Plugin.Context["location"]>;
interface TuiRpc {
  hello(input: Record<string, never>, options: { location: Location }): Promise<{ ok: boolean }>;
  pending(input: Record<string, never>, options: { location: Location }): Promise<PendingPlanReview>;
  status(input: { id: string }, options: { location: Location }): Promise<{ state: string }>;
  settle(input: { id: string }, options: { location: Location }): Promise<{ ok: boolean }>;
  fail(input: { id: string; message: string }, options: { location: Location }): Promise<{ ok: boolean }>;
}
const POLL_MS = 400;

function kill(child: ChildProcess): void {
  try { child.kill("SIGTERM"); } catch { /* Already gone. */ }
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill("SIGKILL"); } catch { /* Already gone. */ }
    }
  }, 1000).unref?.();
}

// Plugin.define is an identity function. A type-only import avoids pulling a
// second SDK or its UI peers into the installed package.
export default {
  id: "plannotator-opencode.tui",
  setup(context) {
    const rpc = context.client.rpc(PlannotatorTuiRpc) as unknown as TuiRpc;
    const binary = tuiBinary();
    const toast = (message: string, variant: "info" | "error" = "info", sessionID?: string): void => {
      context.ui.toast.show({
        title: "Plannotator", message, variant, duration: variant === "error" ? 15000 : 5000,
        ...(sessionID === undefined ? {} : { sessionID }),
      });
    };
    const currentSession = (): string | undefined => {
      const route = context.ui.router.current();
      return route.type === "session" ? route.sessionID : undefined;
    };
    const locationFor = (sessionID: string): Location =>
      context.data.session.get(sessionID)?.location ?? context.location ?? context.data.location.default();

    const runReview = async (request: PendingPlanReview, location: Location): Promise<void> => {
      const probe = await probeTui(binary);
      if (!probe.available) {
        await rpc.fail({ id: request.id, message: probe.reason ?? "plannotator-tui is not usable." }, { location });
        toast(probe.reason ?? "plannotator-tui is not usable.", "error", request.sessionID);
        return;
      }
      context.ui.dialog.clear();
      await context.renderer.suspend();
      let child: ChildProcess | undefined;
      let monitor: ReturnType<typeof setInterval> | undefined;
      try {
        child = spawn(binary, [request.planPath, "--gate", "--json", "--result-file", request.resultPath], {
          stdio: "inherit", env: { ...process.env, PLANNOTATOR_TUI_BIN: binary },
        });
        monitor = setInterval(() => {
          void rpc.status({ id: request.id }, { location }).then(({ state }) => {
            // Cancellation settles/removes the server waiter, so "unknown"
            // also means this child no longer has a tool waiting for it.
            if ((state === "canceled" || state === "unknown") && child) kill(child);
          }).catch(() => { /* The server may be restarting. */ });
        }, POLL_MS);
        const code = await new Promise<number | null>((resolve) => {
          let done = false;
          const finish = (value: number | null): void => {
            if (done) return;
            done = true;
            resolve(value);
          };
          child!.once("error", (error) => {
            toast(`could not start ${binary}: ${error.message}`, "error", request.sessionID);
            finish(null);
          });
          child!.once("close", (exitCode) => finish(exitCode));
        });
        if (code !== 0 && !existsSync(request.resultPath)) {
          await rpc.fail({
            id: request.id, message: `plannotator-tui exited with code ${code ?? "?"} without a decision.`,
          }, { location });
          toast("The terminal review ended without a decision.", "error", request.sessionID);
          return;
        }
        await rpc.settle({ id: request.id }, { location });
        toast("Plan review returned to the agent.", "info", request.sessionID);
      } finally {
        if (monitor) clearInterval(monitor);
        await context.renderer.resume();
        context.renderer.requestRender();
      }
    };

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      if (stopped) return;
      try {
        const sessionID = currentSession();
        if (sessionID) {
          const location = locationFor(sessionID);
          const request = await rpc.pending({}, { location });
          if (request.id) await runReview(request, location);
        }
      } catch { /* A missing server or location mismatch is transient. */ }
      finally {
        if (!stopped) timer = setTimeout(() => void tick(), POLL_MS);
      }
    };
    void (async () => {
      try {
        const sessionID = currentSession();
        if (sessionID) await rpc.hello({}, { location: locationFor(sessionID) });
      } catch { /* The first pending call announces this half too. */ }
    })();
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  },
} satisfies Plugin.Definition;
