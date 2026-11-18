// n8n 워크플로(요청 전달과 대기)와 같은 계약을 프로세스 안에서 수행 · 화면 e2e용
// 계약: advance(id, { executionId }) 반복 · 응답 continue가 참이면 대기 후 재전달
// 실제 n8n 연결은 test:n8n:runtime·test:flow가 검증 · 화면 e2e는 대기 간격(2초) 없이 빠르게
let executions = 0;

export function inProcessDispatcher(service, { intervalMs = 100 } = {}) {
  const running = new Set();
  let stopped = false;
  async function loop(id) {
    const executionId = `local-${++executions}`;
    while (!stopped) {
      const result = await service.advance(id, { executionId }).catch(() => ({ continue: false }));
      if (!result?.continue) return;
      await new Promise((done) => setTimeout(done, intervalMs));
    }
  }
  return {
    async dispatch(id) {
      const task = loop(id).finally(() => running.delete(task));
      running.add(task);
    },
    async stop() {
      stopped = true;
      await Promise.allSettled(running);
    },
  };
}
