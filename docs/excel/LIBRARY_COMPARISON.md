# Excelライブラリ比較

## 実ファイル検証

対象は `.book/ABCS正社員（普通）勤務表2月(相澤友佑).xlsm`。無変更に近い読み書きと、入力用シートD9の単一セル変更を実施し、ZIPパーツ数、VBA SHA-256、数式数、図形関連パーツ、名前定義を比較しました。

| 候補 | ライセンス | 結果 | 採否 |
|---|---|---|---|
| SheetJS Community Edition | Apache-2.0 | XLSMとして書き出せ、VBA SHA-256は一致。ただし41→20パーツ、`calcChain`消失。未記載機能の完全保全を保証できない | 本番の既存ブック再保存には不採用 |
| ExcelJS | MIT | 数式数は維持したが、`keepVBA`指定でもVBAパーツが消失（41→31） | 不採用 |
| xlsx-populate | MIT | 対象ブックの出力時に `Workbook.outputAsync` が `attributes` undefinedで失敗 | 不採用 |
| ZIP最小差し替え | `fflate`等の既存依存 | 実テンプレートで非対象パーツ、VBAバイナリを保持。`calcChain`削除と対象シートXMLのみを許可 | 現行の暫定採用 |
| HyperFormula | GPLv3または商用ライセンス | 商用無料条件を満たさないため採用不可 | 不採用 |

SheetJS公式も、未記載機能はシリアライズされない可能性があり、VBAは`bookVBA`指定が必要と明記しています。ExcelJSとxlsx-populateはMITですが、今回の実ファイル保全条件を満たしません。HyperFormulaはGPLv3または有償ライセンスです。

- [SheetJS writing options](https://docs.sheetjs.com/docs/api/write-options/)
- [SheetJS VBA support](https://docs.sheetjs.com/docs/csf/features/vba/)
- [ExcelJS repository and MIT license](https://github.com/exceljs/exceljs)
- [xlsx-populate repository and MIT license](https://github.com/dtjohnson/xlsx-populate)
- [HyperFormula licensing](https://handsontable.com/docs/hyperformula/guide/licensing)

## 判断

「ライブラリは常に壊す」とは判断していません。候補を実ファイルで比較した結果、今回のVBA・図形・名前・印刷設定を同時に保証できる候補が確認できなかったため、業務ロジックから隔離したZIP最小差し替えを採用しました。将来ライブラリを変更する場合も、同じ検証を通過するまで本番経路には切り替えません。

