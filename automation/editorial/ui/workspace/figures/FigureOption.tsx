import type { ReactNode } from "react";
import type { Picks } from "./usePicked";

// 도크의 그림 고르기 한 줄 · 고르기·확인·다시 그리기 목록이 같은 틀(체크·제목·덧붙임)을 쓴다
// label은 체크와 묶이는 제목, children은 제목 아래 덧붙임(자리·인용·이동 단추 등)
export function FigureOption({
  scope,
  id,
  picks,
  label,
  labelledBy,
  children,
}: {
  scope: string;
  id: string;
  picks: Picks;
  label: ReactNode;
  labelledBy?: string;
  children?: ReactNode;
}) {
  const inputId = `${scope}-${id}`;
  return (
    <div className="figure-option">
      <input
        id={inputId}
        type="checkbox"
        name="figures"
        value={id}
        checked={picks.picked.includes(id)}
        onChange={() => picks.toggle(id)}
        aria-labelledby={labelledBy}
      />
      <span>
        <label htmlFor={inputId}>{label}</label>
        {children}
      </span>
    </div>
  );
}
