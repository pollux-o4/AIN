// 검증 시간 예산의 단일 정의 · TIME-001
// Go 계약·흐름은 go:check, PC·모바일 런타임 연결은 go:client-check에서 검증한다.

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
      { task: "go:check", seconds: 30 },
    ],
  },
  { name: "Go 클라이언트", tasks: [{ task: "go:client-check", seconds: 45 }] },
  { name: "브라우저", tasks: [{ task: "test:e2e", seconds: 180 }] },
];
