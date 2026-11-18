import type { Meta, StoryObj } from "@storybook/react-vite";
import { Compose } from "../compose/Compose";
import { Library } from "../library/Library";
import { Settings } from "../shell/Settings";
import { Workspace } from "../workspace/Workspace";
import { makeRun, recent } from "./fixtures";

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
