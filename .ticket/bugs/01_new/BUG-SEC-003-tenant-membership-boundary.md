# BUG-SEC-003 複数テナント所属と認可モデルの不整合

- 種別: bug
- 重大度: High
- 状態: 01_new
- 参照: `reports/LEGAL_SECURITY_AUDIT.md` SEC-003

## 事象

DBには多対多の`tenant_members`を想定できる一方、アカウント作成・編集・一覧が単一のprimary tenant中心に見える。複数所属assignment式の要件と一致しない可能性がある。

## 影響

テナント越境表示、誤ったワークスペース閲覧、所属変更時の権限残存が発生する可能性がある。

## 確認方法

1ユーザーを2テナントに割り当て、各テナントのワークスペース、アカウント設定、ファイルIDを直接切り替えた場合の許可・拒否をAPI単位で確認する。

## 対応方針

`tenant_members`を所属判定の正とし、primary tenantを権限判定に使用しない。全APIでmembership、workspace tenant、対象フォルダの可視性をサーバー側で再検証する。
