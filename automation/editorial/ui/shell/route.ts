import { useCallback, useEffect, useState } from "react";

// 해시 경로 SSoT: "" 목록 · "#new" 새 글 · "#<작업 ID>" 작업 화면 (기존 공유 링크 호환)
export type Route = { page: "library" } | { page: "compose" } | { page: "run"; id: string };

const runId = /^[a-f0-9-]{36}$/;
function parseRoute(hash: string): Route {
  const value = hash.replace(/^#\/?/, "");
  if (value === "new") return { page: "compose" };
  if (runId.test(value)) return { page: "run", id: value };
  return { page: "library" };
}
function hrefOf(route: Route) {
  if (route.page === "compose") return "#new";
  if (route.page === "run") return `#${route.id}`;
  return location.pathname;
}
export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const sync = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const navigate = useCallback((next: Route) => {
    // 목록은 해시 없는 주소로 둔다 · pushState는 hashchange를 내지 않으므로 직접 반영
    history.pushState(null, "", next.page === "library" ? location.pathname : hrefOf(next));
    setRoute(next);
    window.scrollTo(0, 0);
  }, []);
  return { route, navigate };
}
