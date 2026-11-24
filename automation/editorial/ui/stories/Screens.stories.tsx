import type { Meta, StoryObj } from "@storybook/react-vite";
import { Compose } from "../compose/Compose";
import { Library } from "../library/Library";
import { Settings } from "../shell/Settings";
import { Workspace } from "../workspace/Workspace";
import { figureHtml, makeFigure, makeRun, recent } from "./fixtures";

const noop = async () => {};
const meta: Meta = { title: "화면" };
export default meta;
export const 목록: StoryObj = {
  render: () => (
    <Library
      runs={recent}
      error=""
      onRetry={noop}
      onOpen={noop}
      onCompose={noop}
      onArchive={noop}
    />
  ),
};
export const 목록_빈상태: StoryObj = {
  render: () => (
    <Library runs={[]} error="" onRetry={noop} onOpen={noop} onCompose={noop} onArchive={noop} />
  ),
};
export const 목록_로딩: StoryObj = {
  render: () => (
    <Library runs={null} error="" onRetry={noop} onOpen={noop} onCompose={noop} onArchive={noop} />
  ),
};
export const 새글: StoryObj = {
  render: () => <Compose submitting={false} onCreate={noop} onNotice={noop} />,
};
export const 작업_초안: StoryObj = {
  render: () => (
    <Workspace
      run={makeRun({ status: "awaiting_user" })}
      online
      submitting={false}
      onAction={noop}
      onNotice={noop}
    />
  ),
};
export const 작업_진행중: StoryObj = {
  render: () => (
    <Workspace
      run={makeRun({ status: "waiting_ai", activeAt: 5 })}
      online
      submitting={false}
      onAction={noop}
      onNotice={noop}
    />
  ),
};
export const 설정패널: StoryObj = {
  render: () => <Settings />,
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>("#settings-toggle")?.click();
  },
};
export const 작업_수정요청패널: StoryObj = {
  render: 작업_초안.render,
  play: async ({ canvasElement }) => {
    canvasElement.ownerDocument
      .querySelector<HTMLButtonElement>("#work-dock .dock-toggle")
      ?.click();
  },
};
export const 작업_실시간도크: StoryObj = {
  render: 작업_진행중.render,
  play: async ({ canvasElement }) => {
    canvasElement.ownerDocument
      .querySelector<HTMLButtonElement>("#work-dock .dock-toggle")
      ?.click();
  },
};
export const 작업_해석확인도크: StoryObj = {
  render: () => (
    <Workspace
      run={makeRun({
        status: "awaiting_brief",
        canFeedback: false,
        canSatisfy: false,
        canApproveBrief: true,
        brief: {
          intent: "독자를 입문자로 낮추고 용어를 처음 나올 때 풀어 쓴다.",
          target: "audience",
          priorities: ["MSA·모듈러 모놀리스를 비유로 먼저 설명", "글 말미에 비교 정리표"],
          preserve: ["4가지 질문 흐름", "4,000~5,000자 분량"],
          assumptions: ["모듈러 모놀리스를 비교 대상에 포함한다."],
        },
      })}
      online
      submitting={false}
      onAction={noop}
      onNotice={noop}
    />
  ),
};
const figureRun = (
  figure: ReturnType<typeof makeFigure>,
  can: Partial<Parameters<typeof makeRun>[0]> = {},
) => makeRun({ status: "awaiting_user", html: figureHtml, figure, ...can });
const workspace = (run: ReturnType<typeof makeRun>) => () => (
  <Workspace run={run} online submitting={false} onAction={noop} onNotice={noop} />
);
const actionWorkspace = (run: ReturnType<typeof makeRun>) => () => (
  <>
    <Workspace
      run={run}
      online
      submitting={false}
      onAction={async (command) => {
        const result = document.querySelector<HTMLOutputElement>("#figure-action-result");
        if (result) result.value = JSON.stringify(command);
      }}
      onNotice={noop}
    />
    <output id="figure-action-result" />
  </>
);
function enterText(field: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
export const 시각자료_고르기: StoryObj = {
  render: workspace(figureRun(makeFigure(), { canSelectFigures: true, canDiscardFigures: true })),
};
export const 시각자료_생성중: StoryObj = {
  render: workspace(
    figureRun(
      makeFigure({
        phase: "generate",
        selected: ["f2", "f3"],
        current: { ids: ["f2"], pass: "visual" },
      }),
      {
        status: "waiting_ai",
      },
    ),
  ),
};
export const 시각자료_검토: StoryObj = {
  render: workspace(
    figureRun(
      makeFigure({
        phase: "review",
        selected: ["f2"],
        items: [
          {
            id: "f2",
            anchor: "요약",
            claim: "선택 기준",
            alt: "두 축 갈림길 그림",
            caption: "선택을 가르는 두 축",
            route: "image",
            mime: "image/png",
            motion: false,
            labels: [{ text: "팀 크기", anchor: { x: 0.25, y: 0.8 } }],
          },
        ],
      }),
      { canConfirmFigures: true, canDiscardFigures: true },
    ),
  ),
};
export const 시각자료_구성검수: StoryObj = {
  render: actionWorkspace(
    figureRun(
      makeFigure({
        phase: "design",
        world: "주문 흐름을 따라가는 작은 도시",
        selected: ["f2", "f3"],
      }),
      { status: "awaiting_figure_design", canApproveDesign: true },
    ),
  ),
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const feedback = doc.querySelector<HTMLTextAreaElement>("#design-feedback");
    if (!feedback || !doc.body.textContent?.includes("갈림길"))
      throw new Error("구성 패널이 보이지 않아요.");
    enterText(feedback, "갈림길 장면을 더 단순하게 해 주세요.");
    doc.querySelector<HTMLButtonElement>("#revise-design-submit")?.click();
    await Promise.resolve();
    const revise = doc.querySelector<HTMLOutputElement>("#figure-action-result")?.value;
    if (!revise?.includes('"type":"revise_design"') || !revise.includes('"figures":["f2","f3"]'))
      throw new Error("다시 구성 요청 본문이 맞지 않아요.");
    doc.querySelector<HTMLButtonElement>("#work-dock .dock-toggle")?.click();
    doc.querySelector<HTMLButtonElement>("#approve-design")?.click();
    await Promise.resolve();
    if (
      !doc
        .querySelector<HTMLOutputElement>("#figure-action-result")
        ?.value.includes('"type":"approve_design"')
    )
      throw new Error("구성 승인 요청이 맞지 않아요.");
  },
};
export const 시각자료_그림되돌리기: StoryObj = {
  render: actionWorkspace(
    figureRun(
      makeFigure({
        phase: "review",
        selected: ["f2"],
        items: [
          {
            id: "f2",
            anchor: "요약",
            claim: "선택 기준",
            alt: "두 축 갈림길 그림",
            caption: "선택을 가르는 두 축",
            route: "image",
            mime: "image/png",
            motion: false,
            labels: [],
          },
        ],
      }),
      { canConfirmFigures: true, canReviseFigures: true },
    ),
  ),
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    doc.querySelector<HTMLElement>("#work-dock details summary")?.click();
    const feedback = doc.querySelector<HTMLTextAreaElement>("#revise-f2");
    if (!feedback) throw new Error("그림 되돌리기 입력란이 없어요.");
    enterText(feedback, "기준 두 축이 분명하게 보이도록 해 주세요.");
    doc.querySelector<HTMLButtonElement>("#revise-compose-f2")?.click();
    await Promise.resolve();
    const action = doc.querySelector<HTMLOutputElement>("#figure-action-result")?.value;
    if (
      !action?.includes('"type":"revise_figures"') ||
      !action.includes('"target":"compose"') ||
      !action.includes('"figures":["f2"]') ||
      !action.includes("기준 두 축이 분명하게 보이도록 해 주세요.")
    )
      throw new Error("구성 단계 되돌리기 요청 본문이 맞지 않아요.");
    doc.querySelector<HTMLButtonElement>("#work-dock .dock-toggle")?.click();
    doc.querySelector<HTMLButtonElement>("#revise-generate-f2")?.click();
    await Promise.resolve();
    if (
      !doc
        .querySelector<HTMLOutputElement>("#figure-action-result")
        ?.value.includes('"target":"fix"')
    )
      throw new Error("부분 수정 요청 본문이 맞지 않아요.");
  },
};
export const 시각자료_고르기_이미지연결: StoryObj = {
  render: workspace(
    figureRun(makeFigure({ routesAvailable: ["svg", "image"] }), {
      canSelectFigures: true,
      canDiscardFigures: true,
    }),
  ),
};
