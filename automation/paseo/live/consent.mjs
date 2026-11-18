// 실제 모델 실행은 돌릴 때마다 비용이 든다 · 사람이 직접 돌릴 때만 시작한다 · TIME-001
// 터미널에서 사람이 실행하면 그대로 진행 · 다른 작업에 묶이거나 에이전트·CI가 실행하면 명시적 허락(AIN_LIVE=1)이 있어야 한다
const CONSENT_ENV = "AIN_LIVE";

/** @param {string} what 무엇을 몇 번 호출하는지 */
export function requireLiveConsent(what) {
  if (process.env[CONSENT_ENV] === "1" || process.stdin.isTTY) return;
  console.error(
    `실제 모델 비용 호출(${what})은 자동으로 실행하지 않습니다. 터미널에서 직접 실행하거나 ${CONSENT_ENV}=1을 붙여 주세요.`,
  );
  process.exit(2);
}
