import assert from "node:assert/strict";
import test from "node:test";
import { previewFields } from "../ui/tracking/preview.ts";

test("LIVE-001: readable partial structured output without JSON fragments", () => {
  assert.deepEqual(previewFields('{"text":"첫 문장\\n둘째 문', "draft"), [
    { label: "초안 본문", text: "첫 문장\n둘째 문" },
  ]);
  assert.deepEqual(previewFields('{"reader":"초보자","intent":"이해"}', "audience"), [
    { label: "대상 독자", text: "초보자" },
    { label: "독자가 원하는 것", text: "이해" },
  ]);
  assert.deepEqual(previewFields('{"sections":["주문 [예시]","결제", "배', "outline"), [
    { label: "글의 구성", text: "주문 [예시]\n결제\n배" },
  ]);
  assert.deepEqual(previewFields('{"secret":"never"}', "topic"), []);
  assert.deepEqual(previewFields('{"text":"<script>alert(1)</script>"}', "draft"), [
    { label: "초안 본문", text: "<script>alert(1)</script>" },
  ]);
  assert.deepEqual(previewFields('{"text":"한글\\u12', "draft"), [
    { label: "초안 본문", text: "한글" },
  ]);
});
