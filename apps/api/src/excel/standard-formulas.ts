import type { FormulaEvaluationResult } from "./types";

export type FormulaContext = ReadonlyMap<string, unknown>;
export type FormulaFunction = (...args: unknown[]) => unknown;

function splitArguments(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "(") depth += 1;
    else if (!quoted && character === ")") depth -= 1;
    else if (!quoted && depth === 0 && (character === "," || character === ";")) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result.filter(Boolean);
}

function columnNumber(column: string) {
  return [...column.toUpperCase()].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0);
}

function columnName(number: number) {
  let result = "";
  for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

function normalizeReference(value: string) {
  return value.replace(/\$/g, "").replace(/^'([^']+)'!/, "$1!");
}

function getValue(reference: string, context: FormulaContext): unknown {
  const normalized = normalizeReference(reference.trim());
  return context.get(normalized) ?? context.get(normalized.replace(/^.*!/, "")) ?? "";
}

function cellsInRange(reference: string, context: FormulaContext): unknown[] {
  const normalized = normalizeReference(reference);
  const named = context.get(normalized);
  if (Array.isArray(named)) return named;
  const sheetPrefix = normalized.includes("!") ? normalized.slice(0, normalized.lastIndexOf("!") + 1) : "";
  const range = normalized.slice(normalized.lastIndexOf("!") + 1);
  const [left, right = left] = range.split(":");
  const a = left.match(/^([A-Z]+)(\d+)$/i);
  const b = right.match(/^([A-Z]+)(\d+)$/i);
  if (!a || !b) return [getValue(normalized, context)];
  const values: unknown[] = [];
  for (let row = Number(a[2]); row <= Number(b[2]); row += 1) {
    for (let column = columnNumber(a[1]); column <= columnNumber(b[1]); column += 1) {
      values.push(getValue(`${sheetPrefix}${columnName(column)}${row}`, context));
    }
  }
  return values;
}

function asNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value !== null && value !== undefined && value !== "";
}

function stripOuterParentheses(value: string) {
  let result = value.trim();
  while (result.startsWith("(") && result.endsWith(")")) {
    let depth = 0;
    let quoted = false;
    let closesAtEnd = true;
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === '"') quoted = !quoted;
      if (quoted) continue;
      if (result[index] === "(") depth += 1;
      if (result[index] === ")") depth -= 1;
      if (depth === 0 && index < result.length - 1) { closesAtEnd = false; break; }
    }
    if (!closesAtEnd) break;
    result = result.slice(1, -1).trim();
  }
  return result;
}

function findTopLevelOperator(value: string, operators: string[]) {
  let depth = 0;
  let quoted = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const character = value[index];
    if (character === '"') quoted = !quoted;
    if (quoted) continue;
    if (character === ")") depth += 1;
    else if (character === "(") depth -= 1;
    else if (depth === 0) {
      for (const operator of operators) {
        const start = index - operator.length + 1;
        if (start >= 0 && value.slice(start, index + 1) === operator && start > 0 && !/[+\-*/]/.test(value[start - 1])) return { start, operator };
      }
    }
  }
  return undefined;
}

function compare(left: unknown, operator: string, right: unknown) {
  if (operator === "=") return String(left ?? "") === String(right ?? "");
  if (operator === "<>") return String(left ?? "") !== String(right ?? "");
  const a = typeof left === "number" ? left : String(left ?? "");
  const b = typeof right === "number" ? right : String(right ?? "");
  if (operator === ">") return a > b;
  if (operator === "<") return a < b;
  if (operator === ">=") return a >= b;
  return a <= b;
}

