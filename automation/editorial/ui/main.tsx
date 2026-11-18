import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyPrefs, loadPrefs } from "./shell/preferences";
import "./style.css";

applyPrefs(loadPrefs());
const root = document.getElementById("root");
if (!root) throw new Error("글쓰기 화면을 찾을 수 없습니다.");
createRoot(root).render(<App />);
