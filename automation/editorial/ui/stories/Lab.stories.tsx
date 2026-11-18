import type { Meta, StoryObj } from "@storybook/react-vite";
import { type FileUrl, type Lab, LabBoard } from "./lab/LabBoard";

// 연구소 · 실제 기록은 .local/figure-lab(커밋하지 않음)에서 읽고, 없으면 빈 화면 · 예시는 화면 점검용 가짜 기록 (LAB-001)
const indexes = import.meta.glob<Lab>("/.local/figure-lab/lab.json", {
  eager: true,
  import: "default",
});
const files = import.meta.glob<string>("/.local/figure-lab/**/*.{svg,png,webp}", {
  eager: true,
  query: "?url",
  import: "default",
});
const localLab: Lab = Object.values(indexes)[0] ?? { variants: [], records: [] };
const localFile: FileUrl = (key) => files[`/.local/figure-lab/${key}`];

const sample = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="${fill}"/></svg>`)}`;
const base = {
  at: "2026-11-19T00:00:00.000Z",
  ref: null,
  model: "예시",
  visual: null,
  verdict: null,
};
const exampleLab: Lab = {
  variants: [
    { id: "baseline", label: "현재", hypothesis: "기준", changes: [] },
    {
      id: "res010",
      label: "A · RES-010",
      hypothesis: "원칙 3개를 지시문에 넣는다",
      changes: ["without·relation·mapping"],
    },
  ],
  records: [
    {
      ...base,
      case: "algo-f3",
      variant: "baseline",
      trial: 1,
      stage: "figure",
      ms: 1_380_000,
      tokens: { input: 12_000_000, output: 290_000 },
      files: [{ path: "figure.svg", mime: "image/svg+xml" }],
      verdict: { by: "사람", pass: false, note: "모두 갖춰야가 안 보임" },
    },
    {
      ...base,
      case: "algo-f3",
      variant: "res010",
      trial: 1,
      stage: "figure",
      ms: 900_000,
      tokens: { input: 6_000_000, output: 200_000 },
      files: [{ path: "figure.svg", mime: "image/svg+xml" }],
      visual: { renders: 3, views: 2, editsAfterView: 2 },
    },
    {
      ...base,
      case: "algo",
      variant: "res010",
      trial: 1,
      stage: "plan",
      ms: 60_000,
      tokens: { input: 20_000, output: 3_000 },
      files: [],
      candidates: [
        {
          anchor: "어떤 절차가 알고리즘이 되려면",
          relation: "all-required",
          without: "하나라도 빠지면 실패한다는 것",
          mapping: [{ element: "자물쇠 다섯 개", concept: "다섯 조건" }],
        },
      ],
    },
  ],
};
const exampleFile: FileUrl = (key) =>
  key.includes("baseline") ? sample("#d0d7de") : sample("#9be9a8");

const meta: Meta = { title: "연구소", parameters: { layout: "fullscreen" } };
export default meta;
export const 실험_기록: StoryObj = {
  render: () => <LabBoard lab={localLab} fileUrl={localFile} />,
};
export const 예시: StoryObj = { render: () => <LabBoard lab={exampleLab} fileUrl={exampleFile} /> };