function evaluateExpression(expression: string, context: FormulaContext, functions: ReadonlyMap<string, FormulaFunction>): unknown {
  const trimmed = stripOuterParentheses(expression);
  const concatenation = findTopLevelOperator(trimmed, ["&"]);
  if (concatenation) return String(evaluateExpression(trimmed.slice(0, concatenation.start), context, functions) ?? "") + String(evaluateExpression(trimmed.slice(concatenation.start + 1), context, functions) ?? "");
  const comparison = findTopLevelOperator(trimmed, ["<>", ">=", "<=", "=", ">", "<"]);
  if (comparison) return compare(evaluateExpression(trimmed.slice(0, comparison.start), context, functions), comparison.operator, evaluateExpression(trimmed.slice(comparison.start + comparison.operator.length), context, functions));
  const additive = findTopLevelOperator(trimmed, ["+", "-"]);
  if (additive) return additive.operator === "+" ? asNumber(evaluateExpression(trimmed.slice(0, additive.start), context, functions)) + asNumber(evaluateExpression(trimmed.slice(additive.start + 1), context, functions)) : asNumber(evaluateExpression(trimmed.slice(0, additive.start), context, functions)) - asNumber(evaluateExpression(trimmed.slice(additive.start + 1), context, functions));
  const multiplicative = findTopLevelOperator(trimmed, ["*", "/"]);
  if (multiplicative) return multiplicative.operator === "*" ? asNumber(evaluateExpression(trimmed.slice(0, multiplicative.start), context, functions)) * asNumber(evaluateExpression(trimmed.slice(multiplicative.start + 1), context, functions)) : asNumber(evaluateExpression(trimmed.slice(0, multiplicative.start), context, functions)) / asNumber(evaluateExpression(trimmed.slice(multiplicative.start + 1), context, functions));
  if (/^"(?:[^"]|"")*"$/.test(trimmed)) return trimmed.slice(1, -1).replace(/""/g, '"');
  if (/^(?:TRUE|FALSE)$/i.test(trimmed)) return trimmed.toUpperCase() === "TRUE";
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return Number(trimmed);
  // VBA UDF names in the ABCS workbook are Japanese (for example 時間差).
  // Keep ASCII Excel names working while accepting Unicode letter/number
  // identifiers for custom functions.
  const call = trimmed.match(/^([\p{L}_][\p{L}\p{N}_.]*)\((.*)\)$/u);
  if (call) {
    const name = call[1].toUpperCase();
    const args = splitArguments(call[2]);
    if (name === "IF") return asBoolean(evaluateExpression(args[0] ?? "FALSE", context, functions)) ? evaluateExpression(args[1] ?? "0", context, functions) : evaluateExpression(args[2] ?? "0", context, functions);
    const custom = functions.get(name);
    if (custom) return custom(...args.map((arg) => arg.includes(":") || Array.isArray(context.get(normalizeReference(arg))) ? cellsInRange(arg, context) : evaluateExpression(arg, context, functions)));
    const values = args.flatMap((arg) => arg.includes(":") || Array.isArray(context.get(normalizeReference(arg))) ? cellsInRange(arg, context) : [evaluateExpression(arg, context, functions)]);
    switch (name) {
      case "SUM": return values.reduce<number>((sum, value) => sum + asNumber(value), 0);
      case "MIN": return Math.min(...values.map(asNumber));
      case "MAX": return Math.max(...values.map(asNumber));
      case "ABS": return Math.abs(asNumber(values[0]));
      case "INT": return Math.floor(asNumber(values[0]));
      case "MOD": return asNumber(values[0]) % asNumber(values[1]);
      case "ROUND": { const factor = 10 ** asNumber(values[1]); return Math.round(asNumber(values[0]) * factor) / factor; }
      case "ROUNDDOWN": { const factor = 10 ** asNumber(values[1]); return Math.trunc(asNumber(values[0]) * factor) / factor; }
      case "ROUNDUP": { const factor = 10 ** asNumber(values[1]); return Math.ceil(asNumber(values[0]) * factor) / factor; }
      case "COUNTBLANK": return values.filter((value) => value === null || value === undefined || value === "").length;
      case "COUNT": return values.filter((value) => typeof value === "number").length;
      case "AND": return values.every(asBoolean);
      case "OR": return values.some(asBoolean);
      case "NOT": return !asBoolean(values[0]);
      case "COUNTIF": { const range = cellsInRange(args[0] ?? "", context); const criterion = evaluateExpression(args[1] ?? '""', context, functions); return range.filter((value) => compare(value, "=", criterion)).length; }
      case "YEAR": return new Date(Date.UTC(1899, 11, 30) + asNumber(values[0]) * 86400000).getUTCFullYear();
      case "MONTH": return new Date(Date.UTC(1899, 11, 30) + asNumber(values[0]) * 86400000).getUTCMonth() + 1;
      case "DAY": return new Date(Date.UTC(1899, 11, 30) + asNumber(values[0]) * 86400000).getUTCDate();
      case "MINUTE": return new Date(Date.UTC(1899, 11, 30) + asNumber(values[0]) * 86400000).getUTCMinutes();
      case "TEXT": {
        const value = asNumber(values[0]);
        const format = String(evaluateExpression(args[1] ?? '""', context, functions) ?? "");
        if (format === "[h]:mm" && Number.isFinite(value)) {
          const minutes = Math.round(value * 1440);
          return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
        }
        return String(values[0] ?? "");
      }
      case "DATE": { const year = asNumber(values[0]); const month = asNumber(values[1]); const day = asNumber(values[2]); return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000; }
      default: throw new Error(`unsupported-standard-function:${name}`);
    }
  }
  if (/^(?:'[^']+'|[^!\s]+)!\$?[A-Z]+\$?\d+$|^\$?[A-Z]+\$?\d+$/i.test(trimmed)) return getValue(trimmed, context);
  throw new Error("unsupported-expression");
}

export class StandardFormulaEngine {
  constructor(private readonly functions: ReadonlyMap<string, FormulaFunction> = new Map()) {}
  evaluate(formula: string, context: FormulaContext): FormulaEvaluationResult {
    try { return { formula, status: "evaluated", value: evaluateExpression(formula.replace(/^=/, ""), context, this.functions) as FormulaEvaluationResult["value"] }; }
    catch (error) { return { formula, status: "unsupported", reason: error instanceof Error ? error.message : "unsupported" }; }
  }

  evaluateMany(formulas: ReadonlyArray<{ formula: string; context: FormulaContext }>) { return formulas.map(({ formula, context }) => this.evaluate(formula, context)); }
}
