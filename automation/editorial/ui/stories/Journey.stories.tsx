import type { Meta, StoryObj } from "@storybook/react-vite";
import { Monitor } from "../tracking/Monitor";
import { makeRun } from "./fixtures";

const meta: Meta<typeof Monitor> = {
  title: "작업/여정 지도",
  component: Monitor,
  args: { online: true },
};
export default meta;
type S = StoryObj<typeof Monitor>;
export const 진행중: S = { args: { run: makeRun({ status: "waiting_ai", activeAt: 3 }) } };
export const 막바지: S = { args: { run: makeRun({ status: "waiting_ai", activeAt: 7 }) } };
export const 초안준비: S = { args: { run: makeRun({ status: "awaiting_user" }) } };
export const 실패: S = {
  args: {
    run: makeRun({
      status: "failed",
      activeAt: 4,
      tail: "failed",
      issue: "근거 자료를 읽지 못했습니다.",
      monitor: {
        ...makeRun({ status: "failed", activeAt: 4, tail: "failed" }).monitor,
        kind: "blocked",
        label: "멈춤",
        canPause: false,
        canResume: true,
      },
    }),
  },
};
export const 일시정지: S = {
  args: { run: makeRun({ status: "paused", activeAt: 2, tail: "paused" }) },
};
export const 전달준비: S = { args: { run: makeRun({ status: "publication_ready" }) } };
export const 오프라인: S = {
  args: { run: makeRun({ status: "waiting_ai", activeAt: 3 }), online: false },
};
