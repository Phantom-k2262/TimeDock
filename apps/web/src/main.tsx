import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return <main><p className="eyebrow">TIMESHEET PORTAL</p><h1>勤務表を、確実に提出する。</h1><p>チェックアウト → ローカルExcel編集 → チェックイン → 提出の流れを安全に管理します。</p><a href="/login">ログイン画面へ</a></main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
