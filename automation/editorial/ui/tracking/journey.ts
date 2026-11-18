import type { Run } from "../shared/api";

// 여정 지도의 "지금 할 일" 한 줄 SSoT · 사람이 판단할 것만 말하고, 기다리면 되는 상태는 기다리라고만 말한다.
export type Next = { tone: "wait" | "act" | "warn" | "done"; say: string };

export function nextStep(run: Run, online: boolean): Next {
  if (!online) return { tone: "warn", say: "연결이 끊겼어요. 다시 이어지면 알아서 확인할게요." };
  if (run.archived) return { tone: "warn", say: "삭제된 글이에요. 위에서 복원할 수 있어요." };
  const active = run.monitor.pipeline.find((step) => step.status === "active");
  if (run.issue && run.status === "failed")
    return {
      tone: "warn",
      say: `멈췄어요: ${run.issue} '${run.monitor.resumeLabel}'를 눌러 주세요.`,
    };
  if (run.needsCompletion)
    return { tone: "act", say: "빠진 단계가 있어요. 아래에서 보완을 요청해 주세요." };
  switch (run.status) {
    case "waiting_ai":
    case "waiting_route":
    case "waiting_figure":
      return {
        tone: "wait",
        say: active
          ? `'${active.name}' 하는 중이에요. 기다리기만 하면 돼요.`
          : "작업 준비 중이에요.",
      };
    case "paused":
      return {
        tone: "warn",
        say: `잠시 멈춰 뒀어요. '${run.monitor.resumeLabel}'를 누르면 계속해요.`,
      };
    case "awaiting_brief":
      return { tone: "act", say: "고칠 방향을 이렇게 이해했어요. 맞는지만 확인해 주세요." };
    case "awaiting_user":
      return { tone: "act", say: "초안이 준비됐어요. 읽어 보고 확정하거나 고쳐 달라고 해 주세요." };
    case "awaiting_figure_choice":
      return { tone: "act", say: "시각자료를 놓을 위치를 제안했어요. 만들 곳을 골라 주세요." };
    case "awaiting_figure_review":
      return { tone: "act", say: "시각자료가 준비됐어요. 본문에 놓인 모습을 확인해 주세요." };
    case "satisfied":
      return run.figure
        ? { tone: "act", say: "시각자료까지 확인했어요. 발행 준비를 승인하면 전달 준비가 끝나요." }
        : {
            tone: "act",
            say: "확정했어요. 시각자료를 추가하거나, 없이 바로 발행 준비를 승인해 주세요.",
          };
    case "publication_ready":
    case "publication_adapter_required":
      return { tone: "done", say: "전달 준비 완료! 실제 발행은 따로 진행해 주세요." };
    default:
      return { tone: "wait", say: run.monitor.label };
  }
}

// 지도의 층 나누기: 시각 단계가 시작됐고 글 단계가 모두 끝났으면 글 단계를 한 칸으로 접는다.
// 시각 단계가 없어지거나(새 초안 회차) 글 단계가 다시 열리면 펼친다 · 단계 상태 자체는 바꾸지 않는다.
const VISUAL_STAGES = ["figure_plan", "figure"];
type Step = Run["monitor"]["pipeline"][number];
export function trackPhases(pipeline: Step[]) {
  const writing = pipeline.filter((step) => !VISUAL_STAGES.includes(step.stage));
  const visual = pipeline.filter((step) => VISUAL_STAGES.includes(step.stage));
  return {
    writing,
    visual,
    foldable: visual.length > 0 && writing.length > 0 && writing.every((s) => s.status === "done"),
  };
}
