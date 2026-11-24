import { type RefObject, useEffect } from "react";
import { FIGURE_MOTION_ATTR, staticFigureSrc } from "../../../contracts/figure.mjs";

// 움직이는 그림은 화면에 보일 때만 재생 · 관찰자 하나를 모든 그림이 나눠 쓴다(본문·확인 목록 공통)
let observer: IntersectionObserver | null = null;
function shared() {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting } of entries) {
        const img = target as HTMLImageElement;
        const src = img.getAttribute(FIGURE_MOTION_ATTR);
        if (src) img.src = isIntersecting ? src : staticFigureSrc(src);
      }
    },
    { rootMargin: "100px 0px" },
  );
  return observer;
}

/** root 아래 움직이는 그림을 관찰 · deps가 바뀌면(본문 다시 그림) 다시 찾는다 */
export function useFigureMotion(root: RefObject<Element | null>, deps: unknown[]) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: 호출자가 내용 변경 표식을 넘긴다
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === "undefined") return;
    const images = [...root.current.querySelectorAll(`img[${FIGURE_MOTION_ATTR}]`)];
    for (const img of images) shared().observe(img);
    return () => {
      for (const img of images) observer?.unobserve(img);
    };
  }, [root, ...deps]);
}
