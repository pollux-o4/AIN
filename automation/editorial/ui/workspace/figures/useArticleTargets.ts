import { type RefObject, useLayoutEffect, useState } from "react";

// 서버가 렌더링한 본문 HTML 속 자리(선택자)를 찾는다 · 본문이 바뀌면 다시 찾는다
export function useArticleTargets(
  article: RefObject<HTMLElement | null>,
  html: string,
  selector: string,
) {
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 본문 HTML이 바뀌면 자리를 다시 찾는다
  useLayoutEffect(() => {
    setTargets(Array.from(article.current?.querySelectorAll<HTMLElement>(selector) ?? []));
  }, [article, html, selector]);
  return targets;
}
