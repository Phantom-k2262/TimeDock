import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { CellValue, ExcelApplicationService, IntegrityReport, TemplateMappingResolver, WorkbookEditor, WorkbookEntries, WorkbookExportService, WorkbookInspection, WorkbookInspector, WorkbookIntegrityValidator } from "./types";

function escapeXml(value: CellValue) {
  return String(value ?? "").replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" })[character] ?? character);
}

function byteEqual(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function resolveTarget(target: string) {
  const normalized = target.replace(/^\/+/, "").replace(/^\.\.\//, "xl/");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

export function inspectWorkbook(entries: WorkbookEntries): WorkbookInspection {
  const workbook = strFromU8(entries["xl/workbook.xml"] ?? new Uint8Array());
  const rels = strFromU8(entries["xl/_rels/workbook.xml.rels"] ?? new Uint8Array());
  const relationships = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*\bId=["']([^"']+)["'][^>]*\bTarget=["']([^"']+)["'][^>]*\/?>(?:<\/Relationship>)?/g)) relationships.set(match[1], resolveTarget(match[2]));
  const sheets = Array.from(workbook.matchAll(/<sheet\b([^>]*)\bname=["']([^"']+)["']([^>]*)\br:id=["']([^"']+)["'][^>]*\/?/g)).map((match) => ({
    name: match[2],
    path: relationships.get(match[4]) ?? "",
    state: (match[1] + match[3]).match(/\bstate=["']([^"']+)["']/)?.[1] ?? "visible",
  }));
  const definedNames = Array.from(workbook.matchAll(/<definedName\b[^>]*\bname=["']([^"']+)["'][^>]*>/g)).map((match) => match[1]);
  const formulaCount = Object.entries(entries).filter(([path]) => /^xl\/worksheets\/.*\.xml$/.test(path)).reduce((count, [, data]) => count + (strFromU8(data).match(/<f\b/g)?.length ?? 0), 0);
  const customFormulaCount = Object.entries(entries).filter(([path]) => /^xl\/worksheets\/.*\.xml$/.test(path)).reduce((count, [, data]) => count + (strFromU8(data).match(/<(?:f|definedName)\b[^>]*>(?:[^<]*)(?:勤務時間|残業時間|COUNTIF2|代休取得時間|遅刻早退時間)/g)?.length ?? 0), 0);
  return { sheets, definedNames, formulaCount, customFormulaCount, hasVbaProject: Boolean(entries["xl/vbaProject.bin"]), hasCalcChain: Boolean(entries["xl/calcChain.xml"]), };
}

export class DefaultWorkbookInspector implements WorkbookInspector {
  inspect(entries: WorkbookEntries) { return inspectWorkbook(entries); }
}

export function validateWorkbookIntegrity(before: WorkbookEntries, after: WorkbookEntries, allowedPaths: string[]): IntegrityReport {
  const allowed = new Set(allowedPaths);
  const issues: IntegrityReport["issues"] = [];
  const preserved: string[] = [];
  const allPaths = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const path of allPaths) {
    if (allowed.has(path)) continue;
    const source = before[path];
    const output = after[path];
    if (!source) { issues.push({ path, kind: "added", detail: "出力にのみ存在するパーツです" }); continue; }
    if (!output) { issues.push({ path, kind: "missing", detail: "テンプレートのパーツが出力から失われています" }); continue; }
    if (!byteEqual(source, output)) issues.push({ path, kind: "changed", detail: "許可されていないパーツが変更されています" });
    else preserved.push(path);
  }
  return { ok: issues.length === 0, issues, preserved, allowedChanges: allowedPaths };
}

export class DefaultWorkbookIntegrityValidator implements WorkbookIntegrityValidator {
  validate(before: WorkbookEntries, after: WorkbookEntries, allowedPaths: string[]) { return validateWorkbookIntegrity(before, after, allowedPaths); }
}

export class NamedRangeMappingResolver implements TemplateMappingResolver {
  private readonly mappings: Map<string, string>;

  constructor(entries: WorkbookEntries) {
    const workbook = strFromU8(entries["xl/workbook.xml"] ?? new Uint8Array());
    this.mappings = new Map(Array.from(workbook.matchAll(/<definedName\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/definedName\s*>/g)).map((match) => [match[1], match[2].trim()]));
  }

  resolve(logicalName: string) { return this.mappings.get(logicalName) ?? null; }
}

export class ZipWorkbookEditor implements WorkbookEditor {
  private entries: WorkbookEntries = {};

  async load(source: ArrayBuffer | Uint8Array) {
    this.entries = unzipSync(source instanceof Uint8Array ? source : new Uint8Array(source));
  }

  async setCellValue(sheet: string, cell: string, value: CellValue) {
    const path = Object.entries(inspectWorkbook(this.entries).sheets).find(([, item]) => item.name === sheet)?.[1].path;
    if (!path || !this.entries[path]) throw new Error(`シートが見つかりません: ${sheet}`);
    const xml = strFromU8(this.entries[path]);
    const encoded = value === null ? "" : `<is><t xml:space="preserve">${escapeXml(value)}</t></is>`;
    const updated = xml.replace(new RegExp(`<c\\b([^>]*\\br=["']${cell}["'][^>]*)(?:/>|>[\\s\\S]*?<\\/c>)`), `<c$1 t="inlineStr">${encoded}</c>`);
    if (updated === xml) throw new Error(`セルが見つかりません: ${sheet}!${cell}`);
    this.entries[path] = strToU8(updated);
  }

  async export() { return zipSync(this.entries, { level: 6 }); }
}

export class DelegatingWorkbookExportService<TInput> implements WorkbookExportService<TInput> {
  constructor(private readonly handler: (template: Uint8Array, input: TInput) => Uint8Array | Promise<Uint8Array>) {}
  async export(template: Uint8Array, input: TInput) { return this.handler(template, input); }
}

export class ComposedExcelApplicationService<TInput> implements ExcelApplicationService<TInput> {
  constructor(private readonly inspector: WorkbookInspector, private readonly exporter: WorkbookExportService<TInput>) {}
  inspect(template: Uint8Array) { return this.inspector.inspect(unzipSync(template)); }
  export(template: Uint8Array, input: TInput) { return this.exporter.export(template, input); }
}

export function cloneEntries(entries: WorkbookEntries): WorkbookEntries {
  return Object.fromEntries(Object.entries(entries).map(([path, data]) => [path, data.slice()]));
}
