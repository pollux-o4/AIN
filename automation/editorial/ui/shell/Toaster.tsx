import { useEffect } from "react";
import type { Toast } from "../tracking/useEditorialSession";

// 한 번에 하나 · 6초 뒤 자동으로 닫힘 · 되돌리기 동작은 선택
export function Toaster({ toast, onClose }: { toast: Toast | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [toast, onClose]);
  return (
    <div className="toaster" aria-live="polite">
      {toast && (
        <div className="toast">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                toast.undo?.();
                onClose();
              }}
            >
              되돌리기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
