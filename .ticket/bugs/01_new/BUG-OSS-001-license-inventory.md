# BUG-OSS-001 OSSライセンスとNOTICEの全依存棚卸し不足

- 種別: bug
- 重大度: Medium
- 状態: 01_new
- 参照: `reports/LEGAL_SECURITY_AUDIT.md` OSS-001/OSS-002

## 事象

直接依存は確認できるが、lockfile全体のSPDXライセンス、GPL/LGPL/AGPL/MPLの有無、NOTICE、ブラウザ配信物への告知が網羅的に確認できない。

## 影響

再配布時の著作権表示・ライセンス通知・ソース提供条件を満たせない可能性がある。

## 対応方針

lockfile全体を機械的に棚卸しし、ライセンス・バージョン・利用形態・義務を一覧化する。THIRD_PARTY_NOTICESを生成し、CIで新規依存とライセンス変更を検知する。
