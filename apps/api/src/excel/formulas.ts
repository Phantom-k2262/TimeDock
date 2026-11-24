import type { FormulaEvaluationResult } from "./types";
import { strFromU8, strToU8 } from "fflate";
import { updateFormulaCachesXml } from "./workbook";

const customFunctions = ["勤務時間", "残業時間", "COUNTIF2", "代休取得時間", "遅刻早退時間", "時間差", "HMINT", "INTHM"];

export type FormulaCell = {
  path: string;
  reference: string;
  formula: string;
  cachedValue: string | null;
};

export type FormulaInventory = {
  total: number;
  evaluated: number;
  deferredToExcel: number;
  unsupported: number;
  cells: FormulaCell[];
};

export type FormulaInvalidationInput = {
  path: string;
  name: string;
  changed: Set<string>;
};

type FormulaNode = {
  reference: string;
  formula: string | null;
  sharedIndex: string | null;
};

type SharedFormula = { parent: string; formula: string; ref: string | null };

function columnNumber(column: string) {
  let result = 0;
  for (const character of column) result = result * 26 + character.charCodeAt(0) - 64;
  return result;
}

function columnName(value: number) {
  let result = "";
  for (let current = value; current > 0; current = Math.floor((current - 1) / 26)) result = String.fromCharCode(65 + ((current - 1) % 26)) + result;
  return result;
}

function cellParts(reference: string) {
  const match = reference.match(/^\$?([A-Z]+)\$?(\d+)$/i);
  return match ? { column: columnNumber(match[1].toUpperCase()), row: Number(match[2]) } : null;
}

function rangeParts(value: string) {
  const [left, right = left] = value.split(":");
  const a = cellParts(left); const b = cellParts(right);
  return a && b ? { left: Math.min(a.column, b.column), right: Math.max(a.column, b.column), top: Math.min(a.row, b.row), bottom: Math.max(a.row, b.row) } : null;
}

function containsCell(range: string, reference: string) {
  const target = cellParts(reference); const bounds = rangeParts(range);
  return Boolean(target && bounds && target.column >= bounds.left && target.column <= bounds.right && target.row >= bounds.top && target.row <= bounds.bottom);
}

function translateFormula(formula: string, parent: string, child: string) {
  const from = cellParts(parent); const to = cellParts(child);
  if (!from || !to) return formula;
  const rowDelta = to.row - from.row; const columnDelta = to.column - from.column;
  return formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (_match, absoluteColumn, column, absoluteRow, row) => {
    const nextColumn = absoluteColumn ? columnNumber(column) : columnNumber(column) + columnDelta;
    const nextRow = absoluteRow ? Number(row) : Number(row) + rowDelta;
    return `${absoluteColumn ? "$" : ""}${columnName(nextColumn)}${absoluteRow ? "$" : ""}${nextRow}`;
  });
}

function formulaReferences(formula: string, localSheet: string) {
  const refs: Array<{ sheet: string; range: string }> = [];
  const qualified = /(?:'((?:[^']|'')+)'|([A-Za-z_][^!\s()+*/,:=<>]*))!(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/g;
  for (const match of formula.matchAll(qualified)) refs.push({ sheet: (match[1] ?? match[2] ?? localSheet).replace(/''/g, "'"), range: match[3].replace(/\$/g, "") });
  const qualifiedRanges = new Set(refs.map((reference) => reference.range));
  const local = /(?<![A-Za-z0-9_!])\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g;
  for (const match of formula.matchAll(local)) if (!qualifiedRanges.has(match[0].replace(/\$/g, ""))) refs.push({ sheet: localSheet, range: match[0].replace(/\$/g, "") });
  return refs;
}

