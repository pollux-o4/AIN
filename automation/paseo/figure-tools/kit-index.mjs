#!/usr/bin/env node
// 그림 키트 부품 목록(모델용) · 키트 소스에서 내보낸 함수·상수의 서명만 한 번에 보여 준다
// 모델이 키트 파일을 구간마다 나눠 읽고 grep하던 탐색(그림당 약 1분)을 한 번의 호출로 바꾼다 · 원본은 키트 소스(SSoT)
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// 정지 SVG 한 장에 쓰는 키트 파일 · 그 밖(WebGL·PDF·회전 감사 등)은 이 작업에서 쓰지 않는다
const STATIC_KITS = ["iso-kit.mjs", "lathe.mjs", "tube.mjs"];

/** 소스 한 개에서 내보낸 이름과 인자 서명을 줄마다 뽑는다 · 본문은 버린다 */
export function kitIndex(source) {
  const lines = [];
  for (const match of source.matchAll(
    /^export\s+(?:async\s+)?(function\s*\*?|const|let)\s+([A-Za-z_$][\w$]*)\s*(=?\s*)([^\n]*)/gm,
  )) {
    const [, kind, name, , rest] = match;
    if (kind.startsWith("function")) {
      lines.push(`${name}${signature(rest)}`);
      continue;
    }
    const arrow = rest.match(/^(?:async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
    lines.push(arrow ? `${name}${arrow[1].startsWith("(") ? arrow[1] : `(${arrow[1]})`}` : name);
  }
  return lines;
}

// 서명은 첫 줄의 괄호 짝까지만 · 기본값 객체가 길어도 한 줄로 남긴다
function signature(rest) {
  let depth = 0;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "(") depth += 1;
    if (rest[i] === ")" && --depth === 0) return rest.slice(0, i + 1);
  }
  return rest.replace(/\s*\{\s*$/, "");
}

// 화면 방향을 말로 · 모델이 투영 공식을 풀어 축 방향을 추론하던 시간(수천 토큰)을 없앤다 · 값은 키트 투영에서 계산
const SCREEN = (dx, dy) => {
  const h = Math.abs(dx) < 0.05 ? "" : dx > 0 ? "오른쪽" : "왼쪽";
  const v = Math.abs(dy) < 0.05 ? "" : dy > 0 ? "아래" : "위";
  return [h, v].filter(Boolean).join(" ") || "제자리";
};
export function axisNotes(iso, depthOf) {
  const projection = { scale: 1, origin: [0, 0] };
  const lines = [
    ["+x", [1, 0, 0]],
    ["+y", [0, 1, 0]],
    ["+z", [0, 0, 1]],
  ].map(([name, v]) => {
    const [sx, sy] = iso(v, projection);
    const depth = depthOf ? depthOf(v, projection) : 0;
    return `${name} → 화면 ${SCREEN(sx, sy)} (${sx.toFixed(2)}, ${sy.toFixed(2)}) · 깊이 ${depth > 0 ? "+" : ""}${depth.toFixed(2)}`;
  });
  return [
    "기본 카메라 축 방향(scale 1, origin [0,0]) · depthOf가 클수록 보는 사람 쪽이므로 나중에 그린다",
    ...lines,
  ];
}

async function main([dir]) {
  if (!dir) {
    console.log("사용법: kit-index.mjs <anatomy 스킬의 kit 폴더>");
    process.exit(2);
  }
  const root = resolve(dir);
  const present = new Set(await readdir(root));
  if (present.has("iso-kit.mjs")) {
    const kit = await import(pathToFileURL(join(root, "iso-kit.mjs")).href);
    if (typeof kit.iso === "function")
      console.log(`${axisNotes(kit.iso, kit.depthOf).join("\n")}\n`);
  }
  for (const file of STATIC_KITS.filter((name) => present.has(name))) {
    const names = kitIndex(await readFile(join(root, file), "utf8"));
    console.log(`## ${join(root, file)} (${names.length})\n${names.join("\n")}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(process.argv.slice(2)).catch((error) => {
    console.error(String(error?.message ?? error));
    process.exit(1);
  });
