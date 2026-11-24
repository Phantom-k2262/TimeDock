# BUG-CF-001 Cloudflare本番データ保護設定が未確認

- 種別: bug
- 重大度: High
- 状態: 01_new
- 参照: `reports/LEGAL_SECURITY_AUDIT.md` CF-001/CF-002

## 事象

リポジトリのWrangler設定だけでは、R2の保存地域・jurisdiction、Cloudflare Secrets、本番/開発環境分離、D1/R2バックアップと復元演習が確認できない。

## 影響

個人データの保存地域・委託管理が不明確になり、デプロイや障害時にデータ消失・復旧不能が発生する可能性がある。

## 対応方針

Cloudflare Dashboardと契約情報で保存地域、jurisdiction、Secrets、権限、WAF、TLS、ログ保持を台帳化する。D1 export/Time Travel、R2バックアップ、復元演習、RPO/RTOを定義する。
