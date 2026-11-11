import { z } from "zod";
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
  type: z.enum([
    "feedback",
    "pause",
    "resume",
    "complete_requirements",
    "satisfy",
    "authorize_publication",
  ]),
  expectedVersion: z.number().int(),
  feedback: z.unknown().optional(),
});
// These checks run separately to preserve duplicate-operation and error precedence.
export const actionIdentitySchema = actionFieldsSchema.pick({ operationId: true, type: true });
export const actionVersionSchema = actionFieldsSchema.pick({ expectedVersion: true });
export const feedbackSchema = text(INPUT_LIMITS.feedback);
export const actionRequestSchema = z.discriminatedUnion("type", [
  actionFieldsSchema.extend({ type: z.literal("feedback"), feedback: feedbackSchema }),
  actionFieldsSchema.extend({
    type: actionFieldsSchema.shape.type.exclude(["feedback"]),
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
