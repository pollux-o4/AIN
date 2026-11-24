// 연구소 명령 · index(색인 다시 만들기) · summary [사례 앞이름](회차·자리 한 줄 요약, 에이전트가 원문 JSON 대신 읽는다) · judge <사례> <변형> <단계> <회차> pass|fail "<메모>" [판정자]
// 기존 실행 기록 가져오기는 import-jobs.mjs · 실행은 각 실험 진입점이 writeLabRecord로 남긴다

import { judgeLabRecord, LAB_ROOT, readLab, writeLabIndex } from "./store.mjs";
import { LAB_VARIANTS } from "./variants.mjs";

const [command, ...args] = process.argv.slice(2);
if (command === "index") {
  const lab = await writeLabIndex(LAB_ROOT, LAB_VARIANTS);
  console.log(`기록 ${lab.records.length}건 · ${LAB_ROOT}/lab.json`);
} else if (command === "summary") {
  // 위에서 아래로: 회차 한 줄 → 자리 한 줄(id·그릴 대상) · 장면·대응표는 --full 일 때만
  const [prefix = "", flag] = args;
  const lab = await readLab(LAB_ROOT, LAB_VARIANTS);
  for (const r of lab.records.filter((record) => record.case.startsWith(prefix))) {
    const total = r.tokens ? Math.round((r.tokens.input + r.tokens.output) / 1000) : "—";
    const verdict = r.verdict ? (r.verdict.pass ? "통과" : "미통과") : "판정 전";
    console.log(`${r.case} ${r.variant} ${r.stage}-${r.trial} · ${total}천 토큰 · ${verdict}`);
    if (r.world) console.log(`  세계: ${r.world}`);
    for (const c of r.candidates ?? []) {
      console.log(`  ${c.id ?? "-"} ${c.anchor} → ${c.analogy ?? "(비유 없음)"}`);
      if (flag === "--full" && c.scene) console.log(`     장면: ${c.scene}`);
    }
  }
} else if (command === "judge") {
  const [kase, variant, stage, trial, result, note = "", by = "사람"] = args;
  if (!["pass", "fail"].includes(result)) throw new Error("판정은 pass 또는 fail");
  await judgeLabRecord(
    LAB_ROOT,
    { case: kase, variant, stage, trial: Number(trial) },
    { by, pass: result === "pass", note },
  );
  await writeLabIndex(LAB_ROOT, LAB_VARIANTS);
  console.log(`판정 기록: ${kase}/${variant}/${stage}-${trial} ${result}`);
} else {
  console.error(
    '사용법: lab.mjs index | summary [사례] [--full] | judge <사례> <변형> <단계> <회차> pass|fail "<메모>" [판정자]',
  );
  process.exit(2);
}
