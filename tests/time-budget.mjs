// 검증 시간 예산의 단일 정의 · TIME-001
// 단계별 가장 긴 예산의 합이 전체 상한과 같다(30 + 45 + 45 + 180 = 300) · 브라우저는 부하 시 실측 상단(173초)이 예산에 가깝다 · 넘으면 느린 테스트가 들어왔다는 신호이므로 예산을 올리기 전에 원인을 걷어낸다
// 실측(2026-11-15, 18코어 · 캐시 없이): 정적·단위 8초(나란히) · n8n 34초 · 흐름 34초 · 브라우저 106~173초(다른 작업이 도는 중에는 느려짐)

/** 전체 검증(`mise run verify`)의 벽시계 상한(초) */
export const TOTAL_SECONDS = 300;

/**
 * 단계: 같은 단계의 작업은 나란히, 단계는 차례로 실행한다 · 앞 단계가 실패하면 뒤 단계는 돌리지 않는다
 * 통합 단계는 차례로 돈다(브라우저 테스트는 타이밍에 민감해 다른 무거운 작업과 나란히 돌리지 않는다)
 * @type {{ name: string, tasks: { task: string, seconds: number }[] }[]}
 */
export const PHASES = [
  {
    name: "정적·단위",
    tasks: [
      { task: "check:types", seconds: 15 },
      { task: "check:lint", seconds: 10 },
      { task: "check:arch", seconds: 20 },
      { task: "secrets", seconds: 15 },
      { task: "test", seconds: 30 },
    ],
  },
  { name: "격리 n8n", tasks: [{ task: "test:n8n:runtime", seconds: 45 }] },
  { name: "fixture 흐름", tasks: [{ task: "test:flow", seconds: 45 }] },
  { name: "브라우저", tasks: [{ task: "test:e2e", seconds: 180 }] },
];
