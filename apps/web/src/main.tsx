import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function LoginPage() {
  return <main>
    <p className="eyebrow">TIMESHEET PORTAL</p>
    <h1>ログイン</h1>
    <p>勤務表ポータルにログインしてください。</p>
    <form className="login-form" onSubmit={(event) => event.preventDefault()}>
      <label htmlFor="loginId">ログインID</label>
      <input id="loginId" name="loginId" type="text" autoComplete="username" required />
      <label htmlFor="password">パスワード</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      <button type="submit">ログイン</button>
    </form>
    <a href="/">トップへ戻る</a>
  </main>;
}

function HomePage() {
  return <main><p className="eyebrow">TIMESHEET PORTAL</p><h1>勤務表を、確実に提出する。</h1><p>チェックアウト → ローカルExcel編集 → チェックイン → 提出の流れを安全に管理します。</p><a href="/login">ログイン画面へ</a></main>;
}

function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return path === "/login" ? <LoginPage /> : <HomePage />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
