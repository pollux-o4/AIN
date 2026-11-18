import { z } from "zod";
import { historySchema } from "../../../contracts/history.mjs";
import { type Direction, designViewSchema } from "../../../contracts/writing-modes.mjs";

const timestamp = z.number();
const eventSchema = z.object({
  at: timestamp,
  label: z.string(),
  revision: z.number(),
  reason: z.string().optional(),
});
const pipelineSchema = z.object({
  stage: z.string(),
  name: z.string(),
  status: z.enum(["done", "active", "paused", "failed", "pending"]),
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
});
const runSchema = z.object({
  id: z.string(),
  version: z.number(),
  revision: z.number(),
  idea: z.string(),
  title: z.string(),
  status: z.string(),
  issue: z.string().nullish(),
  text: z.string(),
  textRevision: z.number().nullable(),
  findings: z.array(z.string()),
  unmetRequirements: z.array(z.string()).default([]),
  requirements: z.array(z.string()).default([]),
  brief: z
    .object({
      intent: z.string(),
      level: z.string().optional(),
      priorities: z.array(z.string()).optional(),
      preserve: z.array(z.string()).optional(),
      assumptions: z.array(z.string()).optional(),
      requirementChanges: z.array(z.string()).optional(),
      target: z.string().optional(),
      approvedBy: z.string().optional(),
    })
    .nullish(),
  previous: z.array(z.object({ revision: z.number(), text: z.string() })),
  canDownload: z.boolean(),
  canFeedback: z.boolean(),
  needsCompletion: z.boolean(),
  completionReason: z.string().nullable(),
  canCompleteRequirements: z.boolean(),
  canSatisfy: z.boolean(),
  canAuthorizePublication: z.boolean(),
  canApproveBrief: z.boolean().default(false),
  // 시각자료(선택 단계) · 이전 서버 응답에는 없으므로 기본값 · FIGURE-001
  figure: z
    .object({
      phase: z.enum(["propose", "choose", "generate", "review", "confirmed"]),
      note: z.string().nullable().default(null),
      candidates: z.array(
        z.object({
          id: z.string(),
          anchor: z.string(),
          claim: z.string(),
          section: z.string().nullable(),
        }),
      ),
      selected: z.array(z.string()),
      coverage: z
        .object({
          units: z.number(),
          withFigure: z.number(),
          candidates: z.number(),
          gap: z.string().nullable(),
        })
        .nullable()
        .default(null),
      current: z.object({ id: z.string(), pass: z.string() }).nullable().default(null),
      items: z.array(
        z.object({
          id: z.string(),
          anchor: z.string(),
          claim: z.string(),
          alt: z.string(),
          caption: z.string().nullable(),
        }),
      ),
    })
    .nullish()
    .default(null),
  canRequestFigures: z.boolean().default(false),
  canSelectFigures: z.boolean().default(false),
  canConfirmFigures: z.boolean().default(false),
  canDiscardFigures: z.boolean().default(false),
  archived: z.boolean().default(false),
  // 이전 서버 응답에도 화면이 깨지지 않게 기본값을 둔다.
  design: designViewSchema.catch({
    mode: null,
    modeBy: null,
    readerLevel: null,
    levelBy: null,
    sections: [],
  }),
  artifacts: z.array(
    z.object({
      stage: z.string(),
      name: z.string(),
      revision: z.number(),
      reusedFromRevision: z.number().optional(),
      output: z.record(z.string(), z.unknown()),
    }),
  ),
  model: z.string(),
  callsUsed: z.number(),
  maxCalls: z.number(),
  appliedOperations: z.array(z.string()),
  monitor: z.object({
    kind: z.string(),
    label: z.string(),
    now: timestamp,
    lastConfirmedAt: timestamp.nullable(),
    executionId: z.string().nullable(),
    canPause: z.boolean(),
    canResume: z.boolean(),
    resumeLabel: z.string(),
    needsAiAttention: z.boolean(),
    events: z.array(eventSchema),
    pipeline: z.array(pipelineSchema),
  }),
});
const viewSchema = runSchema.extend({
  html: z.string(),
  executionLinks: z.array(z.object({ id: z.string(), url: z.string() })),
});
const recentSchema = z.object({
  runs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      revision: z.number(),
      status: z.string(),
      label: z.string(),
      updatedAt: z.number().nullish(),
    }),
  ),
});
export type WritingJourneyEntry = z.infer<typeof historySchema>["journey"][number];
export type HistoryRecord = z.infer<typeof historySchema>["records"][number];
export type Usage = z.infer<typeof historySchema>["usage"];
export type Run = z.infer<typeof viewSchema>;
export type { Direction };
export type Design = Run["design"];
export type Figure = NonNullable<Run["figure"]>;
export const figureUrl = (run: Run, id: string) =>
  `/write/api/runs/${run.id}/figures/${id}?v=${run.version}`;
export type RecentRun = z.infer<typeof recentSchema>["runs"][number];
export type BriefEdit = {
  intent?: string;
  target?: "audience" | "value" | "outline" | "draft";
  priorities?: string[];
  preserve?: string[];
};
export type ActionCommand =
  | { type: "feedback" | "revise_brief"; feedback: string }
  | { type: "approve_brief"; edit?: BriefEdit }
  | { type: "select_figures"; figures: string[] }
  | { type: "confirm_figures"; figures?: string[] }
  | { type: "request_figures"; feedback?: string }
  | {
      type:
        | "pause"
        | "resume"
        | "complete_requirements"
        | "satisfy"
        | "authorize_publication"
        | "discard_figures";
    };
export type Action = ActionCommand & {
  operationId: string;
  expectedVersion: number;
};
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";

let session: Promise<void> | undefined;
function initializeSession() {
  session ??= (async () => {
    let response: Response;
    try {
      response = await fetch("/write/session", { credentials: "same-origin" });
    } catch {
      throw new ApiError("글쓰기 서비스에 연결하지 못했습니다.");
    }
    if (!response.ok)
      throw new ApiError(
        "글쓰기 화면 인증을 확인하지 못했습니다. 다시 시도해 주세요.",
        response.status,
      );
  })().catch((error: unknown) => {
    session = undefined;
    throw error;
  });
  return session;
}
async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  await initializeSession();
  let response: Response;
  try {
    response = await fetch(`/write/api/${path}`, {
      credentials: "same-origin",
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  } catch {
    throw new ApiError("글쓰기 서비스에 연결하지 못했습니다.");
  }
  const data: unknown = await response.json().catch(() => {
    throw new ApiError("서버 응답을 확인하지 못했습니다.");
  });
  if (!response.ok) {
    const result = z.object({ error: z.string().optional() }).safeParse(data);
    throw new ApiError(
      result.success ? (result.data.error ?? "연결을 확인해 주세요.") : "연결을 확인해 주세요.",
      response.status,
    );
  }
  const result = schema.safeParse(data);
  if (!result.success) throw new ApiError("서버 응답을 확인하지 못했습니다.");
  return result.data;
}
export const api = {
  history: (id: string) => request(`runs/${id}/history`, historySchema),
  list: () => request("runs", recentSchema),
  load: (id: string) => request(`runs/${id}`, viewSchema),
  create: (body: { requestId: string; idea: string; source: string; direction: Direction }) =>
    request("runs", runSchema, body),
  action: (id: string, body: Action) => request(`runs/${id}/actions`, runSchema, body),
  archive: (id: string) =>
    request(`runs/${id}/archive`, z.object({ id: z.string(), archived: z.literal(true) }), {}),
  restore: (id: string) =>
    request(`runs/${id}/restore`, z.object({ id: z.string(), archived: z.literal(false) }), {}),
};
