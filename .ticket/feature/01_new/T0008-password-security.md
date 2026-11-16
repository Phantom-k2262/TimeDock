---
id: T0008
type: feature
title: "パスワード保護とログイン試行制限"
status: new
priority: P1
owner: P1
created: 2026-11-16
updated: 2026-11-16
---

# T0008 パスワード保護とログイン試行制限

## 要件

- [ ] Argon2idまたは検証済みPBKDF2-SHA256を採用する
- [ ] IP/アカウント単位のレート制限と列挙防止応答を実装する
- [ ] 変更系APIにCSRF/Origin検証を適用する

## 受け入れ条件

- [ ] 誤パスワード、ロックアウト、CSRFなしのテストがある
- [ ] パスワードを監査・ログに記録しない

## activity

- 2026-11-16: 未実装要件から分解。
