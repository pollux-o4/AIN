import { z } from "zod";
import { type FIGURE_REVISE_TARGETS, FIGURE_ROUTES } from "../../../contracts/figure.mjs";
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
  changes: z.array(z.object({ find: z.string(), replace: z.string() })).default([]),
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
  canApproveDesign: z.boolean().default(false),
  canReviseFigures: z.boolean().default(false),
  // 시각자료(선택 단계) · 이전 서버 응답에는 없으므로 기본값 · FIGURE-001
  figure: z
    .object({
      phase: z.enum(["propose", "choose", "compose", "design", "generate", "review", "confirmed"]),
      world: z.string().nullable().default(null),
      feedback: z.string().nullable().default(null),
      recompose: z.array(z.string()).default([]),
      note: z.string().nullable().default(null),
      candidates: z.array(
        z.object({
          id: z.string(),
          anchor: z.string(),
          claim: z.string(),
          // 그림 계획 · 이전 응답에는 없다
          reason: z.string().nullable().default(null),
          analogy: z.string().nullable().default(null),
          scene: z.string().nullable().default(null),
          mapping: z.array(z.object({ element: z.string(), concept: z.string() })).default([]),
          kind: z.string().nullable().default(null),
          motifs: z.array(z.string()).default([]),
          // 사람이 덧붙인 그림 방향 · ADR-0023
          direction: z.string().nullable().default(null),
          // 이 그림이 없으면 독자가 놓치는 것 · 실효 경로와 누가 정했는지 · ADR-0025
          without: z.string().nullable().default(null),
          route: z.enum(FIGURE_ROUTES).default("svg"),
          routeBy: z.enum(["user", "default"]).default("default"),
          section: z.string().nullable(),
        }),
      ),
      style: z
        .object({
          look: z.string().optional(),
          accent: z.string(),
          base: z.string(),
          labels: z.string(),
        })
        .nullable()
        .default(null),
      motifs: z.array(z.object({ name: z.string(), look: z.string() })).default([]),
      selected: z.array(z.string()),
      // 서버에 연결된 경로 · 없는 경로는 고를 수 없다(FIGURE-002)
      routesAvailable: z.array(z.enum(FIGURE_ROUTES)).default(["svg"]),
      coverage: z
        .object({
          units: z.number(),
          withFigure: z.number(),
          candidates: z.number(),
          gap: z.string().nullable(),
        })
        .nullable()
        .default(null),
      current: z
        .object({ ids: z.array(z.string()), pass: z.string() })
        .nullable()
        .default(null),
      items: z.array(
        z.object({
          id: z.string(),
          anchor: z.string(),
          claim: z.string(),
          alt: z.string(),
          caption: z.string().nullable(),
          route: z.enum(FIGURE_ROUTES).default("svg"),
          mime: z.string().default("image/svg+xml"),
          motion: z.boolean().default(false),
          // 위치가 있는 글자는 화면이 그림 위에 얹는다(FIGURE-002 L1)
          labels: z
            .array(
              z.object({
                text: z.string(),
                anchor: z.object({ x: z.number(), y: z.number() }).optional(),
              }),
            )
            .default([]),
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
export type FigureRoute = (typeof FIGURE_ROUTES)[number];
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
  | {
      type: "select_figures";
      figures: string[];
      directions?: Record<string, string>;
      routes?: Record<string, FigureRoute>;
    }
  | { type: "confirm_figures"; figures?: string[] }
  | { type: "approve_design"; directions?: Record<string, string> }
  | { type: "revise_design"; feedback: string; figures?: string[] }
  | {
      type: "revise_figures";
      feedback: string;
      figures: string[];
      target: (typeof FIGURE_REVISE_TARGETS)[number];
    }
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
