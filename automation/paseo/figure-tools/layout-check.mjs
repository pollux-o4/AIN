#!/usr/bin/env node
// 그림 배치 점검 도구(모델용) · 그림 내용과 무관하게 SVG 한 장의 글자 배치만 잰다
// 렌더링 한 번으로 PNG와 겹침 목록을 함께 내어, 눈으로 여러 회차 찾던 겹침을 한 번에 고치게 한다
// 판정은 하지 않는다: 의도한 겹침인지는 모델이 PNG를 보고 정한다(JUDGE-001)
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { isAnimated, staticSvg } from "../../contracts/svg-motion.mjs";

/** @typedef {{ x: number, y: number, w: number, h: number }} Box */

// 브라우저 안에서 실행 · 화면 좌표가 아니라 viewBox 좌표로 돌려준다
/* c8 ignore start */
function measure() {
  const svg = document.querySelector("svg");
  if (!svg) return { error: "svg 요소가 없습니다" };
  const toView = svg.getScreenCTM()?.inverse();
  const point = (x, y) => new DOMPoint(x, y).matrixTransform(toView);
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    const a = point(r.left, r.top);
    const b = point(r.right, r.bottom);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  };
  const vb = svg.viewBox.baseVal;
  const visible = (el) => {
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
  };
  const texts = [...svg.querySelectorAll("text")]
    .filter((el) => visible(el) && el.textContent.trim())
    .map((el) => ({ text: el.textContent.trim().slice(0, 30), box: boxOf(el) }));
  // 채움 없는 선(지시선·화살표·점선)만 본다 · 면 위의 라벨은 의도한 배치가 많다
  const strokes = [...svg.querySelectorAll("line, polyline, path")]
    .filter((el) => {
      const style = getComputedStyle(el);
      return (
        visible(el) && style.stroke !== "none" && (style.fill === "none" || el.tagName === "line")
      );
    })
    .map((el) => {
      const length = el.getTotalLength();
      const steps = Math.min(400, Math.max(8, Math.ceil(length / 2)));
      const ctm = el.getScreenCTM();
      const points = [];
      for (let i = 0; i <= steps; i += 1) {
        const p = el.getPointAtLength((length * i) / steps).matrixTransform(ctm);
        const v = point(p.x, p.y);
        points.push([v.x, v.y]);
      }
      return { id: el.id || el.getAttribute("class") || el.tagName, points };
    });
  // 그림 내용 상자 · 화면 전체를 덮는 배경 면은 뺀다
  const viewArea = vb.width * vb.height;
  const parts = [
    ...svg.querySelectorAll("path, line, polyline, polygon, rect, circle, ellipse, text"),
  ]
    .filter((el) => visible(el))
    .map(boxOf)
    // 화면 밖으로 번진 그림자 등은 보이는 부분만 센다
    .map((b) => {
      const x = Math.max(b.x, vb.x);
      const y = Math.max(b.y, vb.y);
      return {
        x,
        y,
        w: Math.min(b.x + b.w, vb.x + vb.width) - x,
        h: Math.min(b.y + b.h, vb.y + vb.height) - y,
      };
    })
    .filter((b) => b.w * b.h < viewArea * 0.6 && b.w > 0 && b.h > 0);
  const content = parts.length
    ? parts.reduce((u, b) => {
        const x = Math.min(u.x, b.x);
        const y = Math.min(u.y, b.y);
        return {
          x,
          y,
          w: Math.max(u.x + u.w, b.x + b.w) - x,
          h: Math.max(u.y + u.h, b.y + b.h) - y,
        };
      })
    : null;
  return { view: { x: vb.x, y: vb.y, w: vb.width, h: vb.height }, texts, strokes, content };
}
/* c8 ignore stop */

const inside = (/** @type {Box} */ b, [x, y], pad = 0) =>
  x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad;
