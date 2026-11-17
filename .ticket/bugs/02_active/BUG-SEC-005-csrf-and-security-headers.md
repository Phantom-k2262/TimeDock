# BUG-SEC-005 CSRF対策とセキュリティヘッダー不足

- 種別: bug
- 重大度: Medium
- 状態: 02_active
- 参照: `reports/LEGAL_SECURITY_AUDIT.md` SEC-005/SEC-006

## 事象

Cookie認証の状態変更APIについて、明示的なCSRFトークンまたはOrigin検証が確認できない。CSP、HSTS、frame制御、CORS許可リストも網羅的に確認できない。

## 影響

同一ブラウザセッションを利用した意図しない状態変更、クリックジャッキング、過剰なクロスオリジン許可につながる可能性がある。

## 対応方針

状態変更APIにCSRFトークンとOrigin/Referer検証を追加し、CORSを明示的allowlistにする。CSP、HSTS、X-Frame-Optionsまたはframe-ancestors等をWorkerで一元付与する。

## activity

- 2026-11-17: 状態変更APIへOrigin検証、CSP、HSTS、X-Frame-Options、nosniff、Referrer-PolicyをWorker共通ミドルウェアで追加。明示的CSRFトークンとCORS allowlistは継続課題。
