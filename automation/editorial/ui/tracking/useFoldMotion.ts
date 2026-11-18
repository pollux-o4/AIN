import { useLayoutEffect, useRef } from "react";

// 지도 칸이 접히거나 펼쳐질 때 이전 자리에서 새 자리로 이어 준다(FLIP).
// 칸은 data-key로 구분하고, 새로 생긴 칸은 data-from이 가리키는 칸의 이전 자리에서 출발한다.
// 매 렌더마다 자리를 새로 재 두어 화면 폭이 바뀌어도 출발점이 맞다. 위치는 목록 안 좌표(offsetLeft)로 재므로 지도 스크롤과 무관하다. 동작 줄이기 설정이면 바로 바꾼다.
type Box = { left: number; width: number };
const DURATION = 360;

export function useFoldMotion<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null);
  const boxes = useRef(new Map<string, Box>());
  const lastKey = useRef(key);
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const items = [...list.querySelectorAll<HTMLElement>(":scope > [data-key]")];
    const before = boxes.current;
    const changed = lastKey.current !== key;
    lastKey.current = key;
    boxes.current = new Map(
      items.map((el) => [el.dataset.key ?? "", { left: el.offsetLeft, width: el.offsetWidth }]),
    );
    if (!changed || !before.size || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ease = getComputedStyle(list).getPropertyValue("--ease").trim() || "ease-out";
    for (const el of items) {
      const to = boxes.current.get(el.dataset.key ?? "");
      const own = before.get(el.dataset.key ?? "");
      const from = own ?? unionOf(before, el.dataset.from?.split(" ") ?? []);
      if (!to || !from) continue;
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const sx = own ? 1 : Math.max(0.2, from.width / Math.max(1, to.width));
      if (own && Math.abs(dx) < 1) continue;
      el.animate(
        [
          { transform: `translateX(${dx}px) scaleX(${sx})`, opacity: own ? 1 : 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: DURATION, easing: ease },
      );
    }
  });
  return ref;
}

function unionOf(boxes: Map<string, Box>, keys: string[]): Box | undefined {
  const found = keys.map((k) => boxes.get(k)).filter((b): b is Box => !!b);
  if (!found.length) return undefined;
  const left = Math.min(...found.map((b) => b.left));
  const right = Math.max(...found.map((b) => b.left + b.width));
  return { left, width: right - left };
}