function parseFormulaNodes(xml: string): FormulaNode[] {
  return [...xml.matchAll(/<c\b([^>]*\br=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/c>/g)].flatMap((match) => {
    const content = match[3];
    const formula = content.match(/<f\b([^>]*)>([\s\S]*?)<\/f\s*>/) ?? content.match(/<f\b([^>]*)\/>/);
    if (!formula) return [];
    const attributes = formula[1] ?? "";
    return [{ reference: match[2], formula: formula[2] === undefined ? null : formula[2].replace(/<!\[CDATA\[|\]\]>/g, "").trim(), sharedIndex: attributes.match(/\bsi=["'](\d+)["']/)?.[1] ?? null }];
  });
}

/**
 * Invalidates only formula caches whose references intersect changed input
 * cells. Shared-formula children are translated from their parent before the
 * dependency check. Unknown UDF/name formulas on an affected sheet are
 * conservatively invalidated; unrelated sheets and unrelated caches remain.
 */
export function invalidateImpactedFormulaCaches(entries: Record<string, Uint8Array>, inputs: FormulaInvalidationInput[], options: { transitive?: boolean } = {}) {
  const byName = new Map(inputs.map((input) => [input.name, input]));
  const records: Array<{ input: FormulaInvalidationInput; node: FormulaNode; formula: string; references: Array<{ sheet: string; range: string }> }> = [];
  for (const input of inputs) {
    const source = entries[input.path];
    if (!source) continue;
    const xml = strFromU8(source);
    const nodes = parseFormulaNodes(xml);
    const shared = new Map<string, SharedFormula>();
    for (const node of nodes) {
      if (node.sharedIndex && node.formula) {
        const raw = xml.match(new RegExp(`<c\\b[^>]*\\br=["']${node.reference}["'][^>]*>[\\s\\S]*?<f\\b([^>]*)>[\\s\\S]*?<\\/f\\s*>`))?.[1] ?? "";
        shared.set(node.sharedIndex, { parent: node.reference, formula: node.formula, ref: raw.match(/\bref=["']([^"']+)["']/)?.[1] ?? null });
      }
    }
    for (const node of nodes) {
      const group = node.sharedIndex ? shared.get(node.sharedIndex) : undefined;
      const formula = node.formula ?? (group ? translateFormula(group.formula, group.parent, node.reference) : null);
      if (formula) records.push({ input, node, formula, references: formulaReferences(formula, input.name) });
    }
  }
  const impacted = new Set<string>();
  const cellKey = (path: string, reference: string) => `${path}!${reference}`;
  const referencesImpactedFormula = (reference: { sheet: string; range: string }) => {
    const target = byName.get(reference.sheet);
    if (!target) return false;
    return records.some((record) => record.input.path === target.path && containsCell(reference.range, record.node.reference) && impacted.has(cellKey(record.input.path, record.node.reference)));
  };
  const directImpacted = (record: typeof records[number]) => {
    const direct = record.references.some((reference) => {
      const target = byName.get(reference.sheet);
      return target ? [...target.changed].some((cell) => containsCell(reference.range, cell)) : false;
    });
    const customOrNamedUnknown = !record.references.length && (record.formula.includes("勤務時間") || record.formula.includes("COUNTIF2") || /[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(record.formula));
    return direct || (customOrNamedUnknown && record.input.changed.size > 0);
  };
  for (const record of records) if (directImpacted(record)) impacted.add(cellKey(record.input.path, record.node.reference));
  if (options.transitive !== false) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of records) {
        const key = cellKey(record.input.path, record.node.reference);
        if (impacted.has(key)) continue;
        if (record.references.some(referencesImpactedFormula)) {
          impacted.add(key);
          changed = true;
        }
      }
    }
  }
  const referencesByPath = new Map<string, Set<string>>();
  for (const record of records) {
    if (!impacted.has(cellKey(record.input.path, record.node.reference))) continue;
    const references = referencesByPath.get(record.input.path) ?? new Set<string>();
    references.add(record.node.reference);
    referencesByPath.set(record.input.path, references);
  }
  let invalidated = 0;
  for (const [path, references] of referencesByPath) {
    const source = entries[path];
    if (!source) continue;
    const before = strFromU8(source);
    const after = updateFormulaCachesXml(before, [...references].map((reference) => ({ reference, value: null })));
    if (after !== before) {
      entries[path] = strToU8(after);
      invalidated += references.size;
    }
  }
  return invalidated;
}

export function classifyFormula(formula: string): FormulaEvaluationResult {
  if (customFunctions.some((name) => formula.includes(name))) return { formula, status: "unsupported", reason: "VBA/UDF依存のためWorkersでは評価していません" };
  if (/\[[^\]]+\]|https?:\/\//i.test(formula)) return { formula, status: "unsupported", reason: "外部リンク依存のため評価していません" };
  if (/^(?:SUM|IF|ROUND|ROUNDDOWN|ROUNDUP|COUNTIF|SUMIF|MAX|MIN|AND|OR|NOT|ABS|INT|MOD|TEXT)\s*\(/i.test(formula.trim())) return { formula, status: "deferred-to-excel", reason: "標準関数ですがWorkers側ではキャッシュを再生成していません" };
  return { formula, status: "deferred-to-excel", reason: "Excel本体での再計算に委ねます" };
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/**
 * Inspects formulas without rebuilding the workbook. This is deliberately
 * package-level metadata only: the editor owns OOXML writes and the engine
 * never serializes a workbook.
 */
export function inspectFormulaInventory(entries: Record<string, Uint8Array>): FormulaInventory {
  const cells: FormulaCell[] = [];
  for (const [path, data] of Object.entries(entries)) {
    if (!/^xl\/worksheets\/.*\.xml$/.test(path)) continue;
    const xml = new TextDecoder().decode(data);
    for (const match of xml.matchAll(/<c\b([^>]*\br=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/c>/g)) {
      const content = match[3];
      const formula = content.match(/<f\b[^>]*>([\s\S]*?)<\/f\s*>/)?.[1];
      if (formula === undefined) continue;
      const cachedValue = content.match(/<v\b[^>]*>([\s\S]*?)<\/v\s*>/)?.[1];
      cells.push({ path, reference: match[2], formula: decodeXml(formula).trim(), cachedValue: cachedValue === undefined ? null : decodeXml(cachedValue) });
    }
  }
  const evaluated = cells.filter((cell) => classifyFormula(cell.formula).status === "evaluated").length;
  const deferredToExcel = cells.filter((cell) => classifyFormula(cell.formula).status === "deferred-to-excel").length;
  const unsupported = cells.filter((cell) => classifyFormula(cell.formula).status === "unsupported").length;
  return { total: cells.length, evaluated, deferredToExcel, unsupported, cells };
}

export interface FormulaEvaluationService {
  evaluate(formulas: string[]): Promise<FormulaEvaluationResult[]>;
}

export class DeferredFormulaEvaluationService implements FormulaEvaluationService {
  async evaluate(formulas: string[]) { return formulas.map(classifyFormula); }
}
