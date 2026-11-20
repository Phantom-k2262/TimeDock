import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
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

function worksheetCell(document: any, reference: string) {
  const cells = document.getElementsByTagName("c");
  for (let index = 0; index < cells.length; index += 1) if (cells[index].getAttribute("r") === reference) return cells[index];
  return null;
}

function replaceCellChildren(document: any, cell: any, value: CellValue, numeric: boolean) {
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  if (value === null) return;
  if (numeric) {
    cell.removeAttribute("t");
    const node = document.createElement("v");
    node.appendChild(document.createTextNode(String(value)));
    cell.appendChild(node);
    return;
  }
  cell.setAttribute("t", "inlineStr");
  const inline = document.createElement("is");
  const text = document.createElement("t");
  text.setAttribute("xml:space", "preserve");
  text.appendChild(document.createTextNode(String(value)));
  inline.appendChild(text);
  cell.appendChild(inline);
}

/** DOM-based cell update used by the isolated WorkbookEditor service. */
export function updateWorksheetCellXml(xml: string, reference: string, value: CellValue, numeric = false) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const cell = worksheetCell(document, reference);
  if (!cell) throw new Error(`セルが見つかりません: ${reference}`);
  replaceCellChildren(document, cell, value, numeric);
  return new XMLSerializer().serializeToString(document);
}

/** DOM-based cache update that preserves the formula child and cell style. */
export function updateFormulaCacheXml(xml: string, reference: string, value: FormulaCacheValue, numeric?: boolean) {
  return updateFormulaCachesXml(xml, [{ reference, value, numeric }]);
}

export type FormulaCacheError = { kind: "error"; code: string };
export type FormulaCacheValue = CellValue | FormulaCacheError;
export type FormulaCacheUpdate = { reference: string; value: FormulaCacheValue; numeric?: boolean };

function cacheValueType(value: FormulaCacheValue) {
  if (value !== null && typeof value === "object" && "kind" in value && value.kind === "error") return "error" as const;
  if (typeof value === "number") return "number" as const;
  if (typeof value === "boolean") return "boolean" as const;
  if (typeof value === "string") return "string" as const;
  return "empty" as const;
}

/** Update all requested caches with one DOM parse/serialization pass. */
export function updateFormulaCachesXml(xml: string, updates: FormulaCacheUpdate[]) {
  if (!updates.length) return xml;
  // Cache-only updates do not change XML structure. A single token-level pass
  // avoids reparsing a multi-megabyte worksheet with a DOM implementation in
  // Workers, while preserving every untouched byte, formula, style and child.
  const byReference = new Map(updates.map((update) => [update.reference, update]));
  // Keep self-closing and paired cells as separate alternatives.  If `/>` is
  // treated as an opening `>` the lazy content match can consume subsequent
  // cells/rows, leaving duplicate references that Excel repairs or deletes.
  return xml.replace(/<c\b([^>]*?\br=["']([^"']+)["'][^>]*?)\/>|<c\b([^>]*?\br=["']([^"']+)["'][^>]*?)>([\s\S]*?)<\/c\s*>/g, (cell, selfAttributes, selfReference, pairedAttributes, pairedReference, pairedContent) => {
    const attributes = selfAttributes ?? pairedAttributes;
    const reference = selfReference ?? pairedReference;
    const content = pairedContent;
    const update = byReference.get(reference);
    if (!update) return cell;
    const type = cacheValueType(update.value);
    // The result type is authoritative. The legacy numeric flag remains for
    // callers that explicitly mark numeric values, but it must never coerce a
    // string, boolean, or error into a numeric OOXML cache.
    const nextAttributes = type === "number" || (type === "empty" && update.numeric === true)
      ? attributes.replace(/\s+t=["'][^"']*["']/g, "")
      : type === "error"
        ? `${attributes.replace(/\s+t=["'][^"']*["']/g, "")} t="e"`
        : type === "boolean"
          ? `${attributes.replace(/\s+t=["'][^"']*["']/g, "")} t="b"`
          : type === "string"
            ? `${attributes.replace(/\s+t=["'][^"']*["']/g, "")} t="str"`
            : attributes;
    const cache = type === "error"
      ? (update.value as FormulaCacheError).code
      : type === "boolean"
        ? (update.value ? "1" : "0")
        : update.value;
    const cached = `<v>${escapeXml(cache === null ? "" : String(cache))}</v>`;
    const cachePattern = /<v\b[^>]*(?:\/>|>[\s\S]*?<\/v\s*>)/;
    const existingContent = content ?? "";
    const nextContent = cachePattern.test(existingContent) ? existingContent.replace(cachePattern, cached) : `${existingContent}${cached}`;
    return `<c${nextAttributes}>${nextContent}</c>`;
  });
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
  let formulaCount = 0;
  let customFormulaCount = 0;
  for (const [path, data] of Object.entries(entries)) {
    if (!/^xl\/worksheets\/.*\.xml$/.test(path)) continue;
    const xml = strFromU8(data);
    formulaCount += xml.match(/<f\b/g)?.length ?? 0;
    customFormulaCount += xml.match(/<(?:f|definedName)\b[^>]*>(?:[^<]*)(?:勤務時間|残業時間|COUNTIF2|代休取得時間|遅刻早退時間)/g)?.length ?? 0;
  }
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
    this.entries[path] = strToU8(updateWorksheetCellXml(xml, cell, value, typeof value === "number" || typeof value === "boolean"));
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
