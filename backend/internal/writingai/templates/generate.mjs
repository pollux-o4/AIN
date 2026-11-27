// Capture the Node reference instructions for the native Go prompt assembler.
// 공통 틀(역할·지킬 것)은 promptframe/generate.mjs가 추출한다.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const fromRoot = (path) => import(pathToFileURL(resolve(root, path)));
const { stageSpec } = await fromRoot("automation/paseo/prompts/stages.mjs");
const { routeSpec } = await fromRoot("automation/paseo/prompts/route.mjs");
const { STAGE_ROLES } = await fromRoot("automation/paseo/roles.mjs");
const { WRITING_MODES, READER_LEVELS } = await fromRoot("automation/contracts/writing-modes.mjs");
const { MODE_RULES, LEVEL_RULES, reviewChecks, seasoningRules } = await fromRoot(
  "automation/paseo/seasoning.mjs",
);

const state = { source: "", idea: "", artifacts: {}, history: [], requirementLog: [] };
const stages = ["diagnose", "topic", "audience", "value", "research", "outline", "draft", "review"];
const get = (stage, action = {}, extra = {}) =>
  stageSpec({ ...state, ...extra }, { stage, ...action });
const basic = Object.fromEntries(stages.map((stage) => [stage, get(stage)]));
basic.route = routeSpec();
basic.edit = get("draft", { mode: "edit" });

const placed = (kind, value) => ({ kind, op: "set", value, quote: "fixture" });
const diagnosis = get(
  "diagnose",
  {},
  { requirementLog: [{ changes: [placed("mode", "explain"), placed("readerLevel", "expert")] }] },
);
const section = { index: 0, total: 3, title: "__TITLE__", budget: 987650, limit: 987651 };
const first = get("draft", { section });
const middle = get("draft", { section: { ...section, index: 1 } });
const rejected = get("draft", { rejected: "example", retryNote: "__NOTE__" });
const edited = get("draft", {}, { feedback: "example" });
const withFloor = get("draft", { section: { ...section, floor: 987652 } });

const fragments = {
  mode: diagnosis.steps[1].replace("explain", "{{mode}}"),
  level: diagnosis.steps[2].replace("expert", "{{level}}"),
  outlineRetry: get("outline", {}, { retry: { stage: "outline" } }).steps.at(-1),
  sectionTask: first.task.replace("1/3", "{{number}}/{{total}}").replace("__TITLE__", "{{title}}"),
  sectionFirst: first.steps[1].replace("__TITLE__", "{{title}}"),
  sectionLater: middle.steps[0].replace("__TITLE__", "{{title}}"),
  sectionNotes: first.outputNotes[0],
  rejected: rejected.steps[0],
  editing: edited.steps[0],
  retry: rejected.criteria[1].replace("__NOTE__", "{{note}}"),
  budget: first.criteria[0].replace("987650", "{{budget}}").replace("987651", "{{limit}}"),
  budgetFloor: withFloor.criteria[0]
    .replace("987650", "{{budget}}")
    .replace("987651", "{{limit}}")
    .replace("987652", "{{floor}}"),
  checks: basic.review.steps[1].split("\n")[0],
  criteria: basic.review.criteria[0].replace(
    reviewChecks({ modes: [] })
      .map(({ id }) => id)
      .join("·"),
    "{{checks}}",
  ),
};

const storyRules = {};
for (const stage of ["draft", "review"]) {
  const base = seasoningRules(stage, { modes: [] });
  const seasoned = seasoningRules(stage, { modes: ["explain"] });
  storyRules[stage] = seasoned.slice(
    base.length,
    seasoned.length - MODE_RULES.explain[stage].length,
  );
}
const checks = reviewChecks({ modes: ["explain"] });
const payload = {
  basic,
  fragments,
  storyRules,
  modeRules: MODE_RULES,
  levelRules: LEVEL_RULES,
  checks,
  modes: WRITING_MODES,
  levels: READER_LEVELS,
  stageRoles: Object.fromEntries([...stages, "route"].map((name) => [name, STAGE_ROLES[name]])),
};
writeFileSync(new URL("./prompts.json", import.meta.url), `${JSON.stringify(payload, null, 2)}\n`);
