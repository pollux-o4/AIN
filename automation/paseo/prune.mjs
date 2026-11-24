// 쓰지 않는 AIN Paseo 세션 정리(수동) · 서비스가 꺼져 있거나 이전 실행이 남긴 세션용 · 정책은 lifecycle · ADR-0015
// 서비스 런타임 소유로 정리한다: 진행 중 작업·대기 담당은 남기고, 주인이 사라졌거나 표시가 없는 바깥 세션은 보관
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { connectLocalPaseo } from "../../../paseo/sdk.mjs";
import { LIVE_RUNTIME_DIR } from "../contracts/runtime.mjs";
import { Jobs } from "./jobs.mjs";

const { values } = parseArgs({ options: { all: { type: "boolean", default: false } } });
const local = resolve(LIVE_RUNTIME_DIR);
const client = await connectLocalPaseo();
try {
  const jobs = new Jobs({ client, root: join(local, "jobs"), workRoot: join(local, "workspaces") });
  const { archived, failed } = await jobs.sweepSessions({ all: values.all });
  console.log(`보관 ${archived}개${failed ? ` · 실패 ${failed}개` : ""}`);
  if (failed) process.exitCode = 1;
} finally {
  await client.close();
}