const overlap = (/** @type {Box} */ a, /** @type {Box} */ b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const at = (/** @type {Box} */ b) => `(${Math.round(b.x)},${Math.round(b.y)})`;

const clips = (/** @type {Box} */ b, view) =>
  b.x < view.x || b.y < view.y || b.x + b.w > view.x + view.w || b.y + b.h > view.y + view.h;
const textsHit = (/** @type {Box} */ b, texts, self) =>
  texts.some((t) => {
    if (t === self) return false;
    const smaller = Math.min(b.w * b.h, t.box.w * t.box.h);
    return smaller > 0 && overlap(b, t.box) / smaller > 0.15;
  });
// 선 몸통(끝 10% 제외)이 상자 안을 3점 이상 지나면 가로지른 것 · 라벨에 닿는 지시선 끝은 넘긴다
const bodyOf = (s) =>
  s.points.slice(Math.ceil(s.points.length * 0.1), Math.floor(s.points.length * 0.9));
const strokeHits = (/** @type {Box} */ b, strokes) =>
  strokes.filter((s) => bodyOf(s).filter((p) => inside(b, p)).length >= 3);

// 겹친 글자를 옮길 가장 가까운 빈자리 · 판정이 아니라 후보이며, 옮길지와 지시선은 모델이 정한다
const SHIFT_STEP = 4;
const SHIFT_MAX = 60;
export function freeShift(text, { view, texts, strokes }) {
  for (let r = SHIFT_STEP; r <= SHIFT_MAX; r += SHIFT_STEP)
    for (const [ux, uy] of [
      [0, -1],
      [0, 1],
      [1, 0],
      [-1, 0],
      [1, -1],
      [-1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const b = { ...text.box, x: text.box.x + ux * r, y: text.box.y + uy * r };
      if (!clips(b, view) && !textsHit(b, texts, text) && !strokeHits(b, strokes).length)
        return [ux * r, uy * r];
    }
  return null;
}

/** 측정값에서 겹침 목록을 만든다 · 브라우저 없이 시험할 수 있게 분리 */
export function layoutIssues(measured) {
  const { view, texts, strokes } = measured;
  const issues = [];
  const tail = (t) => {
    const shift = freeShift(t, measured);
    return shift ? ` · 빈자리 후보 translate(${shift[0]},${shift[1]})` : " · 60 안에 빈자리 없음";
  };
  for (const t of texts)
    if (clips(t.box, view)) issues.push(`잘림: "${t.text}" ${at(t.box)} 이 viewBox 밖으로 나감`);
  for (let i = 0; i < texts.length; i += 1)
    for (let j = i + 1; j < texts.length; j += 1)
      if (textsHit(texts[i].box, [texts[j]], texts[i]))
        issues.push(
          `글자 겹침: "${texts[i].text}" ${at(texts[i].box)} ↔ "${texts[j].text}" ${at(texts[j].box)}${tail(texts[j])}`,
        );
  // 같은 글자를 지나는 선은 한 줄로 묶는다 · 면 위 글자는 모서리 선 여럿이 함께 걸려 목록만 길어진다
  for (const t of texts) {
    const hits = strokeHits(t.box, strokes);
    if (hits.length)
      issues.push(
        `선이 글자를 지남: "${t.text}" ${at(t.box)} ← ${[...new Set(hits.map((s) => s.id))].join(", ")} ${hits.length}개${tail(t)}`,
      );
  }
  return issues;
}

// 내용 상자 대비 여백 · 넓으면 viewBox만 고치면 되도록 권장값을 준다(원본 재작성 방지)
const FRAME_PAD = 16;
export function framing({ view, content }) {
  if (!content) return null;
  const pad = {
    left: content.x - view.x,
    top: content.y - view.y,
    right: view.x + view.w - (content.x + content.w),
    bottom: view.y + view.h - (content.y + content.h),
  };
  const fill = Math.round(((content.w * content.h) / (view.w * view.h)) * 100);
  const fit = [
    content.x - FRAME_PAD,
    content.y - FRAME_PAD,
    content.w + FRAME_PAD * 2,
    content.h + FRAME_PAD * 2,
  ].map(Math.round);
  const margins = Object.entries(pad)
    .map(([side, v]) => `${side} ${Math.round(v)}`)
    .join(" · ");
  return `내용 상자가 viewBox의 ${fill}% · 여백 ${margins} · 내용에 맞춘 viewBox 후보 "${fit.join(" ")}"`;
}

const USAGE =
  "사용법: layout-check.mjs <그림.svg> [--png <출력.png>] [--bare <글자 뺀 출력.png>] [--frames <출력 앞이름> [--count 6]]";

// 브라우저 안에서 실행 · 한 주기 길이(초) · SMIL은 시작+길이, CSS는 지연+한 번 길이 중 가장 긴 것 · 반복 횟수는 보지 않는다
function timeline() {
  const svg = document.querySelector("svg");
  svg.pauseAnimations?.();
  let end = 0;
  for (const el of svg.querySelectorAll("animate, animateTransform, animateMotion, set")) {
    try {
      end = Math.max(end, el.getStartTime() + el.getSimpleDuration());
    } catch {
      // 시작이 다른 동작에 묶여 아직 정해지지 않은 요소는 앞 요소의 끝으로 잡힌다
    }
  }
  for (const animation of document.getAnimations()) {
    animation.pause();
    const { delay = 0, duration = 0 } = animation.effect?.getTiming() ?? {};
    end = Math.max(end, (Number(delay) + Number(duration)) / 1000);
  }
  return Math.min(end, 30);
}
// 브라우저 안에서 실행 · t초 시점으로 SMIL과 CSS를 함께 옮긴다
function seek(t) {
  document.querySelector("svg").setCurrentTime?.(t);
  for (const animation of document.getAnimations()) animation.currentTime = t * 1000;
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      png: { type: "string" },
      bare: { type: "string" },
      frames: { type: "string" },
      count: { type: "string", default: "6" },
    },
  });
  const [file] = positionals;
  if (!file) {
    console.log(USAGE);
    process.exit(2);
  }
  const svgPath = resolve(file);
  const source = await readFile(svgPath, "utf8"); // 없으면 여기서 실패
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    // <img>는 SVG를 XML로 읽는다 · 문법 오류면 아무것도 보이지 않으므로 먼저 막는다
    const xmlError = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      return doc.querySelector("parsererror")?.textContent ?? null;
    }, source);
    if (xmlError) {
      console.log(`XML 오류 · <img>에서 그림이 표시되지 않음: ${xmlError.trim().split("\n")[0]}`);
      process.exitCode = 1;
      return;
    }
    // 재생 중 여러 시점 · 움직임이 순서대로 이어지는지 보는 용도 · 배치 측정과 PNG는 아래의 정지판으로 한다
    if (values.frames && isAnimated(source)) {
      await page.goto(pathToFileURL(svgPath).href);
      const length = await page.evaluate(timeline);
      const count = Math.max(2, Number(values.count) || 6);
      const svgEl = page.locator("svg").first();
      for (let i = 0; i < count; i += 1) {
        const t = (length * i) / (count - 1);
        await page.evaluate(seek, t);
        await svgEl.screenshot({ path: resolve(`${values.frames}-${i + 1}.png`) });
      }
      console.log(
        `재생 ${length.toFixed(1)}초 · ${count}개 시점: ${resolve(values.frames)}-1..${count}.png`,
      );
    } else if (values.frames) console.log("움직임 없음 · 시점 촬영 생략");
    // 배치는 움직임을 지운 기본 속성(정지판)으로 잰다 · 재생 시점에 따라 결과가 흔들리지 않고, 움직임이 빠지는 곳에서 보이는 모습이다
    await page.goto("about:blank");
    await page.setContent(
      `<!doctype html><body style="margin:0;width:1200px">${staticSvg(source)}</body>`,
    );
    const measured = await page.evaluate(measure);
    if (measured.error) throw new Error(measured.error);
    const svg = page.locator("svg").first();
    if (values.png) {
      await svg.screenshot({ path: resolve(values.png) });
      console.log(`PNG: ${resolve(values.png)}`);
    }
    // 라벨을 가린 판정용 · 글자만 숨기고 지시선은 남긴다(구도가 글자 없이 읽히는지 본다)
    if (values.bare) {
      // SVG 문서에는 head가 없어 스타일 태그를 넣을 수 없다 · 글자 요소에 직접 숨김을 건다
      await page.evaluate(() => {
        for (const el of document.querySelectorAll("text"))
          el.style.setProperty("visibility", "hidden", "important");
      });
      await svg.screenshot({ path: resolve(values.bare) });
      console.log(`글자 뺀 PNG: ${resolve(values.bare)}`);
    }
    const issues = layoutIssues(measured);
    console.log(issues.length ? issues.join("\n") : "배치 겹침 없음");
    const frame = framing(measured);
    if (frame) console.log(frame);
    console.log(`글자 ${measured.texts.length}개 · 선 ${measured.strokes.length}개 점검`);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(process.argv.slice(2)).catch((error) => {
    console.error(String(error?.message ?? error));
    process.exit(1);
  });
