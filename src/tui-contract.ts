import type { Rpc } from "@opencode/plugin/rpc";

const empty = { type: "object", properties: {}, additionalProperties: false };
const okOut = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};
const pendingOut = {
  type: "object",
  properties: {
    id: { type: "string" },
    sessionID: { type: "string" },
    planPath: { type: "string" },
    resultPath: { type: "string" },
  },
  required: ["id", "sessionID", "planPath", "resultPath"],
  additionalProperties: false,
};

// Rpc.define returns this object unchanged (SDK 2.0.32). Use its type rather
// than shipping another SDK: the contract is plain JSON Schema, with no errors.
export const PlannotatorTuiRpc = {
  id: "plannotator-opencode-tui",
  methods: {
    hello: { input: empty, output: okOut },
    pending: { input: empty, output: pendingOut },
    status: {
      input: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { state: { type: "string" } },
        required: ["state"],
        additionalProperties: false,
      },
    },
    settle: {
      input: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      output: okOut,
    },
    fail: {
      input: {
        type: "object",
        properties: { id: { type: "string" }, message: { type: "string" } },
        required: ["id", "message"],
        additionalProperties: false,
      },
      output: okOut,
    },
  },
  events: {},
} satisfies Rpc.Definition;

export interface PendingPlanReview {
  id: string;
  sessionID: string;
  planPath: string;
  resultPath: string;
}
