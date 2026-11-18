import { type ReactNode, type RefObject, useEffect, useRef } from "react";

// 서버가 렌더링한 본문 · 덧붙일 표시(시각자료 자리 등)는 children이 본문 요소를 받아 그린다
export function Article({
  html,
  children,
}: {
  html: string;
  children?: (article: RefObject<HTMLElement | null>) => ReactNode;
}) {
  const article = useRef<HTMLElement>(null);
  // 새 본문이 오면 문단 순서대로 등장 모션을 다시 건다
  useEffect(() => {
    const element = article.current;
    if (!element || !html) return;
    Array.from(element.children).forEach((child, index) => {
      if (child instanceof HTMLElement) child.style.setProperty("--i", String(index));
    });
    element.classList.remove("fresh");
    void element.offsetWidth;
    element.classList.add("fresh");
  }, [html]);
  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 동일 출처 서버가 markdown-it html:false로 렌더링한 HTML만 사용 */}
      <article id="article" ref={article} dangerouslySetInnerHTML={{ __html: html }} />
      {children?.(article)}
    </>
  );
}
