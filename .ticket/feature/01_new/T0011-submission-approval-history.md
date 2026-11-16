---
id: T0011
type: feature
title: "提出・承認・差戻し履歴"
status: new
priority: P1
owner: P3
created: 2026-11-16
updated: 2026-11-16
---

# T0011 提出・承認・差戻し履歴

## 要件

- [ ] 現在版のversion/SHA-256を固定して提出する
- [ ] 承認者割当を管理する
- [ ] 承認・差戻し・再提出をappend-onlyで記録する
- [ ] 自己承認と未割当承認者の操作を拒否する

## 受け入れ条件

- [ ] rejectedから再編集・再提出できる
- [ ] approved/archivedは更新できない
- [ ] 監査履歴と版履歴が一致する

## activity

- 2026-11-16: 未実装要件から分解。
