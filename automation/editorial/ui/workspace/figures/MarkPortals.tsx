import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { useArticleTargets } from "./useArticleTargets";

// 서버가 본문 HTML에 남긴 표시(선택자)마다 화면 요소를 채운다 · 무엇을 그릴지는 render가 정한다
export function MarkPortals({
  article,
  html,
  selector,
  idOf,
  render,
}: {
  article: RefObject<HTMLElement | null>;
  html: string;
  selector: string;
  idOf: (target: HTMLElement) => string;
  render: (id: string, target: HTMLElement) => ReactNode;
}) {
  const targets = useArticleTargets(article, html, selector);
  return targets.map((target) => {
    const id = idOf(target);
    const node = render(id, target);
    return node ? createPortal(node, target, id) : null;
  });
}
