import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// 다시 전달하기 전 대기 · 운영 값 · 실제 간격은 test:n8n:runtime이 이 값으로 검증
export const WAIT_SECONDS = 2;

export function editorialWorkflow({
  bridgeUrl = "http://127.0.0.1:3230",
  credentialId = "localPaseoBridge",
  path = "ain-editorial",
  // 흐름 fixture만 줄여 씀: 호출 수십 번을 운영 간격으로 기다리지 않게 · TIME-001
  waitSeconds = WAIT_SECONDS,
} = {}) {
  const credential = { httpHeaderAuth: { id: credentialId, name: "Local Paseo bridge" } };
  const nodes = [
    {
      id: "guide",
      name: "사용자 흐름",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [-100, -280],
      parameters: {
        width: 1180,
        height: 620,
        color: 7,
        content:
          "## 요청 전달과 대기\n작업 ID를 편집 서비스에 전달합니다.\n응답의 `continue`가 참이면 대기 후 같은 작업 ID를 다시 전달합니다.",
      },
    },
    {
      id: "start",
      name: "글쓰기 요청 받기",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2.1,
      position: [0, 0],
      webhookId: "blog-editorial-service",
      parameters: {
        httpMethod: "POST",
        path,
        authentication: "headerAuth",
        responseMode: "onReceived",
        options: {},
      },
      credentials: credential,
    },
    {
      id: "advance",
      name: "편집 서비스에 전달",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [300, 0],
      parameters: {
        method: "POST",
        url: `={{ ${JSON.stringify(`${bridgeUrl}/editorial/runs/`)} + ($json.id ?? $json.body.id) + '/advance' }}`,
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ { executionId: $execution.id } }}",
        // 전달 1회에 AI 작업 생성(제공자 준비 대기 최대 15초 + 세션 생성)이 포함될 수 있음
        options: { timeout: 120000 },
      },
      // 일시 오류 1회로 루프가 끝나면 완성된 AI 결과를 아무도 거두지 않음 · advance는 작업 ID 기준 멱등
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 5000,
      credentials: credential,
    },
    {
      id: "pending",
      name: "계속 기다릴까요?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [600, 0],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
          conditions: [
            {
              id: "continue",
              leftValue: "={{ $json.continue }}",
              rightValue: "",
              operator: { type: "boolean", operation: "true", singleValue: true },
            },
          ],
          combinator: "and",
        },
        options: {},
      },
    },
    {
      id: "wait",
      name: "잠시 대기",
      type: "n8n-nodes-base.wait",
      typeVersion: 1.1,
      position: [900, 0],
      parameters: { resume: "timeInterval", amount: waitSeconds, unit: "seconds" },
    },
  ];
  const edge = (node) => ({ node, type: "main", index: 0 });
  return {
    id: "blogEditorialServiceV1",
    name: "글쓰기 · 요청 전달과 대기",
    active: false,
    nodes,
    connections: {
      "글쓰기 요청 받기": { main: [[edge("편집 서비스에 전달")]] },
      "편집 서비스에 전달": { main: [[edge("계속 기다릴까요?")]] },
      "계속 기다릴까요?": { main: [[edge("잠시 대기")], []] },
      "잠시 대기": { main: [[edge("편집 서비스에 전달")]] },
    },
    settings: { executionOrder: "v1" },
    versionId: randomUUID(),
    tags: [],
  };
}
export async function writeEditorialWorkflow() {
  await writeFile(
    new URL("./blog-editorial-service.json", import.meta.url),
    `${JSON.stringify(editorialWorkflow(), null, 2)}\n`,
  );
  console.log("Generated thin editorial workflow");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeEditorialWorkflow();
}
