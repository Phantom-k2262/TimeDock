---
id: T0014
type: feature
title: "セキュリティ・運用ハードニング"
status: active
priority: P1
owner: V1
created: 2026-11-16
updated: 2026-11-16
---

# T0014 セキュリティ・運用ハードニング

## 要件

- [ ] malformed xlsx、zip bomb、path traversal、10MiB超を拒否する
- [ ] D1 CAS競合、R2孤児、通信切断、再送を検証する
- [ ] 開発/本番bindingとsecretを分離する
- [ ] backup/restore、保持期間、退職者停止、無料枠監視を文書化する

## 受け入れ条件

- [ ] DESIGN.md §12の15件をPASS/BLOCKEDで記録する
- [ ] High以上の未解決findingがない
- [ ] 本番デプロイはユーザー承認なしに実行しない

## activity

- 2026-11-16: 未実装要件から分解。
- 2026-11-17: アップロードallowlist、ファイル内容検査、ファイル名サニタイズ、セキュリティヘッダーを実装。zip bomb、D1/R2障害復旧、バックアップ運用は継続課題。
