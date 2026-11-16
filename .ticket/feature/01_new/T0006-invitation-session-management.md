---
id: T0006
type: feature
title: "招待・セッション管理"
status: new
priority: P1
owner: P1
created: 2026-11-16
updated: 2026-11-16
---

# T0006 招待・セッション管理

## 要件

- [ ] 管理者がロール付き招待を作成できる
- [ ] 招待tokenをハッシュ保存し、一度だけ受け付ける
- [ ] HttpOnly/Secure/SameSite Cookieのセッションを発行する
- [ ] 期限切れ・失効・無効化ユーザーを拒否する

## 受け入れ条件

- [ ] 招待受け入れ、logout、セッション失効のテストがある
- [ ] token・パスワードをログへ出さない

## activity

- 2026-11-16: 未実装要件から分解。
