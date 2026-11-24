import { importArticle } from "./import.mjs";

const [articleId, caseId, variant, trialArg = "1"] = process.argv.slice(2);
if (!articleId || !caseId || !variant) {
  console.error("사용법: node import-jobs.mjs <글 id 앞부분> <사례 앞이름> <변형> [회차]");
  process.exit(2);
}

const records = await importArticle({
  jobsDir: ".local/ai-runtime/jobs",
  articleId,
  caseId,
  variant,
  trial: Number(trialArg),
  ref: null,
});
console.log(`가져옴: 기록 ${records.length}건`);
