# 数式評価レポート

## 分類

1. TypeScriptで直接計算可能: 普通休憩、深夜休憩、日跨ぎを含む実労働分。`excel/calculations.ts`に純粋関数を追加。
2. 標準関数: `SUM`、`IF`等。現時点ではWorkersでキャッシュを再生成せず、Excel本体へ委譲。
3. VBA/UDF: `勤務時間`、`残業時間`、`COUNTIF2`、`代休取得時間`、`遅刻早退時間`。未評価として扱う。
4. 外部リンク／Excel固有機能: 未評価・未対応として扱う。

`excel/formulas.ts`の`classifyFormula`は評価状態を`evaluated`、`deferred-to-excel`、`unsupported`に分けます。出力APIは`X-TimeDock-Formula-Evaluation: deferred-to-excel`と`X-TimeDock-VBA: preserved-not-executed`を返し、バイナリのダウンロードだけで「計算完了」と誤認しないようにしています。

再計算フラグは実評価ではありません。`calcMode=auto`、`fullCalcOnLoad=1`、`forceFullCalc=1`を設定し、`calcChain`を除去するだけではWorkers内で値は計算されません。したがって、出力後のExcelでUDFを実行できる環境が必要です。

