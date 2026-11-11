#!/usr/bin/env bash
# GNOME 실행기: 편집 서비스가 없으면 `mise run editorial`로 띄우고 글쓰기 화면을 연다.
set -euo pipefail
root="$(cd -- "$(dirname -- "$(readlink -f -- "$0")")/../../.." && pwd)"
url="http://localhost:3230/write/"
health="http://127.0.0.1:3230/healthz"
log_dir="$root/.local/ai-runtime"
mise="$(command -v mise || echo "$HOME/.local/bin/mise")"
up() { curl -fsS -m 1 "$health" >/dev/null 2>&1; }

cd "$root"
mkdir -p "$log_dir"
if ! curl -fsS -m 1 http://127.0.0.1:6767/ >/dev/null 2>&1; then
  "$mise" exec -- paseo daemon start >>"$log_dir/desktop.log" 2>&1 || true
fi
if ! up; then
  notify-send -i "$root/automation/runtime/desktop/ain.svg" "AIN" "글쓰기 서비스를 시작합니다" 2>/dev/null || true
  setsid "$mise" run editorial >>"$log_dir/desktop.log" 2>&1 < /dev/null &
  for _ in $(seq 1 120); do up && break; sleep 1; done
fi
if up; then
  exec xdg-open "$url"
fi
notify-send -u critical "AIN" "시작 실패: $log_dir/desktop.log 확인" 2>/dev/null || true
exit 1
