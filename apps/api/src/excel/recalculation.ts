import { strFromU8 } from "fflate";
import type { FormulaEvaluationResult } from "./types";

export type FormulaLocation = { path: string; sheet: string; reference: string };
export type FormulaDependency = FormulaLocation & { formula: string; references: Array<{ sheet: string; range: string }>; sharedParent?: string };

function columnNumber(value: string) {
  return [...value.toUpperCase()].reduce((result, character) => result * 26 + character.charCodeAt(0) - 64, 0);
}

function columnName(value: number) {
  let result = "";
  for (let current = value; current > 0; current = Math.floor((current - 1) / 26)) result = String.fromCharCode(65 + ((current - 1) % 26)) + result;
  return result;
}

function cellParts(reference: string) {
  const match = reference.match(/^\$?([A-Z]+)\$?(\d+)$/i);
  return match ? { column: columnNumber(match[1]), row: Number(match[2]) } : null;
}

function translateFormula(formula: string, parent: string, child: string) {
  const from = cellParts(parent); const to = cellParts(child);
  if (!from || !to) return formula;
  const rowDelta = to.row - from.row; const columnDelta = to.column - from.column;
  return formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (_match, absoluteColumn, column, absoluteRow, row) => `${absoluteColumn ? "$" : ""}${columnName(absoluteColumn ? columnNumber(column) : columnNumber(column) + columnDelta)}${absoluteRow ? "$" : ""}${absoluteRow ? Number(row) : Number(row) + rowDelta}`);
}

function references(formula: string, localSheet: string) {
  const result: Array<{ sheet: string; range: string }> = [];
  const qualified = /(?:'((?:[^']|'')+)'|([A-Za-z_][^!\s()+*/,:=<>]*))!(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/g;
  const qualifiedRanges = new Set<string>();
  for (const match of formula.matchAll(qualified)) {
    const range = match[3].replace(/\$/g, "");
    result.push({ sheet: (match[1] ?? match[2] ?? localSheet).replace(/''/g, "'"), range });
    qualifiedRanges.add(range);
  }
  const local = /(?<![A-Za-z0-9_!])\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g;
  for (const match of formula.matchAll(local)) {
    const range = match[0].replace(/\$/g, "");
    if (!qualifiedRanges.has(range)) result.push({ sheet: localSheet, range });
  }
  return result;
}

function cellInRange(range: string, reference: string) {
  const [left, right = left] = range.split(":");
  const a = cellParts(left); const b = cellParts(right); const target = cellParts(reference);
  if (!a || !b || !target) return false;
  return target.column >= Math.min(a.column, b.column) && target.column <= Math.max(a.column, b.column) && target.row >= Math.min(a.row, b.row) && target.row <= Math.max(a.row, b.row);
}

function sheetNameByPath(entries: Record<string, Uint8Array>) {
  const workbook = strFromU8(entries["xl/workbook.xml"] ?? new Uint8Array());
  const rels = strFromU8(entries["xl/_rels/workbook.xml.rels"] ?? new Uint8Array());
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*\bId=["']([^"']+)["'][^>]*\bTarget=["']([^"']+)["']/g)) targets.set(match[1], `xl/${match[2].replace(/^\/+/, "").replace(/^xl\//, "")}`);
  return new Map([...workbook.matchAll(/<sheet\b[^>]*\bname=["']([^"']+)["'][^>]*\br:id=["']([^"']+)["']/g)].map((match) => [targets.get(match[2]) ?? "", match[1]]));
}

/** Parses formula cells while retaining shared-formula parent/child semantics. */
export class DependencyResolver {
  resolve(entries: Record<string, Uint8Array>): FormulaDependency[] {
    const names = sheetNameByPath(entries);
    const output: FormulaDependency[] = [];
    for (const [path, bytes] of Object.entries(entries)) {
      if (!/^xl\/worksheets\/.*\.xml$/.test(path)) continue;
      const xml = strFromU8(bytes);
      const shared = new Map<string, { parent: string; formula: string }>();
      for (const match of xml.matchAll(/<c\b[^>]*\br=["']([^"']+)["'][^>]*>([\s\S]*?)<\/c>/g)) {
        const formula = match[2].match(/<f\b([^>]*)>([\s\S]*?)<\/f\s*>/);
        if (formula?.[1].match(/\bsi=["'](\d+)["']/) && formula[2] !== undefined) shared.set(formula[1].match(/\bsi=["'](\d+)["']/)![1], { parent: match[1], formula: formula[2].trim() });
      }
      for (const match of xml.matchAll(/<c\b[^>]*\br=["']([^"']+)["'][^>]*>([\s\S]*?)<\/c>/g)) {
        const formula = match[2].match(/<f\b([^>]*)>([\s\S]*?)<\/f\s*>/);
        const selfClosing = match[2].match(/<f\b([^>]*)\/>/);
        const attributes = formula?.[1] ?? selfClosing?.[1] ?? "";
        const sharedId = attributes.match(/\bsi=["'](\d+)["']/)?.[1];
        const parent = sharedId ? shared.get(sharedId) : undefined;
        const text = formula?.[2]?.trim() || (parent ? translateFormula(parent.formula, parent.parent, match[1]) : undefined);
        if (!text) continue;
        output.push({ path, sheet: names.get(path) ?? path, reference: match[1], formula: text, references: references(text, names.get(path) ?? path), sharedParent: parent?.parent });
      }
    }
    return output;
  }

  impacted(formulas: FormulaDependency[], changed: ReadonlyMap<string, ReadonlySet<string>>) {
    const impacted = new Set<string>();
    const key = (item: FormulaDependency) => `${item.path}!${item.reference}`;
    const direct = (item: FormulaDependency) => item.references.some((reference) => [...(changed.get(reference.sheet) ?? [])].some((cell) => cellInRange(reference.range, cell)));
    formulas.filter(direct).forEach((item) => impacted.add(key(item)));
    let progress = true;
    while (progress) {
      progress = false;
      for (const item of formulas) {
        if (impacted.has(key(item))) continue;
        if (item.references.some((reference) => formulas.some((source) => source.sheet === reference.sheet && cellInRange(reference.range, source.reference) && impacted.has(key(source))))) {
          impacted.add(key(item)); progress = true;
        }
      }
    }
    return formulas.filter((item) => impacted.has(key(item)));
  }
}

export type CalculationComparison = { formula: string; expected: unknown; actual: unknown; equal: boolean };

/** Validation is intentionally independent from OOXML writing. */
export class CalculationValidator {
  compare(results: Array<{ formula: string; expected: unknown; actual: unknown }>): CalculationComparison[] {
    return results.map((result) => ({ ...result, equal: Object.is(result.expected, result.actual) || String(result.expected) === String(result.actual) }));
  }

  allEqual(results: CalculationComparison[]) { return results.every((result) => result.equal); }
}

export type RecalculationMetrics = {
  calculationTargets: number;
  calculationSuccesses: number;
  validationMatches: number;
  unsupported: number;
};

export function metricsFor(results: FormulaEvaluationResult[], validationMatches = 0): RecalculationMetrics {
  return {
    calculationTargets: results.length,
    calculationSuccesses: results.filter((result) => result.status === "evaluated").length,
    validationMatches,
    unsupported: results.filter((result) => result.status === "unsupported").length,
  };
}
