import type { FormulaEvaluationResult } from "./types";

const customFunctions = ["勤務時間", "残業時間", "COUNTIF2", "代休取得時間", "遅刻早退時間"];

export function classifyFormula(formula: string): FormulaEvaluationResult {
  if (customFunctions.some((name) => formula.includes(name))) return { formula, status: "unsupported", reason: "VBA/UDF依存のためWorkersでは評価していません" };
  if (/\[[^\]]+\]|https?:\/\//i.test(formula)) return { formula, status: "unsupported", reason: "外部リンク依存のため評価していません" };
  if (/^(?:SUM|IF|ROUND|ROUNDDOWN|ROUNDUP|COUNTIF|SUMIF|MAX|MIN|AND|OR|NOT|ABS|INT|MOD|TEXT)\s*\(/i.test(formula.trim())) return { formula, status: "deferred-to-excel", reason: "標準関数ですがWorkers側ではキャッシュを再生成していません" };
  return { formula, status: "deferred-to-excel", reason: "Excel本体での再計算に委ねます" };
}

export interface FormulaEvaluationService {
  evaluate(formulas: string[]): Promise<FormulaEvaluationResult[]>;
}

export class DeferredFormulaEvaluationService implements FormulaEvaluationService {
  async evaluate(formulas: string[]) { return formulas.map(classifyFormula); }
}
