import { readFile } from "node:fs/promises";

const root = new URL("../../.local/editorial-web/", import.meta.url);

export async function readAsset(path) {
  const name =
    path === "/write/" ? "index.html" : path.match(/^\/write\/assets\/([\w-]+\.(?:js|css))$/)?.[1];
  if (!name) return null;
  const relative = name === "index.html" ? name : `assets/${name}`;
  let content;
  try {
    content = await readFile(new URL(relative, root));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (name !== "index.html") return null;
    throw Object.assign(
      new Error("글쓰기 화면을 준비하지 못했습니다. 서비스를 다시 시작해 주세요."),
      {
        status: 503,
      },
    );
  }
  const type = name.endsWith(".js")
    ? "text/javascript; charset=utf-8"
    : name.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "text/html; charset=utf-8";
  return { content, type };
}
