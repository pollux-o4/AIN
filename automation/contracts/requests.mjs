import { z } from "zod";
import { ACTION_TYPES } from "./actions.mjs";
import {
  FIGURE_REVISE_TARGETS,
  figureDirectionsSchema,
  figureFeedbackSchema,
  figureIdsSchema,
  figureLookSchema,
  figureRoutesSchema,
} from "./figure.mjs";
import { directionSchema } from "./writing-modes.mjs";

export const INPUT_LIMITS = Object.freeze({
  id: 100,
  idea: 12000,
  source: 200000,
  feedback: 12000,
});

const text = (/** @type {number} */ max) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0);

// Extra request fields are accepted for compatibility; only named fields are consumed.
export const requestObjectSchema = z.looseObject({});
export const createRequestSchema = z.looseObject({
  requestId: text(INPUT_LIMITS.id),
  idea: text(INPUT_LIMITS.idea),
  source: z.string().max(INPUT_LIMITS.source).optional(),
  direction: directionSchema.optional(),
});
const actionFieldsSchema = z.looseObject({
  operationId: text(INPUT_LIMITS.id),
  type: z.enum(ACTION_TYPES),
  expectedVersion: z.number().int(),
  feedback: z.unknown().optional(),
  edit: z.unknown().optional(),
  figures: z.unknown().optional(),
  directions: z.unknown().optional(),
  look: z.unknown().optional(),
  target: z.unknown().optional(),
});
// These checks run separately to preserve duplicate-operation and error precedence.
export const actionIdentitySchema = actionFieldsSchema.pick({ operationId: true, type: true });
export const actionVersionSchema = actionFieldsSchema.pick({ expectedVersion: true });
export const feedbackSchema = text(INPUT_LIMITS.feedback);
// 수정 해석(편집 메모) 사람 보정 · 지정 필드만 · ADR-0010
const items = z.array(text(500)).max(8);
export const briefEditSchema = z.strictObject({
  intent: text(1000).optional(),
  target: z.enum(["audience", "value", "outline", "draft"]).optional(),
  priorities: items.optional(),
  preserve: items.optional(),
});
export const actionRequestSchema = z.discriminatedUnion("type", [
  actionFieldsSchema.extend({ type: z.literal("feedback"), feedback: feedbackSchema }),
  actionFieldsSchema.extend({ type: z.literal("revise_brief"), feedback: feedbackSchema }),
  actionFieldsSchema.extend({
    type: z.literal("approve_brief"),
    edit: briefEditSchema.optional(),
  }),
  // 시각자료: 만들 후보 선택은 필수, 확인 때 남길 것은 생략하면 전부 · FIGURE-001
  actionFieldsSchema.extend({
    type: z.literal("select_figures"),
    figures: figureIdsSchema,
    directions: figureDirectionsSchema.optional(),
    routes: figureRoutesSchema.optional(),
    // 사람이 고른 그림 스타일 · 생략하면 구성이 고른다 · ADR-0027
    look: figureLookSchema.optional(),
  }),
  actionFieldsSchema.extend({
    type: z.literal("confirm_figures"),
    figures: figureIdsSchema.optional(),
  }),
  // 구성 승인(방향 보정 가능)·다시 구성(의견 필수, 자리 생략하면 전부)·확인 뒤 되돌림 · ADR-0026
  actionFieldsSchema.extend({
    type: z.literal("approve_design"),
    directions: figureDirectionsSchema.optional(),
  }),
  actionFieldsSchema.extend({
    type: z.literal("revise_design"),
    feedback: figureFeedbackSchema,
    figures: figureIdsSchema.optional(),
  }),
  actionFieldsSchema.extend({
    type: z.literal("revise_figures"),
    feedback: figureFeedbackSchema,
    figures: figureIdsSchema,
    target: z.enum(FIGURE_REVISE_TARGETS),
  }),
  // 실패한 그림만 다시 · 끝난 그림은 그대로 · ADR-0026
  actionFieldsSchema.extend({
    type: z.literal("retry_figures"),
    figures: figureIdsSchema,
  }),
  actionFieldsSchema.extend({
    type: actionFieldsSchema.shape.type.exclude([
      "feedback",
      "revise_brief",
      "approve_brief",
      "select_figures",
      "approve_design",
      "revise_design",
      "revise_figures",
      "retry_figures",
      "confirm_figures",
    ]),
  }),
]);
export const advanceRequestSchema = z.looseObject({
  executionId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
    .optional(),
});

/** @typedef {z.infer<typeof createRequestSchema>} CreateRequest */
/** @typedef {z.infer<typeof actionRequestSchema>} ActionRequest */
/** @typedef {z.infer<typeof advanceRequestSchema>} AdvanceRequest */
