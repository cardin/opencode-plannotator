export type TuiQueueState = "queued" | "running" | "settled" | "canceled";

export interface TuiReviewRequest {
  id: string;
  sessionID: string;
  planPath: string;
  resultPath: string;
  createdAt: number;
}

export interface QueuedTuiReview extends TuiReviewRequest {
  state: TuiQueueState;
  reason?: string;
}

/** One terminal: requests are processed in arrival order. */
export class TuiQueue {
  private readonly entries: QueuedTuiReview[] = [];

  enqueue(request: TuiReviewRequest): QueuedTuiReview {
    const entry: QueuedTuiReview = { ...request, state: "queued" };
    this.entries.push(entry);
    return entry;
  }

  take(): QueuedTuiReview | undefined {
    if (this.entries.some((entry) => entry.state === "running")) return undefined;
    const next = this.entries.find((entry) => entry.state === "queued");
    if (next) next.state = "running";
    return next;
  }

  get(id: string): QueuedTuiReview | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  settle(id: string): void {
    const entry = this.get(id);
    if (entry && entry.state !== "canceled") entry.state = "settled";
  }

  cancel(id: string, reason?: string): void {
    const entry = this.get(id);
    if (!entry || entry.state === "settled" || entry.state === "canceled") return;
    entry.state = "canceled";
    entry.reason = reason;
  }

  prune(): void {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (["settled", "canceled"].includes(this.entries[index].state)) this.entries.splice(index, 1);
    }
  }

  get size(): number {
    return this.entries.length;
  }
}
