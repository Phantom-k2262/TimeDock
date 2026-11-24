# Codex 多エージェント開発指示書 — Timesheet Portal

- バージョン: 1.0 (2026-11-16)
- 対象: Codex / Git worktrees / 単一組織向け勤務表提出アプリ
- チーム: プログラマー4名 + 独立検証者1名（統合と指示はCodexのメインエージェント=Coordinatorが担当。5名とは別の管理役）
- 仕様の優先順位: `DESIGN.md` → 本書 → `team.yaml` → `implementation.yaml` → `AGENTS.md`。安全性に関する矛盾は停止してCoordinatorに報告する。

## 1. 目的・非目的

**目的**: Cloudflare Workers/Hono、React/Vite、D1、非公開R2上に、Box風の勤務表ファイル管理サイトを作る。ID/パスワードとGoogle/Microsoft個人アカウントOIDCを用意し、`.xlsx`をチェックアウト→ダウンロード→ローカルExcel編集→チェックイン→提出→承認/差戻しできるようにする。月額無料枠を優先する。

**非目的**: Excel Online、Microsoft 365有料ライセンス依存、ブラウザー上でのExcelセル編集、OS上のExcelの強制的な編集禁止、リアルタイム共同編集、マルチテナント化。

チェックアウトは**サーバー側の更新排他制御**であり、ダウンロード済みファイルに対するExcelのファイルロックではない。

## 2. エージェントの編成

| ID | 名前 | 主担当 | 優先書き込み領域 | 禁止・境界 |
|---|---|---|---|---|
| P1 | Platform & Identity | monorepo構成、Workers設定、D1 migration、パスワード/SSO/セッション、共通基盤 | `apps/api/src/auth/**`, `apps/api/migrations/**`, `apps/api/wrangler.jsonc`, root configs, `apps/api/src/index.ts` | ロック業務、勤務表画面を勝手に実装しない |
| P2 | File & Lock | 非公開R2、ファイル版管理、チェックアウト・更新・解除・チェックイン、競合CAS、ダウンロード | `apps/api/src/modules/files/**`, `apps/api/src/modules/locks/**`, `apps/api/src/routes/files*`, `apps/api/src/routes/locks*` | migrationを直接編集しない。変更はP1へ提案 |
| P3 | Workflow & Audit | 勤務表、提出・承認・差戻し、RBAC、監査ログ、業務状態遷移 | `apps/api/src/modules/timesheets/**`, `apps/api/src/modules/workflow/**`, `apps/api/src/modules/audit/**`, `apps/api/src/routes/timesheets*`, `apps/api/src/routes/admin*` | 他担当が保有するauth/filesの実装を変更しない |
| P4 | Frontend & UX | React画面、ログイン、一覧、チェックアウト/チェックイン導線、承認管理UI、E2E画面シナリオ | `apps/web/**`, `e2e/**` | APIの契約を独断で変更しない |
| V1 | Independent Verifier | 仕様適合、セキュリティ、競合、E2E、再現手順、受け入れ判定 | `verification/**`, `docs/reviews/**` | 本体コードを原則変更しない。修正は担当者に起票し、再検証する |
| Coordinator | Integration Lead | 契約調整、依存解消、ブランチ統合、CI実行、最終判定 | `packages/shared/**`, `docs/decisions/**`, 統合のための調整 | 検証者の独立判定を上書きしない |

「プログラマー4名・検証者1名」は**論理ロール**。Codexの並列エージェント機能が利用できれば5サブエージェントを起動する。利用できない環境では5つのタスク/ブランチを順に実行して同じレビューゲートを守る。5プロセスが稼働していると偽って報告しない。

## 3. 共通の実装規則

