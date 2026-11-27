#!/usr/bin/env bash
# GNOME 실행기: `mise run editorial:start`로 서비스를 준비(이전 코드면 재시작)하고 글쓰기 화면을 연다.
set -euo pipefail
root="$(cd -- "$(dirname -- "$(readlink -f -- "$0")")/../../.." && pwd)"
listen="${AIN_LISTEN:-127.0.0.1:3230}"
url="http://$listen/write/"
log_dir="${AIN_GO_CONTROL_DIR:-$root/.local/editorial-go}"
mise="$(command -v mise || echo "$HOME/.local/bin/mise")"

cd "$root"
umask 077
mkdir -p "$log_dir"
notify-send -i "$root/automation/runtime/desktop/ain.svg" "AIN" "글쓰기 서비스를 준비합니다" 2>/dev/null || true
if "$mise" run editorial:start >>"$log_dir/desktop.log" 2>&1 < /dev/null; then
  exec xdg-open "$url"
fi
notify-send -u critical "AIN" "시작 실패: $log_dir/desktop.log 확인" 2>/dev/null || true
exit 1
