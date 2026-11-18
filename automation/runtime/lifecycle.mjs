// 편집 서비스 수명 판단 규칙 · 입출력 없음 · control.mjs가 사용
import { isPendingStatus } from "../contracts/status.mjs";

// 이 저장소가 띄운 서비스 프로세스 · 공통 Paseo 데몬은 다른 프로젝트와 공유하므로 제외
const OWNED = [
  { role: "supervisor", match: /automation\/(runtime|editorial)\/start\.mjs/ },
  { role: "bridge", match: /automation\/runtime\/server\.mjs/ },
  { role: "n8n", match: /\bn8n start\b/ },
];

export function ownedRole({ cwd, cmdline }, root) {
  if (cwd !== root) return null;
  return OWNED.find(({ match }) => match.test(cmdline))?.role ?? null;
}

export function activeRuns(runs) {
  return runs
    .filter((run) => isPendingStatus(run.state?.status))
    .map((run) => ({ id: run.id, idea: String(run.state?.idea ?? "").slice(0, 40) }));
}

// 브리지가 마지막 코드 변경보다 먼저 시작됐으면 이전 코드로 동작 중
export function isStale(bridgeStartedAtMs, codeChangedAtMs) {
  return bridgeStartedAtMs < codeChangedAtMs;
}
