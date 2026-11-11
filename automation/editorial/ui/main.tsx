import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("글쓰기 화면을 찾을 수 없습니다.");
createRoot(root).render(<App />);
