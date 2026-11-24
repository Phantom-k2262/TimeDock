import { strFromU8, strToU8 } from "fflate";
import { updateFormulaCachesXml } from "./workbook";
import { StandardFormulaEngine } from "./standard-formulas";
import { COUNTIF2, HMINT, INTHM, 時間差, 勤務時間FromRanges, 残業時間FromRanges, 代休取得時間FromRanges, 遅刻早退時間FromRanges, VbaError } from "./vba-functions";
import { readCpuUsage, readHeapUsed } from "../runtime-metrics";

export type RecalculationPhaseTiming = { elapsedMs: number; items: number };
export type WorkbookRecalculationReport = {
  totalFormulas: number; calculationTargets: number; evaluationSuccesses: number; evaluationFailures: number; unsupported: number;
  emptyCachesBefore: number; emptyCachesAfter: number; evaluatedCells: string[]; evaluatedCellDetails: Array<{ sheet: string; reference: string; formula: string }>;
  emptyCacheCells: string[];
  resourceUsage?: { cpuUserMs?: number; cpuSystemMs?: number; heapUsedBefore?: number; heapUsedAfter?: number };
  unsupportedCells: Array<{ sheet: string; reference: string; formula: string; reason: string; category?: "direct-unsupported" | "dependency-unsupported" | "cycle" | "parse-failure" }>;
  timings: { unzip?: RecalculationPhaseTiming; parse: RecalculationPhaseTiming; sharedExpansion: RecalculationPhaseTiming; names: RecalculationPhaseTiming; dependencyGraph: RecalculationPhaseTiming; evaluation: RecalculationPhaseTiming; cacheUpdate: RecalculationPhaseTiming };
};
export type WorkbookRecalculationOptions = { trustedCachedCells?: ReadonlySet<string> };

type Cell = { reference: string; formula?: string; formulaAttributes?: string; cache: unknown; emptyCache: boolean; path: string; sheet: string };
type Ref = { sheet: string; range: string };
const now = () => typeof performance === "undefined" ? Date.now() : performance.now();
const nodeRuntime = () => (globalThis as typeof globalThis & { process?: unknown }).process;

