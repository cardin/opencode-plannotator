import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PlannotatorTuiRpc, type PendingPlanReview } from "./tui-contract";
import { isHeadless, tuiTooOldMessage } from "./tui-guard";
import { probeTui } from "./tui-probe";
import { TuiQueue, type QueuedTuiReview } from "./tui-queue";

type RuntimeMode = "auto" | "embedded" | "cli" | "tui";

export interface TuiPlanReviewResult {
  approved: boolean;
  feedback?: string;
}

export interface TuiReviewInput {
  planContent: string;
  sessionID: string;
  timeoutSeconds: number | null;
  abortSignal?: AbortSignal;
}

const PICKUP_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 4 * 24 * 60 * 60 * 1000;
const queue = new TuiQueue();
const waiters = new Map<string, Waiter>();
let tuiLoaded = false;

interface Waiter {
  entry: QueuedTuiReview;
  resolve: (result: TuiPlanReviewResult) => void;
  reject: (error: Error) => void;
  deadline: ReturnType<typeof setTimeout>;
  pickup: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortListener?: () => void;
  settled: boolean;
}

export async function shouldUseTuiRuntime(
  runtime: RuntimeMode,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (runtime === "tui") return true;
  if (runtime !== "auto" || !isHeadless(env)) return false;
  return (await probeTui()).available;
}

function readDecision(resultPath: string): TuiPlanReviewResult {
  if (!existsSync(resultPath)) return { approved: false };
  try {
    const parsed = JSON.parse(readFileSync(resultPath, "utf8")) as { decision?: string; feedback?: string };
    return {
      approved: parsed.decision === "approved",
      ...(parsed.feedback ? { feedback: parsed.feedback } : {}),
    };
  } catch {
    return { approved: false };
  }
}

function finish(waiter: Waiter, result?: TuiPlanReviewResult, error?: Error): void {
  if (waiter.settled) return;
  waiter.settled = true;
  clearTimeout(waiter.deadline);
  clearTimeout(waiter.pickup);
  if (waiter.abortListener) waiter.signal?.removeEventListener("abort", waiter.abortListener);
  waiters.delete(waiter.entry.id);
  queue.settle(waiter.entry.id);
  queue.prune();
  if (error) waiter.reject(error);
  else waiter.resolve(result ?? { approved: false });
}

function cancel(id: string, message: string): void {
  const waiter = waiters.get(id);
  if (!waiter) return;
  queue.cancel(id, message);
  finish(waiter, undefined, new Error(message));
}

export async function runTuiPlanReview(input: TuiReviewInput): Promise<TuiPlanReviewResult> {
  input.abortSignal?.throwIfAborted();
  const probe = await probeTui();
  if (!probe.available) throw new Error(probe.reason ?? tuiTooOldMessage(undefined));
  if (!tuiLoaded) {
    throw new Error(
      "The OpenCode terminal half of the Plannotator plugin is not loaded. " +
      'Use runtime "auto" or "cli", or reload OpenCode so the ./tui entry loads.',
    );
  }
  const directory = mkdtempSync(path.join(os.tmpdir(), "plannotator-opencode-tui-"));
  const planPath = path.join(directory, "plan.md");
  const resultPath = path.join(directory, "result.json");
  writeFileSync(planPath, input.planContent, "utf8");
  const entry = queue.enqueue({
    id: randomUUID(), sessionID: input.sessionID, planPath, resultPath, createdAt: Date.now(),
  });
  const timeoutMs = input.timeoutSeconds === null
    ? DEFAULT_TIMEOUT_MS : Math.max(1, input.timeoutSeconds) * 1000;

  return await new Promise<TuiPlanReviewResult>((resolve, reject) => {
    const waiter: Waiter = {
      entry, resolve, reject,
      deadline: setTimeout(() => {
        cancel(entry.id, `[Plannotator] The terminal review timed out after ${Math.round(timeoutMs / 1000)}s.`);
      }, timeoutMs),
      pickup: setTimeout(() => {
        cancel(entry.id, "[Plannotator] The terminal review did not open. Make sure the OpenCode TUI is running with this plugin.");
      }, PICKUP_MS),
      settled: false,
      ...(input.abortSignal ? { signal: input.abortSignal } : {}),
    };
    waiters.set(entry.id, waiter);
    if (input.abortSignal) {
      const listener = (): void => cancel(entry.id, "[Plannotator] The review was cancelled.");
      waiter.abortListener = listener;
      if (input.abortSignal.aborted) listener();
      else input.abortSignal.addEventListener("abort", listener, { once: true });
    }
  });
}

interface RpcHost {
  register: (
    definition: typeof PlannotatorTuiRpc,
    handlers: Record<string, unknown>,
  ) => Promise<{ dispose: () => Promise<void> }>;
}

export async function registerTuiRpc(rpc: RpcHost): Promise<{ dispose: () => Promise<void> }> {
  return await rpc.register(PlannotatorTuiRpc, {
    async hello() {
      tuiLoaded = true;
      return { ok: true };
    },
    async pending() {
      tuiLoaded = true;
      const entry = queue.take();
      if (entry) {
        const waiter = waiters.get(entry.id);
        if (waiter) clearTimeout(waiter.pickup);
      }
      const review: PendingPlanReview = entry
        ? { id: entry.id, sessionID: entry.sessionID, planPath: entry.planPath, resultPath: entry.resultPath }
        : { id: "", sessionID: "", planPath: "", resultPath: "" };
      return review;
    },
    async status(input: unknown) {
      const { id } = input as { id: string };
      return { state: queue.get(id)?.state ?? "unknown" };
    },
    async settle(input: unknown) {
      const { id } = input as { id: string };
      const waiter = waiters.get(id);
      const entry = queue.get(id);
      if (!waiter || !entry) return { ok: false };
      finish(waiter, readDecision(entry.resultPath));
      return { ok: true };
    },
    async fail(input: unknown) {
      const { id, message } = input as { id: string; message: string };
      const waiting = waiters.has(id);
      if (waiting) cancel(id, message);
      return { ok: waiting };
    },
  });
}
