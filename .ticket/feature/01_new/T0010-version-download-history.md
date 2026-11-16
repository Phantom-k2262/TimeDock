---
id: T0010
type: feature
title: "版履歴・ダウンロード・監査履歴"
status: new
priority: P1
owner: P2
created: 2026-11-16
updated: 2026-11-16
---

# T0010 版履歴・ダウンロード・監査履歴

## 要件

- [ ] 版を上書きせずimmutableに保存する
- [ ] 認可済み利用者だけが現在版・過去版をダウンロードできる
- [ ] upload時のSHA-256とdownload内容を一致させる
- [ ] auth/download/checkout/checkin/submit/approve/rejectを監査する

## 受け入れ条件

- [ ] 他人のURL推測で版を取得できない
- [ ] Content-Disposition、no-store、nosniffを設定する
- [ ] token・パスワード・勤務表内容を監査ログに出さない

## activity

- 2026-11-16: 未実装要件から分解。
