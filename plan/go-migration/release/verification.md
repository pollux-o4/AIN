# Go 이식 검증 근거

| 관심사 | 마일스톤 | 구현·검증 검색 키 |
| --- | --- | --- |
| 계약 | MIG-001 | `backend/internal/contract`, 소유 경로와 가짜 포트 |
| 계약 | MIG-002 | `paseoprobe`, 로컬 데몬 인증·읽기 전용 조회 |
| 계약 | MIG-003 | `tests/migration/reference`, Node fixture와 엄격 대조 |
| 실행 | MIG-011 | `TestAINAPI001AtomicReservationAndCompletion`, `TestHISTORY001LegacyDataRoundTrip` |
| 실행 | MIG-012 | `TestMIG012PaseoWireRecoveryCommitsOnlyProvedTurn`, `TestMIG012BatchDispatchesWithinChildLimit` |
| 실행 | MIG-013 | `TestMIG013Admission`, `TestMIG013WatchReconnectAndRelease`, `ai:providers` |
| 실행 | MIG-014 | `TestMIG014RunnerLeasesAndRecoversExactManagedTurn`, `TestADR0015SweepOwnershipWarmLimitAndRetry` |
| 편집 | MIG-021 | `TestFLOW001`, `TestEDIT001FeedbackAndMarkedRevision` |
| 편집 | MIG-022 | `TestFIGURE001LegacyParity`, `TestFIGURE001Workflow` |
| 편집 | MIG-023 | `backend/internal/writingai`의 기준 대조와 결과 검증 |
| 편집 | MIG-024 | `TestFIGURE002StageAndRouteContracts`, `TestFIGURE002RenderRouteParity`, `TestFIGURE002BoundedRasterAndSafeWorkspace` |
| 편집 | MIG-025 | `TestMIG025NodeQueryParity`, `TestSavedHistoryBatchAndPrivateFields`, Go 사용량 저장 |
| 클라이언트 | MIG-031 | `TestAGENT001LocalAuthentication`, `TestLIVE001ReadOnlyScopedAndBoundedActivity` |
| 클라이언트 | MIG-032 | `TestNodeExportGolden`, `TestOutboxApprovalAndAtomicRetry` |
| 클라이언트 | MIG-033 | `go:client-check`의 PC·모바일 Chromium과 CLI |
| 릴리스 | MIG-051 | PERF-001, `go-candidate.md`의 같은 부하 비교와 후속 재측정 |
| 릴리스 | MIG-052 | `TestFLOW001HTTPToHandoff`, `go:client-check`, `liveprobe` 합성 글쓰기 |
| 릴리스 | MIG-053 | `TestOfflineMigrationAndRollback`, 합성 후보 Go 기동과 원본 바이트 일치. 운영 이관은 별도 승인 대상 |
| 릴리스 | MIG-054 | 빈 서버 PATH에서 배포 검증본 기동, 자산·CLI·Paseo 고지 검증. 최종 전체 검증 통과, MIT 저작권자 확인 대기 |

실제 모델을 이용한 agy 전송·중단의 확인은 합성 시험과 별개다. 승인된 실제 실행이 있으면 OPS-003에 따라 증거를 남긴다.

`6480432`의 격리 워크트리에서 `mise run verify -- --force`가 119.4초/300초로 통과했다. 타입 3.8/15초, Biome 2.2/10초, 의존 경계 5.2/20초, 비밀값 5.4/15초, 단위 7.3/30초, Go 1.5/30초, Go 클라이언트 8.1/45초, Playwright 104.0/180초였다.
