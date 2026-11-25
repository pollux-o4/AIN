import { type RefObject, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { Candidate } from "./plan";
import { type Picked, selectPicked, TextIndex } from "./textIndex";

// 본문 글자 색인 · 본문(html)이 바뀔 때만 한 번 만든다
export function useTextIndex(article: RefObject<HTMLElement | null>, html: string) {
  const [index, setIndex] = useState<TextIndex | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 본문이 다시 그려질 때(html) 새로 색인한다
  useLayoutEffect(() => {
    setIndex(article.current ? new TextIndex(article.current) : null);
  }, [article, html]);
  return index;
}

// 후보마다 본문 범위 · 서버가 준 평문 quote로 찾는다
export function useCandidateRanges(index: TextIndex | null, candidates: Candidate[]) {
  // 후보 범위가 같으면 같은 결과 · 화면이 새 응답을 받을 때마다 다시 찾지 않게
  const key = candidates.map((c) => `${c.id}\u0000${c.quote ?? c.anchor}`).join("\u0001");
  // biome-ignore lint/correctness/useExhaustiveDependencies: 후보 내용(key)이 바뀔 때만 다시 찾는다
  return useMemo(() => {
    const ranges = new Map<string, Picked>();
    if (!index) return ranges;
    for (const candidate of candidates) {
      const found = index.find(candidate.quote ?? candidate.anchor);
      if (found) ranges.set(candidate.id, found);
    }
    return ranges;
  }, [index, key]);
}

// 브라우저 선택을 문장 단위 범위로 따라간다 · hold면 선택이 풀려도(패널 입력 중) 범위를 유지한다
export function useSelectionPick(
  index: TextIndex | null,
  panel: RefObject<HTMLElement | null>,
  hold: boolean,
) {
  const [picked, setPicked] = useState<Picked | null>(null);
  useEffect(() => {
    if (!index) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (panel.current?.contains(selection?.anchorNode ?? null)) return;
        const next = index.fromSelection(selection);
        if (next) setPicked(next);
        else if (!hold && selection?.isCollapsed) setPicked(null);
      });
    };
    // 끌기·키 입력을 마치면 브라우저 선택도 문장 단위 범위에 맞춘다 · 도중에 바꾸면 끌기가 끊긴다
    const settle = () => {
      const next = index.fromSelection(window.getSelection());
      if (next) selectPicked(next);
    };
    const onKey = (event: KeyboardEvent) => event.shiftKey || settle();
    document.addEventListener("selectionchange", update);
    document.addEventListener("pointerup", settle);
    document.addEventListener("keyup", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("pointerup", settle);
      document.removeEventListener("keyup", onKey);
    };
  }, [index, panel, hold]);
  return [picked, setPicked] as const;
}

// 범위 바로 아래 화면 위치 · 스크롤·크기 변경 때 다시 잰다
export function useAnchoredPosition(picked: Picked | null, width = 360) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!picked) {
      setAt(null);
      return;
    }
    const measure = () => {
      const rects = picked.range.getClientRects();
      const last = rects[rects.length - 1] ?? picked.range.getBoundingClientRect();
      const room = Math.min(width, window.innerWidth - 32);
      setAt({
        top: Math.min(last.bottom + 8, window.innerHeight - 56),
        left: Math.max(16, Math.min(last.left, window.innerWidth - room - 16)),
      });
    };
    measure();
    const options = { passive: true, capture: true };
    window.addEventListener("scroll", measure, options);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, options);
      window.removeEventListener("resize", measure);
    };
  }, [picked, width]);
  return at;
}
