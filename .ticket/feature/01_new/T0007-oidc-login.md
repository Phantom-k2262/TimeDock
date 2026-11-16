---
id: T0007
type: feature
title: "Google・Microsoft OIDCログイン"
status: new
priority: P1
owner: P1
created: 2026-11-16
updated: 2026-11-16
---

# T0007 Google・Microsoft OIDCログイン

## 要件

- [ ] Authorization Code + PKCEでGoogle/Microsoft個人アカウントに対応する
- [ ] state、nonce、issuer、audience、署名、expiryを検証する
- [ ] メール一致だけで自動アカウント統合しない

## 受け入れ条件

- [ ] 不正state/nonce/issuer/audienceを拒否する
- [ ] returnToを内部相対パスに限定する
- [ ] 実キーなしの統合テストとenv.exampleを用意する

## activity

- 2026-11-16: 未実装要件から分解。
