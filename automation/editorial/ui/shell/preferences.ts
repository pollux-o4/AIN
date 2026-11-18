import { z } from "zod";
import { read, store } from "../shared/persistence";

// 화면 설정 SSoT · <html data-theme / data-motion>으로만 반영하고 CSS가 해석한다.
const KEY = "ain-editorial-prefs";
const schema = z.object({
  theme: z.enum(["system", "light", "dark"]).catch("system"),
  motion: z.enum(["system", "reduce"]).catch("system"),
});
export type Prefs = z.infer<typeof schema>;
const DEFAULT_PREFS: Prefs = { theme: "system", motion: "system" };

export function loadPrefs(): Prefs {
  return read(KEY, schema) ?? DEFAULT_PREFS;
}
export function applyPrefs(prefs: Prefs) {
  const root = document.documentElement.dataset;
  if (prefs.theme === "system") delete root.theme;
  else root.theme = prefs.theme;
  if (prefs.motion === "system") delete root.motion;
  else root.motion = prefs.motion;
}
export function savePrefs(prefs: Prefs) {
  applyPrefs(prefs);
  return store(KEY, prefs);
}