1. `DESIGN.md`全体を読んでから作業する。構成は`implementation.yaml`に合わせる。
2. TypeScript `strict`、Hono、Zod、D1、R2、Vitest、Playwright。`pnpm`利用。秘密情報・実勤務表をGitに入れない。
3. フロントとAPIは`packages/shared`の**確定した型/スキーマ**に従う。契約更新はCoordinator経由、全担当へ通知。
4. 編集ロック・バージョン更新はD1の条件付きUPDATE/CASと影響行数で競合を検出。単純なread→writeでは不可。
5. 認証付きファイル転送はMVPでWorkers経由、上限10MiB。R2は完全非公開で版を上書きしない。SHA-256/サイズ/拡張子/zip構造を検証する。
6. OIDC: state、nonce、PKCE、issuer/audience/expiry検証。SSOアカウントをメール一致だけで自動紐付けしない。CookieはHttpOnly/Secure/SameSite、変更系APIはCSRFとOrigin対策。
7. 認証・ロックトークン、パスワード、個人情報をログへ出さない。RBACはサーバー側で毎回検証する。
8. D1 migrationはP1のみが編集し、P2/P3は`docs/schema-requests/`の提案をCoordinatorへ出す。共有部分に直接コミットしない。
9. エラーは`DESIGN.md`の`{error:{code,message,requestId}}`に統一する。ステータスは401/403/404/409/413/415/422/429等を遵守。
10. 外部APIやCloudflare環境の仕様は実装前に公式資料を確認する。分からない仕様を推測で実装しない。

## 4. 並列開発の前提と初期準備

1. CoordinatorがM0として`pnpm`ワークスペース、ビルド可能なAPI/Web/Shared雛形、CIの入口を作成する。P1が雛形を担当してもよいが、**M0を統合するまで並列作業を開始しない**。
2. Coordinatorが `packages/shared`に最小API契約を置き、`docs/contracts.md`で次を凍結する: User/Role、TimesheetStatus、LockState、APIパス・HTTPメソッド、エラー形式、`expectedVersion`/`checkoutToken`、版情報。
3. 各担当に個別ブランチ・worktreeを割り当てる。例: `agent/p1-auth`, `agent/p2-files`, `agent/p3-workflow`, `agent/p4-ui`, `agent/v1-verification`。同じ作業ディレクトリで複数エージェントが同時編集しない。
4. 各担当は自担当領域だけを編集し、隣接領域に必要なAPI・migration変更を`docs/change-requests/<agent>-*.md`に記載する。
5. P4はAPI未完成の間、確定契約に基づくMSW等のモックで進める。P2/P3は認証/RBACインターフェースのスタブを利用して単体テストを進める。
6. V1は早い段階からテスト設計を開始し、各段階で追加機能を検証する。V1による本体コード修正は原則禁止。

## 5. フェーズと依存関係

### G0 基盤凍結（順序必須）

- P1: ワークスペース、Workers/Hono、React/Vite、D1/R2ローカル開発設定、migration初版、ヘルスチェック、Vitest構成。
- Coordinator: `packages/shared`のAPI型/スキーマ、`docs/contracts.md`、branch/worktree運用。
- V1: テスト計画、脅威モデル、受け入れテスト一覧を起票。
- **ゲート**: clean install、typecheck、build、最低限のテストが通ること。Shared契約が明文化されること。

### G1 並列実装

- P1: パスワード/招待/セッション、Google/Microsoft OIDC、CSRF、レート制限、認証テスト。
- P2: R2のxlsxテンプレート/版管理、排他チェックアウト、更新・期限切れ・競合、チェックイン/ダウンロード、冪等処理。
- P3: 勤務表作成・状態遷移・提出・承認/差戻し・割当、監査、業務権限テスト。
- P4: ログイン、社員一覧・編集ステップ、承認一覧・管理画面、ブラウザーE2E。
- V1: 個別機能レビュー、セキュリティ・競合・不正ファイルテスト。
- **注意**: P2/P3のDB変更はP1が統合する。APIルート登録はCoordinatorが統合する。

### G2 統合と欠陥修正

- CoordinatorがP1→P2→P3→P4の順を基本に変更を統合。各統合後に`pnpm install --frozen-lockfile`、lint、typecheck、test、buildを実行。
- V1が`DESIGN.md §12`の15件を再現実行し、`verification/acceptance-report.md`を出す。
- 不具合は再現手順・期待値・実際・重大度・担当を明確にして元の担当者へ戻す。
- P4がPlaywright E2Eを実環境またはローカルWorkers/D1/R2接続で完了する。

### G3 Release Gate

