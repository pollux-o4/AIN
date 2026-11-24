// 발행용 넘기기 · 사람이 승인한 회차의 본문과 승인 때 확인된 그림만 묶는다(ADR-0012)
// 작업용 내보내기(export)와 달리 회차·형식을 고를 수 없다 · 최종 판정은 보내는 쪽 책임
import { handoffRequest } from "../../contracts/handoff.mjs";
import { PUBLICATION_READY } from "../../contracts/status.mjs";
import { exportArticle } from "../export/index.mjs";
import { fail } from "./lifecycle.mjs";
import { titleOf } from "./view.mjs";

/** @param {any} run */
function publicationBundle(run) {
  const { state } = run;
  const approval = state.approval;
  if (state.status !== PUBLICATION_READY || approval?.revision !== state.revision)
    fail("발행 준비가 승인된 글만 넘길 수 있습니다. 화면에서 승인해 주세요.", 409);
  const text = state.artifacts?.draft?.output?.text;
  if (typeof text !== "string" || !text) fail("넘길 본문이 없습니다.", 409);
  const approved = new Set(approval.figures);
  const figures = (state.figure?.items ?? []).filter((item) => approved.has(item.id));
  const approvedAt =
    run.events?.findLast((event) => event.kind === "authorize_publication")?.at ?? null;
  const article = { id: run.id, title: titleOf(run), revision: approval.revision, text, figures };
  const bundle = exportArticle(
    { ...article, approval: { revision: approval.revision, approvedAt } },
    { format: "zip", motion: "animated" },
  );
  return { article, bundle };
}

/** 묶음을 보낼 폴더에 두고 받는 쪽에 줄 요청 문구를 돌려준다
 * @param {any} run @param {{ write: (name: string, body: Uint8Array) => Promise<string> } | null} outbox */
export async function handoff(run, outbox) {
  if (!outbox) fail("보낼 폴더가 설정되지 않았습니다.", 503);
  const { article, bundle } = publicationBundle(run);
  const path = await outbox.write(bundle.filename, bundle.body);
  return { path, request: handoffRequest({ ...article, path }) };
}
