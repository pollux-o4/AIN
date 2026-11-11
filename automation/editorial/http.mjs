import { createHmac, timingSafeEqual } from "node:crypto";
import MarkdownIt from "markdown-it";
import { readAsset } from "./assets.mjs";
import { readJson } from "./http-json.mjs";
import { streamActivity } from "./http-stream.mjs";

const markdown = new MarkdownIt({ html: false, linkify: false }).disable("image");
const json = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
const equal = (a, b) => {
  const x = Buffer.from(a ?? ""),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export function editorialHttp({
  service,
  token,
  agentToken = null,
  n8nUrl = "http://localhost:5678",
}) {
  if (agentToken !== null && (agentToken.length < 32 || agentToken === token))
    throw new Error("Agent token must be separate and at least 32 characters");
  const session = createHmac("sha256", token).update("ain-editorial-ui").digest("hex");
  return async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    const advance = path.match(/^\/editorial\/runs\/([a-f0-9-]{36})\/advance$/);
    if (advance) {
      if (!equal(req.headers.authorization, `Bearer ${token}`)) {
        json(res, 401, { error: "Unauthorized" });
      } else if (req.method !== "POST") {
        json(res, 405, { error: "지원하지 않는 요청입니다." });
      } else {
        try {
          json(res, 200, await service.advance(advance[1], await readJson(req)));
        } catch (error) {
          json(res, error.status ?? 500, {
            error: error.status ? error.message : "작업을 진행하지 못했습니다.",
          });
        }
      }
      return true;
    }
    if (!path.startsWith("/write")) return false;
    try {
      // shortcut: loopback 단일 소유자 화면·동일 출처 쿠키 인증, 외부 호스팅 전 계정별 접근 제어 도입
      const origin = new URL(`http://${req.headers.host}`);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) {
        json(res, 403, { error: "로컬 주소에서 열어 주세요." });
        return true;
      }
      if (path === "/write") {
        res.writeHead(302, { Location: "/write/" });
        res.end();
        return true;
      }
      const sessionCookie = `editorial-session=${session}; HttpOnly; SameSite=Strict; Path=/write/`;
      if (req.method === "GET" && path === "/write/session") {
        if (req.headers.origin && req.headers.origin !== origin.origin) {
          json(res, 403, { error: "다른 사이트의 요청은 허용하지 않습니다." });
          return true;
        }
        res.writeHead(204, { "Set-Cookie": sessionCookie, "Cache-Control": "no-store" });
        res.end();
        return true;
      }
      const asset = req.method === "GET" ? await readAsset(path) : null;
      if (asset) {
        res.writeHead(200, {
          "Content-Type": asset.type,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          ...(path === "/write/"
            ? {
                "Set-Cookie": sessionCookie,
              }
            : {}),
        });
        res.end(asset.content);
        return true;
      }
      if (path.startsWith("/write/assets/")) {
        json(res, 404, { error: "화면을 찾을 수 없습니다." });
        return true;
      }
      // 에이전트 CLI: 별도 로컬 토큰 · 브라우저 요청(Origin 포함)은 화면 쿠키 경로만 허용 · AGENT-001
      const agent =
        agentToken !== null &&
        !req.headers.origin &&
        equal(req.headers.authorization, `Bearer ${agentToken}`);
      if (!agent) {
        const cookie = req.headers.cookie
          ?.split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("editorial-session="))
          ?.slice(18);
        if (!equal(cookie, session)) {
          json(res, 401, { error: "글쓰기 화면을 다시 열어 주세요." });
          return true;
        }
        if (req.headers.origin && req.headers.origin !== origin.origin) {
          json(res, 403, { error: "다른 사이트의 요청은 허용하지 않습니다." });
          return true;
        }
        if (req.method === "POST" && req.headers.origin !== origin.origin) {
          json(res, 403, { error: "글쓰기 화면에서 요청해 주세요." });
          return true;
        }
      }
      if (req.method === "GET" && path === "/write/api/runs") {
        json(res, 200, {
          runs: service.list(),
        });
        return true;
      }
      if (req.method === "POST" && path === "/write/api/runs") {
        json(res, 202, await service.create(await readJson(req)));
        return true;
      }
      const stream = path.match(/^\/write\/api\/runs\/([a-f0-9-]{36})\/activity$/);
      if (stream && req.method === "GET") {
        streamActivity(res, service, stream[1]);
        return true;
      }
      const match = path.match(
        /^\/write\/api\/runs\/([a-f0-9-]{36})(\/actions|\/archive|\/download|\/history)?$/,
      );
      if (!match) {
        json(res, 404, { error: "화면을 찾을 수 없습니다." });
        return true;
      }
      const [, id, action] = match;
      if (req.method === "GET" && action === "/history") {
        json(res, 200, await service.history(id));
        return true;
      }
      if (req.method === "GET" && action === "/download") {
        const revision = new URL(req.url, origin).searchParams.get("revision");
        const file = service.download(id, revision);
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${file.filename}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(file.text);
        return true;
      }
      if (req.method === "POST" && action === "/actions") {
        json(res, 200, await service.action(id, await readJson(req)));
        return true;
      }
      if (req.method === "POST" && action === "/archive") {
        json(res, 200, await service.archive(id));
        return true;
      }
      if (req.method === "GET" && !action) {
        const view = service.get(id);
        const heading = `# ${view.title}\n`;
        const body = view.text.startsWith(heading) ? view.text.slice(heading.length) : view.text;
        const executionIds = new Set(
          (view.monitor?.events ?? []).map((event) => event.executionId).filter(Boolean),
        );
        if (view.monitor?.executionId) executionIds.add(view.monitor.executionId);
        const executionLinks = [...executionIds].map((id) => ({
          id,
          url: `${n8nUrl}/workflow/blogEditorialServiceV1/executions/${encodeURIComponent(id)}`,
        }));
        json(res, 200, { ...view, html: markdown.render(body), executionLinks });
        return true;
      }
      json(res, 405, { error: "지원하지 않는 요청입니다." });
    } catch (error) {
      json(res, error.status ?? 500, {
        error: error.status ? error.message : "요청을 처리하지 못했습니다. 입력은 보존돼 있습니다.",
      });
    }
    return true;
  };
}
