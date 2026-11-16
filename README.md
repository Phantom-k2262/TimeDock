# Timesheet Portal

勤務表のチェックアウト・ローカル編集・チェックイン・提出・承認を行うWebアプリです。

## 方針

- Cloudflare Workers / Hono / D1 / private R2
- React + Vite + TypeScript
- `.xlsx` はローカルのExcelまたは互換アプリで編集
- ファイル版は不変保存し、サーバー側のCASロックで更新を制御
- パスワード認証とGoogle/Microsoft個人アカウントOIDC

設計上の正本は [DESIGN.md](./DESIGN.md) です。開発ルールは [AGENTS.md](./AGENTS.md) と [TEAM_INSTRUCTIONS.md](./TEAM_INSTRUCTIONS.md) を参照してください。

## 開発

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

秘密情報や実勤務表はリポジトリへ追加しないでください。本番デプロイ・本番DB変更は明示的な承認があるまで行いません。
