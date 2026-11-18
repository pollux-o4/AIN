import { useState } from "react";
import { Icon, type IconName } from "../shared/Icon";
import { loadPrefs, type Prefs, savePrefs } from "./preferences";

const themes: { value: Prefs["theme"]; label: string; icon: IconName }[] = [
  { value: "system", label: "시스템", icon: "system" },
  { value: "light", label: "밝게", icon: "sun" },
  { value: "dark", label: "어둡게", icon: "moon" },
];
const motions: { value: Prefs["motion"]; label: string }[] = [
  { value: "system", label: "시스템 따름" },
  { value: "reduce", label: "줄이기" },
];

// 톱니바퀴 → 네이티브 popover(바깥 클릭·Esc 닫힘, 최상위 레이어)
export function Settings() {
  const [prefs, setPrefs] = useState(loadPrefs);
  const update = (next: Partial<Prefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    savePrefs(merged);
  };
  return (
    <>
      <button
        type="button"
        className="quiet icon-button"
        id="settings-toggle"
        popoverTarget="settings"
        aria-label="화면 설정"
        title="화면 설정"
      >
        <Icon name="gear" size={18} />
      </button>
      <section id="settings" popover="auto" className="settings" aria-labelledby="settings-title">
        <div className="settings-head">
          <h2 id="settings-title">화면 설정</h2>
          <button
            type="button"
            className="quiet icon-button"
            popoverTarget="settings"
            popoverTargetAction="hide"
            aria-label="설정 닫기"
          >
            <Icon name="close" />
          </button>
        </div>
        <fieldset className="choices">
          <legend>테마</legend>
          <div className="segmented">
            {themes.map((theme) => (
              <label key={theme.value} className="choice">
                <input
                  type="radio"
                  name="theme"
                  value={theme.value}
                  checked={prefs.theme === theme.value}
                  onChange={() => update({ theme: theme.value })}
                />
                <span>
                  <Icon name={theme.icon} />
                  {theme.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="choices">
          <legend>움직임</legend>
          <div className="segmented">
            {motions.map((motion) => (
              <label key={motion.value} className="choice">
                <input
                  type="radio"
                  name="motion"
                  value={motion.value}
                  checked={prefs.motion === motion.value}
                  onChange={() => update({ motion: motion.value })}
                />
                <span>{motion.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>
    </>
  );
}
