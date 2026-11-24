import assert from "node:assert/strict";
import { test } from "node:test";
import { xmlSafeSvg } from "../../contracts/svg-xml.mjs";

test("style 안 &·<를 CDATA로 감싸고 이미 감싼 것은 그대로 둔다", () => {
  const svg = "<svg><style>/* a & b */ .x{fill:red}</style></svg>";
  assert.equal(xmlSafeSvg(svg), "<svg><style><![CDATA[/* a & b */ .x{fill:red}]]></style></svg>");
  const done = xmlSafeSvg(svg);
  assert.equal(xmlSafeSvg(done), done);
});
