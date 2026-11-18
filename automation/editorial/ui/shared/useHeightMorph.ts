import { useLayoutEffect, useRef } from "react";

// key가 바뀌어 내용이 갈릴 때 이전 높이에서 새 높이로 이어 준다(FLIP) · 높이가 한 프레임에 튀지 않게
export function useHeightMorph<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  const last = useRef<number | null>(null);
  const playing = useRef<Animation[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key 변경 자체가 전환 신호
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 전환 도중 다시 바뀌면 지금 보이는 높이에서 이어 간다(애니메이션이 쌓이지 않게)
    const running = playing.current.some((a) => a.playState === "running");
    const from = running ? el.getBoundingClientRect().height : last.current;
    for (const animation of playing.current) animation.cancel();
    playing.current = [];
    const to = el.getBoundingClientRect().height;
    last.current = to;
    // 접혀 있던(0) 상태에서 여는 동작은 도크 자체 전환이 맡는다
    if (!from || from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ease = getComputedStyle(el).getPropertyValue("--ease").trim() || "ease-out";
    playing.current.push(
      el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 260, easing: ease }),
    );
    const fade = el.firstElementChild?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 180,
      delay: 60,
      easing: "linear",
      fill: "backwards",
    });
    if (fade) playing.current.push(fade);
  }, [key]);
  // 같은 탭 안에서 내용이 자라도 다음 전환의 출발 높이가 맞도록 갱신
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!playing.current.some((a) => a.playState === "running"))
        last.current = el.getBoundingClientRect().height;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}