- Blocker/Critical/Highの未解決不具合ゼロ。15個の必須受け入れ条件をPASS、または根拠あるBLOCKEDとして未リリースを明記。
- 開発用/本番用のbinding、Secret、マイグレーション、バックアップ/復元、Cloudflare無料枠の監視、運用READMEを確認。
- V1は独立してPASS/FAIL/BLOCKEDを報告し、Coordinatorがデプロイ可否を判断する。未実行テストはPASS扱い禁止。

## 6. インターフェース/データ設計の衝突対策

- `DESIGN.md §7`をAPIルートの正とする。`/api/v1`を共通プレフィックスにする。
- `packages/shared`の変更提案はCoordinatorが審査し、版を更新。P4にAPI変更を破壊的に押し付けない。
- `apps/api/migrations/**`・`apps/api/src/index.ts`・`pnpm-lock.yaml`は**単一編集者**を置く。
- 各機能のroutesは`export const ...Routes`等の取り決めで実装し、Coordinatorがルーターマウントを行う。
- マージ時のコード競合はCoordinatorが調整する。ブランチを強制push/rebaseして他人の未統合変更を消さない。
- 業務状態とロック状態は別モデルで、提出中に有効ロックを残さないこと。
- R2保存成功/D1確定失敗の孤児オブジェクト、D1確定前の再試行等を明示的に処理し、整合性テストを用意する。

## 7. Verifier V1 の独立検証観点

最低限 `DESIGN.md §12` の15件すべてをチェックリスト化する。特に:

- 同時チェックアウト20リクエストで成功はちょうど1件、残りは拒否。
- 古いロック、期限切れロック、盗んだトークン、古いexpectedVersionでチェックイン不可。
- 権限のないユーザーがURLを推測しても勤務表や版を取得できない。
- CSRF、SSOのstate/nonce/issuer/audience、ログイン試行制限、セッション失効を検証。
- `.xlsx`拡張子偽装、サイズ超過、壊れたzip、zip bomb、パストラバーサルを拒否。
- R2・D1の障害、通信切断、再送に対して失われた版や二重版が生じない。
- 承認・差戻し・再提出時に監査証跡と不変版が一致する。

報告は `verification/acceptance-report.md` に `ID | 結果(PASS/FAIL/BLOCKED) | コマンド/再現手順 | 証跡 | 担当 | 修正確認` を記載。`verification/findings/`に欠陥ごとのファイルを作成する。検証者は自分で修正してテストだけ通す行為を避ける。

## 8. エージェントのタスク報告書式

各担当はタスク終了時に次を提出する:

```markdown
## Agent: P2 / Gate: G1
### 完了したこと
- ...
### 変更ファイル
- ...
### 契約・migration変更要求
- ...（なければ「なし」）
### 実行したコマンドと結果
- `pnpm ...`: PASS/FAIL（未実行なら理由）
### 残課題・リスク
- ...
### 統合可否
- READY / BLOCKED
```

Coordinatorは`docs/integration-log.md`に統合対象ブランチ、コミットSHA、変更差分、チェック結果、衝突対応を追記する。

## 9. Codex起動指示（Coordinator向け）

1. `DESIGN.md`、本書、`team.yaml`、`AGENTS.md`を読む。
2. 実行環境がサブエージェントや独立worktreeを使えるか確認し、使える場合は `team.yaml` の5ロールを作成して担当を割り当てる。使用できない場合は役割単位で順次実行する。
3. G0を完了してからP1〜P4を並列で動かす。V1は計画から並走させる。
4. 自動で安全に進められるところはG1→G2まで進める。ただしSSO実キー、Cloudflareデプロイ権限、本番データなど、明示的な入力が必要な部分はモックと`env.example`で代替し、推測・捏造しない。
5. 外部公開、本番R2削除、本番migration適用、課金発生を伴う操作はユーザーの承認なしに実行しない。通常のCloudflare Workerデプロイについては、ユーザーがローカル検証できないため、コード修正後にビルド・型チェック・テスト・既存ABCS勤務表/SP用帳票の回帰テストが成功した場合、`timesheet-portal-prod`へ自動デプロイしてよい。これは通常のWorker更新に限る恒久的な承認であり、D1 migration、R2データ変更、Secrets変更、既存データ削除、Git commit/pushは含まない。デプロイ後は成否、WorkerバージョンID、確認用URL、テスト結果を報告する。
6. 最後に実装済み/未実装/検証済み/未検証を区別して報告する。
