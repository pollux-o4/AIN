import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { LIVE_RUNTIME_DIR } from "../../contracts/runtime.mjs";
import { importGoReport } from "./go-report.mjs";
import { buildTool, fixture } from "./go-runtime.mjs";
import { LAB_ROOT } from "./store.mjs";
import { objectPolicy } from "./variants.mjs";

async function main() {
  const args = process.argv.slice(2);
  const legacy = args[0] === "--legacy";
  if (legacy) args.shift();
  const [articleId, caseId, variant, trialArg = "1"] = args;
  const trial = Number(trialArg);
  if (
    !articleId ||
    !/^[a-z0-9][a-z0-9-]{0,39}$/.test(caseId ?? "") ||
    !variant ||
    !Number.isSafeInteger(trial) ||
    trial < 1 ||
    args.length > 4
  ) {
    throw new Error("사용법: lab:import -- [--legacy] <글 id 앞부분> <사례> <변형> [회차]");
  }
  objectPolicy(variant);
  if (legacy) {
    const { importArticle } = await import("./import.mjs");
    const records = await importArticle({
      jobsDir: `${LIVE_RUNTIME_DIR}/jobs`,
      articleId,
      caseId,
      variant,
      trial,
      ref: null,
    });
    return records;
  }
  const source = realpathSync(process.env.AIN_DATA_DIR || LIVE_RUNTIME_DIR);
  const lab = resolve(LAB_ROOT);
  if (variant !== "baseline" || source === lab || source.startsWith(lab + sep))
    throw new Error("Go 앱 기록은 기본 변형으로 가져옵니다. 연구소 변형은 lab:run에서 기록합니다.");
  const scratch = mkdtempSync(resolve(tmpdir(), "ain-lab-import-"));
  try {
    const tool = buildTool(scratch, "labfixture", "./tools/labfixture");
    const report = fixture(tool, "report", { source, from: articleId });
    return await importGoReport({ report, caseId, variant, trial });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  const records = await main();
  console.log(`가져옴: 기록 ${records.length}건`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
