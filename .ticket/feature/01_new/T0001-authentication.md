---
id: T0001
type: feature
title: "パスワード・OIDC認証とセッション"
status: new
priority: P1
owner: P1
created: 2026-11-16
updated: 2026-11-16
---

# T0001 パスワード・OIDC認証とセッション

## 目的

設計書に従い、招待ベースのパスワード認証、Google/Microsoft OIDC、セッション、RBAC、CSRF保護を実装する。

## 受け入れ条件

- [ ] パスワードを安全な方式でハッシュ化する
- [ ] セッションIDのハッシュ保存、期限、失効を実装する
- [ ] OIDCのstate/nonce/PKCE/issuer/audience/expiryを検証する
- [ ] 保護APIの認証・権限テストを追加する
- [ ] 認証情報をログへ出さない

## 依存

G0共有契約、D1初期migration。

## activity

- 2026-11-16: G1着手候補として登録。
