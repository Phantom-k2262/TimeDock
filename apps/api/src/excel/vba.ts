import type { VbaAnalysis, VbaAnalyzer, WorkbookEntries } from "./types";

export class BinaryVbaAnalyzer implements VbaAnalyzer {
  analyze(entries: WorkbookEntries): VbaAnalysis {
    return entries["xl/vbaProject.bin"]
      ? { present: true, sourceAvailable: false, reason: "VBAプロジェクトはバイナリとして保持されていますが、Workers内でソースを解釈・実行していません" }
      : { present: false, sourceAvailable: false, reason: "VBAプロジェクトがありません" };
  }
}
