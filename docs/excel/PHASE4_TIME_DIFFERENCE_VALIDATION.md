# Phase 4追加検証：時間差と24行目

実施日: 2026-11-19

## 対象

同一データのExcel再計算後ブックが手元にないため、比較対象は既存の計算済み2月XLSMと、そのXLSMを同じ入力でWorkers相当の実エクスポート経路へ通した結果です。11月1日・14日のExcel基準値との同値性は未検証です。

Fixture: `D:/repos/TimeDock/.book/ABCS正社員（普通）勤務表2月(相澤友佑).xlsm`

## 時間差の実効性

`勤務表（入力用）!D24:AH24` の31セルが、共有数式を展開した結果、すべて次の数式で `時間差` を直接使用します。

`IF(<列>15="",HMINT(<列>74)*-1,時間差(<列>15,<列>74))`

実測結果:

- 直接使用セル: 31
- 評価成功: 31
- 評価失敗: 0
- 未対応: 0
- 変更前の実測: `時間差`を含む24行目は上流の`勤務時間`が一律未対応扱いとなり、31セルが依存先未対応または構文解析失敗になった

成功数が当初の2,170件から変わらなかった理由は、`時間差`のディスパッチ追加だけでは不十分で、`勤務時間`を含む数式を評価ループの前段で `direct-unsupported` として遮断していたためです。今回、VBA Range配列アダプターを接続し、その遮断を除去しました。

## 24行目セル別結果

`cacheBefore` はfixtureの入力値、`cacheAfter` は同じブックを直接再計算した後のOOXMLキャッシュです。数値はExcelのHHMM表現です。全31セルで数式本文を保持したまま評価済みです。

| セル | cacheBefore | cacheAfter | status |
|---|---:|---:|---|
| D24 | 0 | 0 | evaluated |
| E24 | 1300 | 0 | evaluated |
| F24 | 1300 | 1400 | evaluated |
| G24 | 300 | 300 | evaluated |
| H24 | 0 | 0 | evaluated |
| I24 | 1300 | 0 | evaluated |
| J24 | 0 | 1400 | evaluated |
| K24 | 0 | 0 | evaluated |
| L24 | 1300 | 0 | evaluated |
| M24 | 1300 | 1400 | evaluated |
| N24 | 0 | 900 | evaluated |
| O24 | 800 | 0 | evaluated |
| P24 | 300 | 300 | evaluated |
| Q24 | 0 | 0 | evaluated |
| R24 | 0 | 0 | evaluated |
| S24 | 800 | 0 | evaluated |
| T24 | 800 | 900 | evaluated |
| U24 | 800 | 900 | evaluated |
| V24 | 800 | 900 | evaluated |
| W24 | 800 | 900 | evaluated |
| X24 | 0 | 900 | evaluated |
| Y24 | 0 | 0 | evaluated |
| Z24 | 0 | 0 | evaluated |
| AA24 | 800 | 0 | evaluated |
| AB24 | 800 | 900 | evaluated |
| AC24 | 800 | 900 | evaluated |
| AD24 | 800 | 900 | evaluated |
| AE24 | 0 | 217 | evaluated |
| AF24 | 0 | 0 | evaluated |
| AG24 | 0 | 0 | evaluated |
| AH24 | 0 | 0 | evaluated |

## 再計算メトリクス

同じ2月fixtureを毎回再計測した値です。以前の報告値の転記ではありません。

| 指標 | 変更前実測 | 変更後実測 |
|---|---:|---:|
| 総数式数 | 2,680 | 2,680 |
| 計算対象数 | 2,680 | 2,680 |
| 評価成功数 | 2,170 | 2,468 |
| 評価失敗数 | 510 | 212 |
| 未対応数 | 510 | 212 |
| 空キャッシュ（再計算前） | 324 | 324（直接再計算） / 13（実エクスポート経路） |
| 空キャッシュ（再計算後） | 143 | 53（直接再計算） / 4（実エクスポート経路） |

実エクスポート経路の再計算ログ:

- parse: 8.92 ms / 2,680セル
- shared expansion: 8.75 ms / 1,721セル
- defined names: 0.10 ms / 7件
- dependency graph: 12.19 ms / 2,680セル
- evaluation: 27.80 ms / 2,680セル
- cache update: 12.18 ms / 2,468セル
- ZIP展開: 8.40 ms
- ZIP再圧縮: 64.51 ms

未対応212セルの内訳は、`parse-failure` 112、`dependency-unsupported` 100です。`時間差`由来の未対応セルはありません。これはローカルのWorkers互換実行環境での計測であり、Cloudflare本番CPU時間・メモリ使用量の実測ではありません。

## 実装・検証範囲

- `時間差`はVBAの`Application.Text(Abs(a-b), "[h]mm")`に合わせ、分丸め後のHHMM数値とEmptyを返す
- `勤務時間`、`残業時間`、`代休取得時間`、`遅刻早退時間`をRange配列入力で評価器へ接続
- `HMINT(...)*-1`の単項マイナスを構文解析できるよう修正
- 共有数式の親式を列相対変換し、24行目の全日付列を評価
- 実際の`createAttendanceWorkbookFromTemplate`経路で再計算を実行
- 再計算対象のワークシートXMLを保全検証の許可対象に追加し、VBAや書式など他のパーツは保持

## 未完了

同一の11月入力データについて、Excelで編集を有効化して保存したBブックが存在しないため、11月1日・14日の残業差異、月次集計、Excelとの一致率は未検証です。今回の結果だけでExcel完全一致や本番デプロイ済みとは宣言しません。
