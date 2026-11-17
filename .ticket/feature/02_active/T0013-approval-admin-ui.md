---
id: T0013
type: feature
title: "承認者・管理者UI"
status: active
priority: P2
owner: P4
created: 2026-11-16
updated: 2026-11-16
---

# T0013 承認者・管理者UI

## 要件

- [ ] `/approvals`で割当済み提出を一覧・承認・差戻しする
- [ ] `/admin/users`で招待・ロール・無効化を管理する
- [x] `/admin/templates`でテンプレートを管理する
- [x] `/admin/audit`で監査履歴を確認する

## 受け入れ条件

- [ ] ロール外の画面・操作をサーバー認可とUIの両方で制限する
- [ ] 差戻し理由入力を必須にする
- [ ] Playwrightの承認者・管理者シナリオを追加する

## activity

- 2026-11-16: 未実装要件から分解。
- 2026-11-17: テンプレート管理画面と監査履歴API/UIを実装し、本番Workerへデプロイ。
