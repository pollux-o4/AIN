export const RUNTIME_PROTOCOL = "ain-editorial-4";
// 실사용 런타임 경로 SSoT · 인증 파일(bridge-token·agent-token)은 n8n·CLI와 공유하므로 항상 여기
export const LIVE_RUNTIME_DIR = ".local/ai-runtime";
// 글·작업 데이터 위치 · 연구소는 다른 경로를 지정해 실사용 목록과 섞이지 않게 한다(LAB-001)
export const DATA_DIR_ENV = "AIN_DATA_DIR";
/** @param {Record<string, string | undefined>} env */
export const dataDir = (env) => env[DATA_DIR_ENV] ?? LIVE_RUNTIME_DIR;
// 보낼 폴더 · 받는 쪽은 여기 놓인 묶음 파일만 읽는다(ADR-0012)
export const OUTBOX_ENV = "AIN_OUTBOX";
export const DEFAULT_OUTBOX = ".local/outbox";
// 에이전트 CLI 인증 파일: LIVE_RUNTIME_DIR 아래 · AGENT-001
export const AGENT_TOKEN_FILE = "agent-token";
export const DEFAULT_RUNTIME_URL = "http://127.0.0.1:3230";
