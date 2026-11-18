# 実装結果

## 実装したもの

- `apps/api/src/excel/types.ts`: `WorkbookEditor`、`TemplateRepository`、検査・評価・整合性の型。
- `apps/api/src/excel/workbook.ts`: ZIPブック検査、`ZipWorkbookEditor`、許可外パーツ差分検証。
- `apps/api/src/excel/formulas.ts`: 数式を評価済み／Excel委譲／未対応へ分類。
- `apps/api/src/excel/calculations.ts`: 普通休憩・深夜休憩・日跨ぎ勤務の純粋計算。
- `apps/api/src/excel/vba.ts`: VBAバイナリ保持とソース未解析状態の明示。
- `DefaultWorkbookInspector`、`DefaultWorkbookIntegrityValidator`、`NamedRangeMappingResolver`、`DelegatingWorkbookExportService`、`ComposedExcelApplicationService`で責務を分離。
- `apps/api/src/attendance/export.ts`: 既存出力にテンプレート保全検証を追加。既存VBA・図形・名前・未対象パーツを再構築しない。
- `apps/api/tests/excel-platform.test.ts`: 検査、保全拒否、計算、評価状態のテスト。

## 5項目の回答

1. ライブラリで実現できた機能: `fflate`によるZIP入出力、既存XMLパーツの最小差し替え、VBAバイナリの保持、シート・名前定義・数式の検査。
2. TypeScriptで補完した機能: 普通休憩・深夜休憩・日跨ぎ勤務の純粋計算、数式評価状態の分類、テンプレート整合性検証。
3. Excel本体が必要な機能: VBA/UDFの実行、Excel固有の再計算、印刷・コントロール等の最終互換性確認。
4. 互換性を保証できない機能: VBAソース本文の動作、イベント、ActiveX、外部リンク、Excel本体の表示幅による`#####`解消。
5. 本番利用に残るリスク: 実Excelでの自動開封・再計算が未自動化、VBAソース未取得、WorkersのCPU／メモリ制限、テンプレートの将来変更、署名付きVBAの署名有効性。

## 検証コマンド

- `corepack pnpm --filter @timesheet/api typecheck` 成功
- `corepack pnpm --filter @timesheet/api test` 成功（8 files / 24 tests）
- 実テンプレートprobe 成功（VBAバイナリ保持、対象シート存在、`calcChain`除去を許可差分として確認）
- SheetJS／ExcelJS／xlsx-populateの実ファイル比較を一時依存で実施。採用依存は増やしていない。
- リポジトリ全体のbuild・lint・E2E・Cloudflare本番デプロイは、この改善指示で明示的なデプロイ承認がないため未実施。

