# 現状実装レビュー

## 結論

出力の主経路は `fflate` でXLSX/XLSMを展開し、対象ワークシートXMLのセルだけを差し替えて再圧縮する方式です。新しいブックを再構築してはいませんが、XML編集、業務計算、キャッシュ操作、テンプレート検証が一つの関数に集中していました。

## 処理一覧

| 処理 | 実装 | 現在の責務 | 問題 |
|---|---|---|---|
| テンプレートロード | `attendance/export.ts` `createAttendanceWorkbookFromTemplate` | R2から取得したZIPを展開 | 対象シート・構造の事前検証が弱い |
| XML編集 | `attendance/export.ts` `patchCells`, `clearCells` | セル値・入力範囲の更新 | 一般XMLライブラリではなく正規表現。変更許可領域の検証が必要 |
| マッピング | `worksheetPath`, 固定セル番地 | シート名からシートXMLを解決 | 名前付き範囲／バージョン定義が未分離 |
| 再計算 | `requestFormulaRecalculation` | `calcPr`と`calcChain`を変更 | WorkersではExcel/VBAの実評価はできない |
| 保全 | `fflate`が未変更パーツを再利用 | ZIPパーツを保持 | VBA以外の図形・名前・印刷設定の差分検査が必要 |
| 検証 | attendance export tests | 合成fixtureと実テンプレートprobe | Excel本体での開封・再計算は未自動化 |

## 実テンプレートの観測値

`D:/repos/TimeDock/.book/ABCS正社員（普通）勤務表2月(相澤友佑).xlsm` は41パーツ、`xl/vbaProject.bin`あり、VBAバイナリSHA-256は `28940517774bdf0c87f838b201b5fd3d5f07d028dd4d9dcb80ec7d46cb44cfde`、`definedName`要素7、ワークシート数式2680、図形関連パーツあり、`calcChain.xml`ありでした。

## 今回の改善

- `excel/workbook.ts` にブック検査、ZIP編集インターフェース、許可外パーツ差分検証を分離。
- `excel/formulas.ts` で評価済み／Excel委譲／未対応を明示。
- `excel/calculations.ts` で普通休憩・深夜休憩・日跨ぎ勤務の純粋計算を分離。
- 出力直前に元ZIPと出力ZIPを比較し、VBAバイナリ等の許可外パーツが変わった場合はエラーにする。
- 既存のテンプレート編集方式は維持し、全面的なライブラリ再保存には切り替えていない。

