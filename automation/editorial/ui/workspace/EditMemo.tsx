import type { Run } from "../shared/api";
import { withOccurrenceKeys } from "../shared/listKeys";

// 편집 메모(사람 피드백 해석)와 남은 요구사항 미충족 · ADR-0007·0008·0010
const levelNames: Record<string, string> = {
  developmental: "구조 편집",
  line: "문장 편집",
  copy: "교열",
};

function Items({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <dt>{title}</dt>
      <dd>
        <ul>
          {withOccurrenceKeys(items).map(({ value, key }) => (
            <li key={key}>{value}</li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

// 확인 대기 중 해석 입력은 작업 도크가 맡는다(DOCK-001) · 여기는 확정된 해석 기록만
export function EditMemo({ run }: { run: Run }) {
  const { brief, unmetRequirements } = run;
  return (
    <>
      {unmetRequirements.length > 0 && (
        <section id="unmet" aria-labelledby="unmet-title">
          <h2 id="unmet-title">요구사항 미충족</h2>
          <p className="hint">자동 재작성 후에도 남았습니다. 수정 요청으로 이어가 주세요.</p>
          <ul>
            {withOccurrenceKeys(unmetRequirements).map(({ value, key }) => (
              <li key={key}>{value}</li>
            ))}
          </ul>
        </section>
      )}
      {brief && !run.canApproveBrief && (
        <section id="edit-memo" aria-labelledby="edit-memo-title">
          <h2 id="edit-memo-title">수정 해석</h2>
          <MemoFacts brief={brief} />
        </section>
      )}
    </>
  );
}

function MemoFacts({ brief }: { brief: NonNullable<Run["brief"]> }) {
  return (
    <>
      <p className="hint">
        {brief.approvedBy === "user"
          ? "확인한 해석으로 수정했습니다."
          : "요청을 이렇게 이해했습니다. 다르면 수정 요청으로 바로잡아 주세요."}
      </p>
      <dl className="design-facts">
        <div>
          <dt>의도</dt>
          <dd>
            {brief.intent}
            {brief.level && <small>{levelNames[brief.level] ?? brief.level}</small>}
          </dd>
        </div>
        <Items title="우선순위" items={brief.priorities} />
        <Items title="살릴 것" items={brief.preserve} />
        <Items title="요구 변경" items={brief.requirementChanges} />
        <Items title="가정" items={brief.assumptions} />
      </dl>
    </>
  );
}
