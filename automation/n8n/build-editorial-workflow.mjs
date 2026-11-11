import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function editorialWorkflow({
  bridgeUrl = "http://127.0.0.1:3230",
  credentialId = "localPaseoBridge",
  path = "ain-editorial",
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
        options: { timeout: 30000 },
      },
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
      parameters: { resume: "timeInterval", amount: 2, unit: "seconds" },
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
