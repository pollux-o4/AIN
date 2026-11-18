// 연구소 명령 · index(색인 다시 만들기) · judge <사례> <변형> <단계> <회차> pass|fail "<메모>" [판정자]
// 기존 실행 기록 가져오기는 import-jobs.mjs · 실행은 각 실험 진입점이 writeLabRecord로 남긴다

import { judgeLabRecord, LAB_ROOT, writeLabIndex } from "./store.mjs";
import { LAB_VARIANTS } from "./variants.mjs";

const [command, ...args] = process.argv.slice(2);
if (command === "index") {
  const lab = await writeLabIndex(LAB_ROOT, LAB_VARIANTS);
  console.log(`기록 ${lab.records.length}건 · ${LAB_ROOT}/lab.json`);
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
    '사용법: lab.mjs index | judge <사례> <변형> <단계> <회차> pass|fail "<메모>" [판정자]',
  );
  process.exit(2);
}
