import { z } from "zod";
import { DEFAULT_DIRECTION, directionSchema } from "../../../contracts/writing-modes.mjs";
import type { ActionCommand, Direction, Run } from "./api";

const memory = new Map<string, unknown>();
export const keys = {
  input: "ain-editorial-input",
  current: "ain-editorial-current",
  create: "ain-editorial-create",
  operation: "ain-editorial-operation",
  feedback: "ain-editorial-feedback",
};
export const inputSchema = z.object({
  idea: z.string().default(""),
  source: z.string().default(""),
  // 손상·이전 저장값은 자동으로 되돌린다.
  direction: directionSchema.catch({ ...DEFAULT_DIRECTION }).default({ ...DEFAULT_DIRECTION }),
});
const createSchema = z.object({ signature: z.string(), requestId: z.string() });
const operationSchema = z.object({ signature: z.string(), operationId: z.string() });
const feedbackSchema = z.object({ id: z.string(), text: z.string() });
export function read<T>(key: string, schema: z.ZodType<T>): T | null {
  let value: unknown = memory.get(key);
  try {
    value = JSON.parse(localStorage.getItem(key) ?? "null") ?? value;
  } catch {
    /* 메모리 복구 */
  }
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}
export function store(key: string, value: unknown): boolean {
  memory.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function remove(key: string) {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* 임시 저장이 막혀도 서버 작업은 유지 */
  }
}
export const storageWarning =
  "브라우저의 임시 저장을 사용할 수 없습니다. 제출 전에는 이 화면을 닫지 마세요.";
export const currentId = () => read(keys.current, z.string());
export const savedFeedback = () => read(keys.feedback, feedbackSchema);
export function createRequest(idea: string, source: string, direction: Direction) {
  const signature = JSON.stringify({ idea, source, direction });
  const old = read(keys.create, createSchema);
  return {
    signature,
    requestId: old?.signature === signature ? old.requestId : crypto.randomUUID(),
  };
}
export function pendingAction(run: Run, command: ActionCommand) {
  const payload = { expectedVersion: run.version, ...command };
  const signature = JSON.stringify({ id: run.id, ...payload });
  const old = read(keys.operation, operationSchema);
  return {
    signature,
    operationId: old?.signature === signature ? old.operationId : crypto.randomUUID(),
    payload,
  };
}
export function reconcileOperation(run: Run) {
  const pending = read(keys.operation, operationSchema);
  if (!pending || !run.appliedOperations.includes(pending.operationId)) return false;
  let clearedFeedback = false;
  try {
    const sent = z
      .object({ type: z.string(), feedback: z.string().optional() })
      .parse(JSON.parse(pending.signature));
    const saved = savedFeedback();
    if (sent.type === "feedback" && saved?.id === run.id && saved.text.trim() === sent.feedback) {
      remove(keys.feedback);
      clearedFeedback = true;
    }
  } catch {
    /* 손상된 서명도 적용 완료된 작업 ID로 정리 */
  }
  remove(keys.operation);
  return clearedFeedback;
}
export function clearOperation(operationId: string) {
  if (read(keys.operation, operationSchema)?.operationId === operationId) remove(keys.operation);
}