function decode(value: string) { return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"); }
function readValue(content: string, type?: string): unknown { const raw = content.match(/<v\b[^>]*>([\s\S]*?)<\/v\s*>/)?.[1]; if (raw === undefined || raw === "") return ""; const value = decode(raw); if (type === "str" || type === "inlineStr") return value; if (type === "b") return value === "1"; const number = Number(value); return Number.isFinite(number) ? number : value; }
function parseCells(xml: string, path: string, sheet: string): Cell[] {
  return [...xml.matchAll(/<c\b([^>]*\br=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/c>/g)].map((match) => {
    const attrs = match[1];
    const content = match[3];
    const formula = content.match(/<f\b([^>]*)>([\s\S]*?)<\/f\s*>/) ?? content.match(/<f\b([^>]*)\/>/);
    return {
      reference: match[2],
      formula: formula?.[2] === undefined ? undefined : decode(formula[2].trim()),
      formulaAttributes: formula?.[1],
      cache: readValue(content, attrs.match(/\bt=["']([^"']+)["']/)?.[1]),
      emptyCache: !/<v\b[^>]*>[\s\S]*?<\/v\s*>/.test(content),
      path,
      sheet,
    };
  });
}
function sharedFormulas(xml: string) {
  const result = new Map<string, { parent: string; formula: string }>();
  for (const match of xml.matchAll(/<c\b[^>]*\br=["']([^"']+)["'][^>]*>([\s\S]*?)<\/c>/g)) {
    const formula = match[2].match(/<f\b([^>]*)>([\s\S]*?)<\/f\s*>/);
    const id = formula?.[1].match(/\bsi=["'](\d+)["']/)?.[1];
    if (id && formula?.[2] !== undefined) result.set(id, { parent: match[1], formula: decode(formula[2].trim()) });
  }
  return result;
}
function sheetMap(entries: Record<string, Uint8Array>) { const workbook = strFromU8(entries["xl/workbook.xml"] ?? new Uint8Array()); const rels = strFromU8(entries["xl/_rels/workbook.xml.rels"] ?? new Uint8Array()); const targets = new Map<string, string>(); for (const m of rels.matchAll(/<Relationship\b[^>]*\bId=["']([^"']+)["'][^>]*\bTarget=["']([^"']+)["']/g)) targets.set(m[1], `xl/${m[2].replace(/^\/+/, "").replace(/^xl\//, "")}`); return new Map([...workbook.matchAll(/<sheet\b[^>]*\bname=["']([^"']+)["'][^>]*\br:id=["']([^"']+)["']/g)].map((m) => [targets.get(m[2]) ?? "", m[1]])); }
function translateFormula(formula: string, parent: string, child: string) { const parse = (r: string) => { const m = r.match(/^([A-Z]+)(\d+)$/i); return m ? { col: [...m[1].toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0), row: Number(m[2]) } : undefined; }; const name = (n: number) => { let s = ""; for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) s = String.fromCharCode(65 + ((v - 1) % 26)) + s; return s; }; const a = parse(parent); const b = parse(child); if (!a || !b) return formula; return formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (_m, ac, col, ar, row) => `${ac ? "$" : ""}${name((ac ? 0 : b.col - a.col) + [...col.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0))}${ar ? "$" : ""}${ar ? row : Number(row) + b.row - a.row}`); }
function cellParts(reference: string) { const m = reference.replace(/\$/g, "").match(/^([A-Z]+)(\d+)$/i); return m ? { col: [...m[1].toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0), row: Number(m[2]) } : undefined; }
const columnNames = new Map<number, string>();
function columnName(number: number) {
  const cached = columnNames.get(number);
  if (cached) return cached;
  let result = "";
  for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  columnNames.set(number, result);
  return result;
}
function inRange(range: string, reference: string) { const [l, r = l] = range.split(":"); const a = cellParts(l); const b = cellParts(r); const c = cellParts(reference); return Boolean(a && b && c && c.col >= Math.min(a.col, b.col) && c.col <= Math.max(a.col, b.col) && c.row >= Math.min(a.row, b.row) && c.row <= Math.max(a.row, b.row)); }
function references(formula: string, localSheet: string): Ref[] { const found: Ref[] = []; const qualified = new Set<string>(); for (const m of formula.matchAll(/(?:'((?:[^']|'')+)'|([^!\s()+*/,:=<>]+))!(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/g)) { const range = m[3].replace(/\$/g, ""); found.push({ sheet: (m[1] ?? m[2]).replace(/''/g, "'"), range }); qualified.add(range); } for (const m of formula.matchAll(/(?<![A-Za-z0-9_!])\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g)) { const range = m[0].replace(/\$/g, ""); if (!qualified.has(range)) found.push({ sheet: localSheet, range }); } return found; }
function safeVba(value: unknown) { if (value && typeof value === "object" && (value as VbaError).kind === "error") throw new Error((value as VbaError).code); if (value && typeof value === "object" && (value as { kind?: string }).kind === "empty") return null; return value as string | number | boolean | null; }

type DefinedName = { name: string; sheet: string; range: string };
function definedNames(xml: string): DefinedName[] {
  const result: DefinedName[] = [];
  for (const match of xml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName\s*>/g)) {
    const name = match[1].match(/\bname=["']([^"']+)["']/)?.[1];
    const value = decode(match[2].trim()).replace(/^=/, "");
    const ref = value.match(/^(?:'((?:[^']|'')+)'|([^!]+))!(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)$/i);
    if (!name || !ref) continue;
    result.push({ name, sheet: (ref[1] ?? ref[2]).replace(/''/g, "'"), range: ref[3].replace(/\$/g, "") });
  }
  return result;
}

/** One XML parse, one dependency graph, and one topological evaluation pass. */
export function recalculateWorkbookFormulas(entries: Record<string, Uint8Array>, options: WorkbookRecalculationOptions = {}): WorkbookRecalculationReport {
  const runtime = nodeRuntime();
  const cpuStart = readCpuUsage(runtime);
  const heapBefore = readHeapUsed(runtime);
  const parseStart = now();
  const names = sheetMap(entries);
  const formulaCells: Cell[] = [];
  const allCellsBySheet = new Map<string, Cell[]>();
  let emptyBefore = 0;
  let sharedCount = 0;
  const sharedStart = now();
  for (const [path, bytes] of Object.entries(entries)) {
    if (!/^xl\/worksheets\/.*\.xml$/.test(path)) continue;
    const sheet = names.get(path) ?? path;
    const xml = strFromU8(bytes);
    const shared = sharedFormulas(xml);
    const cells = parseCells(xml, path, sheet);
    for (const cell of cells) {
      const id = cell.formulaAttributes?.match(/\bsi=["'](\d+)["']/)?.[1];
      if (!cell.formula && id && shared.has(id)) {
        const parent = shared.get(id)!;
        cell.formula = translateFormula(parent.formula, parent.parent, cell.reference);
        sharedCount += 1;
      }
      if (cell.formula !== undefined) {
        formulaCells.push(cell);
        if (cell.emptyCache) emptyBefore += 1;
      }
    }
    allCellsBySheet.set(sheet, cells);
  }
  const sharedElapsed = now() - sharedStart;
  const parseElapsed = now() - parseStart;

  const namesStart = now();
  const defined = definedNames(strFromU8(entries["xl/workbook.xml"] ?? new Uint8Array()));
  const nameCount = defined.length;
  const namesElapsed = now() - namesStart;

  const graphStart = now();
  const byKey = new Map(formulaCells.map((cell) => [`${cell.sheet}!${cell.reference}`, cell]));
  const outgoing = new Map<Cell, Cell[]>();
  const indegree = new Map<Cell, number>();
  const blocked = new Map<Cell, string>();
  for (const cell of formulaCells) {
    const deps = new Set<Cell>();
    for (const ref of references(cell.formula ?? "", cell.sheet)) {
      const [left, right = left] = ref.range.split(":");
      const a = cellParts(left); const b = cellParts(right);
      if (!a || !b) continue;
      for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row += 1) {
        for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col += 1) {
          const producer = byKey.get(`${ref.sheet}!${columnName(col)}${row}`);
          if (producer && producer !== cell) deps.add(producer);
        }
      }
    }
    indegree.set(cell, deps.size);
    for (const producer of deps) {
      const children = outgoing.get(producer);
      if (children) children.push(cell); else outgoing.set(producer, [cell]);
    }
  }
  const graphElapsed = now() - graphStart;

  const context = new Map<string, unknown>();
  const cellsByReference = new Map<string, Map<string, Cell>>();
  for (const [sheet, cells] of allCellsBySheet) {
    for (const cell of cells) context.set(`${sheet}!${cell.reference}`, cell.cache);
    cellsByReference.set(sheet, new Map(cells.map((cell) => [cell.reference, cell])));
  }
  for (const name of defined) {
    const values: unknown[] = [];
    const cells = cellsByReference.get(name.sheet) ?? new Map<string, Cell>();
    const [left, right = left] = name.range.split(":");
    const a = cellParts(left); const b = cellParts(right);
    if (!a || !b) continue;
    for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row += 1) {
      for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col += 1) values.push(cells.get(`${columnName(col)}${row}`)?.cache ?? "");
    }
    context.set(name.name, values);
  }

  const localContexts = new Map<string, Map<string, unknown>>();
  for (const [sheet, cells] of allCellsBySheet) {
    const local = new Map(context);
    for (const cell of cells) local.set(cell.reference, cell.cache);
    localContexts.set(sheet, local);
  }
  const custom = new Map<string, (...args: unknown[]) => unknown>([
    ["INTHM", (v) => safeVba(INTHM(v as number))],
    ["HMINT", (v) => safeVba(HMINT(v as number))],
    ["COUNTIF2", (values, criterion) => safeVba(COUNTIF2((values as unknown[]).map((v) => v as never), criterion as never))],
    ["時間差", (left, right) => safeVba(時間差(left as never, right as never))],
    ["勤務時間", (input, code) => safeVba(勤務時間FromRanges((input as unknown[]).map((v) => v as never), (code as unknown[]).map((v) => v as never)))],
    ["残業時間", (input, code, type) => safeVba(残業時間FromRanges((input as unknown[]).map((v) => v as never), (code as unknown[]).map((v) => v as never), String(type ?? "")))],
    ["代休取得時間", (input) => safeVba(代休取得時間FromRanges((input as unknown[]).map((v) => v as never)))],
    ["遅刻早退時間", (input, code) => safeVba(遅刻早退時間FromRanges((input as unknown[]).map((v) => v as never), (code as unknown[]).map((v) => v as never)))],
  ]);
  const engine = new StandardFormulaEngine(custom);
  const queue = formulaCells.filter((cell) => indegree.get(cell) === 0);
  const evaluatedCells: string[] = [];
  const evaluatedCellDetails: WorkbookRecalculationReport["evaluatedCellDetails"] = [];
  const unsupportedCells: WorkbookRecalculationReport["unsupportedCells"] = [];
  const updates = new Map<string, Array<{ reference: string; value: string | number | boolean | null; numeric?: boolean }>>();
  const evaluationStart = now();
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const cell = queue[queueIndex++];
    const reason = blocked.get(cell);
    let failure: string | undefined;
    let category: "direct-unsupported" | "dependency-unsupported" | "parse-failure" | undefined;
    const trusted = options.trustedCachedCells?.has(`${cell.sheet}!${cell.reference}`) === true;
    if (reason) {
      failure = reason;
      category = "dependency-unsupported";
    } else {
      const local = localContexts.get(cell.sheet) ?? new Map<string, unknown>();
      const result = trusted ? { status: "evaluated" as const, value: cell.cache as string | number | boolean | null } : engine.evaluate(cell.formula ?? "", local);
      if (result.status === "evaluated") {
        const value = result.value ?? null;
        cell.cache = value;
        context.set(`${cell.sheet}!${cell.reference}`, value);
        local.set(cell.reference, value);
        if (!trusted) {
          cell.emptyCache = false;
          const list = updates.get(cell.path) ?? [];
          list.push({ reference: cell.reference, value, numeric: typeof value === "number" });
          updates.set(cell.path, list);
        }
        evaluatedCells.push(`${cell.sheet}!${cell.reference}`);
      } else {
        failure = result.reason ?? "evaluation-failed";
        category = failure.startsWith("unsupported-") ? "parse-failure" : "dependency-unsupported";
      }
    }
    if (!failure && !trusted) evaluatedCellDetails.push({ sheet: cell.sheet, reference: cell.reference, formula: cell.formula ?? "" });
    if (failure) {
      unsupportedCells.push({ sheet: cell.sheet, reference: cell.reference, formula: cell.formula ?? "", reason: failure, category });
      for (const child of outgoing.get(cell) ?? []) blocked.set(child, `dependency:${cell.sheet}!${cell.reference}`);
    }
    for (const child of outgoing.get(cell) ?? []) {
      indegree.set(child, (indegree.get(child) ?? 1) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }
  for (const cell of formulaCells) if ((indegree.get(cell) ?? 0) > 0) unsupportedCells.push({ sheet: cell.sheet, reference: cell.reference, formula: cell.formula ?? "", reason: "circular-reference", category: "cycle" });
  const evaluationElapsed = now() - evaluationStart;
  const cacheStart = now();
  for (const [path, list] of updates) entries[path] = strToU8(updateFormulaCachesXml(strFromU8(entries[path]), list));
  const emptyCacheCells = formulaCells.filter((cell) => cell.emptyCache).map((cell) => `${cell.sheet}!${cell.reference}`);
  const cacheElapsed = now() - cacheStart;
  const heapAfter = readHeapUsed(runtime);
  const cpu = cpuStart ? readCpuUsage(runtime, cpuStart) : undefined;
  return { totalFormulas: formulaCells.length, calculationTargets: formulaCells.length, evaluationSuccesses: evaluatedCells.length, evaluationFailures: unsupportedCells.length, unsupported: unsupportedCells.length, emptyCachesBefore: emptyBefore, emptyCachesAfter: emptyCacheCells.length, emptyCacheCells, evaluatedCells, evaluatedCellDetails, unsupportedCells, resourceUsage: { cpuUserMs: cpu ? cpu.user / 1000 : undefined, cpuSystemMs: cpu ? cpu.system / 1000 : undefined, heapUsedBefore: heapBefore, heapUsedAfter: heapAfter }, timings: { parse: { elapsedMs: parseElapsed, items: formulaCells.length }, sharedExpansion: { elapsedMs: sharedElapsed, items: sharedCount }, names: { elapsedMs: namesElapsed, items: nameCount }, dependencyGraph: { elapsedMs: graphElapsed, items: formulaCells.length }, evaluation: { elapsedMs: evaluationElapsed, items: formulaCells.length }, cacheUpdate: { elapsedMs: cacheElapsed, items: [...updates.values()].reduce((n, list) => n + list.length, 0) } } };
}
