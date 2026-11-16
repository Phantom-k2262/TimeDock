import { StrictMode, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function LoginPage() {
  return <main>
    <p className="eyebrow">TIMESHEET PORTAL</p>
    <h1>ログイン</h1>
    <p>勤務表ポータルにログインしてください。</p>
    <form className="login-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); navigate("/dashboard"); }}>
      <label htmlFor="loginId">ログインID</label>
      <input id="loginId" name="loginId" type="text" autoComplete="username" required />
      <label htmlFor="password">パスワード</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      <button type="submit">ログイン</button>
    </form>
    <a href="/">トップへ戻る</a>
  </main>;
}

function Shell({ children }: { children: ReactNode }) {
  return <><header className="topbar"><strong>Timesheet Portal</strong><nav><a href="/dashboard">勤務表</a><a href="/approvals">承認</a><a href="/admin/users">管理</a></nav><button onClick={() => navigate("/login")}>ログアウト</button></header>{children}</>;
}

function HomePage() {
  return <main><p className="eyebrow">TIMESHEET PORTAL</p><h1>勤務表を、確実に提出する。</h1><p>チェックアウト → ローカルExcel編集 → チェックイン → 提出の流れを安全に管理します。</p><a href="/login">ログイン画面へ</a></main>;
}

function DashboardPage() {
  return <Shell><main><p className="eyebrow">DASHBOARD</p><h1>勤務表</h1><section className="card"><div><strong>2026年11月</strong><p>今月の勤務表 · 下書き</p></div><span className="status draft">下書き</span><button onClick={() => navigate("/timesheets/ts-2026-11")}>開く</button></section><button className="secondary" onClick={() => navigate("/timesheets/new")}>＋ 新しい勤務表を作成</button></main></Shell>;
}

function NewTimesheetPage() {
  return <Shell><main><p className="eyebrow">NEW TIMESHEET</p><h1>勤務表を作成</h1><section className="card form-card"><label>対象月<select defaultValue="2026-11"><option>2026-11</option><option>2026-12</option></select></label><label>テンプレート<select defaultValue="standard"><option value="standard">標準勤務表 v1</option></select></label><button onClick={() => navigate("/timesheets/ts-2026-11")}>作成する</button></section></main></Shell>;
}

function TimesheetDetailPage() {
  return <Shell><main><p className="eyebrow">TIMESHEET / 2026-11</p><h1>2026年11月の勤務表</h1><section className="steps"><div className="step active"><b>1</b><span><strong>チェックアウト</strong><small>編集権を取得</small></span><button onClick={() => navigate("/timesheets/ts-2026-11")}>取得</button></div><div className="step"><b>2</b><span><strong>Excelで編集</strong><small>ダウンロードしてローカルで編集</small></span><button className="secondary">ダウンロード</button></div><div className="step"><b>3</b><span><strong>チェックイン</strong><small>編集済みファイルをアップロード</small></span><button className="secondary">ファイルを選択</button></div></section><button onClick={() => navigate("/dashboard")}>提出準備を完了</button></main></Shell>;
}

function ApprovalsPage() {
  return <Shell><main><p className="eyebrow">APPROVALS</p><h1>承認待ち</h1><section className="card"><div><strong>サンプル社員 · 2026年11月</strong><p>版 v3 · 提出済み</p></div><button onClick={() => window.alert("仮実装: 承認しました")}>承認</button><button className="secondary" onClick={() => window.alert("仮実装: 差戻し理由を入力します")}>差戻し</button></section></main></Shell>;
}

function AdminPage() {
  return <Shell><main><p className="eyebrow">ADMIN</p><h1>管理</h1><div className="grid"><button className="card link-card" onClick={() => navigate("/admin/users")}>ユーザー管理<small>招待・ロール・無効化</small></button><button className="card link-card" onClick={() => navigate("/admin/templates")}>テンプレート管理<small>.xlsxテンプレート</small></button><button className="card link-card" onClick={() => navigate("/admin/audit")}>監査履歴<small>操作ログを確認</small></button></div></main></Shell>;
}

function AdminSubPage({ title, description }: { title: string; description: string }) {
  return <Shell><main><p className="eyebrow">ADMIN</p><h1>{title}</h1><section className="card"><p>{description}</p><button className="secondary">仮データを読み込む</button></section><a href="/admin/users">管理トップへ</a></main></Shell>;
}

function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (path === "/login") return <LoginPage />;
  if (path === "/dashboard") return <DashboardPage />;
  if (path === "/timesheets/new") return <NewTimesheetPage />;
  if (path.startsWith("/timesheets/")) return <TimesheetDetailPage />;
  if (path === "/approvals") return <ApprovalsPage />;
  if (path === "/admin/users") return <AdminSubPage title="ユーザー管理" description="社内ログインIDでユーザーを管理します。メールアドレスは収集しません。" />;
  if (path === "/admin/templates") return <AdminSubPage title="テンプレート管理" description="勤務表の.xlsxテンプレートを管理します。" />;
  if (path === "/admin/audit") return <AdminSubPage title="監査履歴" description="ログイン、ファイル操作、提出・承認の履歴を表示します。" />;
  if (path === "/admin") return <AdminPage />;
  return <HomePage />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
