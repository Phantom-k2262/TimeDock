---
id: T0012
type: feature
title: "社員向けログイン・勤務表UI"
status: active
priority: P1
owner: P4
created: 2026-11-16
updated: 2026-11-16
---

# T0012 社員向けログイン・勤務表UI

## 要件

- [ ] `/login`にパスワード・Google・Microsoft導線を表示する
- [ ] `/dashboard`で月別勤務表と提出状況を表示する
- [ ] チェックアウト後にダウンロード→Excel編集→チェックインを表示する
- [ ] ロック期限・残り時間・延長を表示する

## 受け入れ条件

- [ ] 認証失敗とAPIエラーを利用者に安全に表示する
- [ ] キーボード操作と基本アクセシビリティを確認する
- [ ] Playwrightの社員シナリオを追加する

## activity

- 2026-11-16: 未実装要件から分解。
- 2026-11-16: `/login`のURL判定、ログインフォームの初期UI、Webテストを実装。認証API接続は未完了。
