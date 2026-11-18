import { type MouseEvent, useEffect, useRef, useState } from "react";
import type { Run } from "../shared/api";
import { Icon } from "../shared/Icon";

// 내보내기: 자주 쓰는 TXT는 바로, 나머지 형식은 펼쳐서 · 그림은 사람이 확인한 것만 들어감 · ADR-0012
const MORE = [
  { format: "html", label: "HTML 문서", hint: "그림이 들어간 문서 한 파일" },
  { format: "zip", label: "묶음 ZIP", hint: "원고 md·html·그림 SVG·배치 정보" },
] as const;

export function ExportMenu({ run, online }: { run: Run; online: boolean }) {
  const [still, setStill] = useState(false);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // 메뉴 버튼 패턴: 바깥 누르기·Esc로 닫고, Esc면 포커스를 버튼으로 돌린다
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);
  const figures = run.figure?.phase === "confirmed" && run.textRevision === run.revision;
  const offline = (event: MouseEvent) => {
    if (!online) event.preventDefault();
  };
  const href = (format: string) => {
    const query = new URLSearchParams({
      format,
      revision: String(run.textRevision),
      ...(still ? { motion: "static" } : {}),
    });
    return `/write/api/runs/${run.id}/export?${query}`;
  };
  return (
    <div className="export-actions" hidden={!run.canDownload}>
      <a
        id="download"
        className="download"
        href={`/write/api/runs/${run.id}/download`}
        download
        aria-disabled={!online}
        onClick={offline}
      >
        <Icon name="download" />
        TXT 내려받기
      </a>
      <div id="export-more" className="export-menu" ref={menu}>
        <button
          ref={trigger}
          type="button"
          className="quiet"
          aria-expanded={open}
          aria-controls="export-panel"
          onClick={() => setOpen((value) => !value)}
        >
          다른 형식
        </button>
        <div id="export-panel" className="export-panel" hidden={!open}>
          <ul>
            {MORE.map(({ format, label, hint }) => (
              <li key={format}>
                <a
                  id={`export-${format}`}
                  className="download"
                  href={href(format)}
                  download
                  aria-disabled={!online}
                  aria-describedby={`export-${format}-hint`}
                  onClick={offline}
                >
                  {label}
                </a>
                <span id={`export-${format}-hint`} className="hint">
                  {hint}
                </span>
              </li>
            ))}
          </ul>
          {figures && (
            <label className="hint export-still">
              <input
                id="export-still"
                type="checkbox"
                checked={still}
                onChange={(event) => setStill(event.target.checked)}
              />
              그림 움직임 멈춤(첫 장면으로 고정)
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
