import type { AttendanceExportFormat } from "@timesheet/shared";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { inspectWorkbook, validateWorkbookIntegrity } from "../excel/workbook";

type Cell = string | number | null | undefined;
type Sheet = { name: string; headers: string[]; rows: Cell[][] };
const asCell = (value: unknown): Cell => value === null || value === undefined || typeof value === "string" || typeof value === "number" ? value : String(value);

const labels: Record<AttendanceExportFormat, string> = {
  aaaa_sp: "【AAAA】作業実績表（SP派遣用）",
  abcs_regular: "ABCS正社員（普通）勤務表",
  leave_request: "休暇・遅刻・早退申請書",
  sp_report: "作業報告書・作業実績報告書（SP用）",
};

function escapeXml(value: Cell) {
  return String(value ?? "").replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" })[character] ?? character);
}

function row(values: Cell[]) {
  return `<Row>${values.map((value) => `<Cell><Data ss:Type="${typeof value === "number" ? "Number" : "String"}">${escapeXml(value)}</Data></Cell>`).join("")}</Row>`;
}

function sheetXml(sheet: Sheet) {
  return `<Worksheet ss:Name="${escapeXml(sheet.name)}"><Table>${row(sheet.headers)}${sheet.rows.map(row).join("")}</Table></Worksheet>`;
}

export function createAttendanceWorkbook(input: {
  format: AttendanceExportFormat;
  month: string;
  generatedAt: string;
  profile: Record<string, unknown>;
  entries: Array<Record<string, unknown>>;
  leaveRequests: Array<Record<string, unknown>>;
  expenses: Array<Record<string, unknown>>;
  report: Record<string, unknown> | null;
}) {
  const common: Array<[string, unknown]> = [
    ["出力形式", labels[input.format]],
    ["対象年月", input.month],
    ["提出日", input.generatedAt.slice(0, 10)],
    ["社員コード", input.profile.employee_code],
    ["氏名", input.profile.display_name],
    ["氏名カナ", input.profile.name_kana],
    ["会社名", input.profile.company_name],
    ["所属事業部名", input.profile.division_name],
    ["所属部署名", input.profile.department_name],
    ["案件名", input.profile.project_name],
    ["顧客名", input.profile.client_name],
  ];
  const commonRows: Cell[][] = common.map(([key, value]) => [key, asCell(value)]);
  const sheets: Sheet[] = [];
  const workRows: Cell[][] = input.entries.map((entry) => [entry.work_date, entry.start_time, entry.end_time, entry.break_minutes, entry.project_name, entry.note].map(asCell));
  const leaveRows: Cell[][] = input.leaveRequests.map((request) => [request.start_date, request.end_date, request.leave_type, request.reason, request.status].map(asCell));
  const expenseRows: Cell[][] = input.expenses.map((expense) => [expense.expense_date, expense.category, expense.amount, expense.description].map(asCell));
  const reportRows: Cell[][] = input.report ? [[input.report.summary, input.report.achievements, input.report.next_steps].map(asCell)] : [];

  if (input.format === "aaaa_sp") sheets.push({ name: "作業実績", headers: ["日付", "開始", "終了", "休憩(分)", "プロジェクト", "備考"], rows: workRows });
  if (input.format === "abcs_regular") {
    sheets.push({ name: "勤務表", headers: ["日付", "開始", "終了", "休憩(分)", "プロジェクト", "備考"], rows: workRows });
    sheets.push({ name: "休暇・遅刻・早退", headers: ["開始日", "終了日", "種別", "理由", "状態"], rows: leaveRows });
    sheets.push({ name: "経費精算", headers: ["日付", "区分", "金額", "内容"], rows: expenseRows });
  }
  if (input.format === "leave_request") sheets.push({ name: "休暇申請", headers: ["開始日", "終了日", "種別", "理由", "状態"], rows: leaveRows });
  if (input.format === "sp_report") {
    sheets.push({ name: "作業実績", headers: ["日付", "開始", "終了", "休憩(分)", "プロジェクト", "備考"], rows: workRows });
    sheets.push({ name: "月次報告", headers: ["概要", "実績", "次月予定"], rows: reportRows });
  }

  const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Aptos" ss:Size="10" /></Style></Styles><Worksheet ss:Name="共通項目"><Table>${commonRows.map(([key, value]) => row([key, value])).join("")}</Table></Worksheet>${sheets.map(sheetXml).join("")}</Workbook>`;
  return new TextEncoder().encode(workbook);
}

type TemplateInput = Parameters<typeof createAttendanceWorkbook>[0] & { displayName: string };

function excelSerial(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Math.floor((date.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
}

function safeFilePart(value: string) {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "未設定";
}

export function attendanceFilename(format: AttendanceExportFormat, targetMonth: string, displayName: string, templateName?: string) {
  const [year, month] = targetMonth.split("-").map(Number);
  const person = safeFilePart(displayName);
  const extension = templateName?.toLowerCase().endsWith(".xlsm") ? "xlsm" : "xlsx";
  if (format === "aaaa_sp") return `【北國銀行次期コア】作業実績表（SP派遣用）${month}月_(${person}).${extension}`;
  if (format === "abcs_regular") return `ABCS正社員（普通）勤務表${month}月(${person}).${extension}`;
  if (format === "leave_request") {
    const fiscalStart = month >= 4 ? year : year - 1;
    return `休暇・遅刻・早退申請書(${fiscalStart}0401-${fiscalStart + 1}0331)_${person}.${extension}`;
  }
  return `作業報告書・作業実績報告書(SP用)Ver2.2_${person}.${extension}`;
}

function patchCells(xml: string, values: Array<[string, unknown, boolean?]>) {
  const cellContent = (value: unknown, numeric?: boolean) => numeric
    ? `<v>${escapeXml(value as Cell)}</v>`
    : `<is><t xml:space="preserve">${escapeXml(value as Cell)}</t></is>`;
  const updates = new Map(values.map(([reference, value, numeric]) => [reference, { value, numeric }]));
  const found = new Set<string>();
  const replaceCell = (attributes: string, numeric: boolean | undefined, value: unknown) => {
    const withoutType = attributes.replace(/\s+t=["'][^"']*["']/g, "");
    return `<c${numeric ? withoutType : `${withoutType} t="inlineStr"`}>${cellContent(value, numeric)}</c>`;
  };
  // Keep the self-closing branch first and make the attribute capture lazy so
  // `/>` is consumed as a complete tag rather than as an opening `>`.
  xml = xml.replace(/<c\b([^>]*?\br=["']([^"']+)["'][^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (cell, attributes, reference) => {
    const update = updates.get(reference);
    if (!update) return cell;
    found.add(reference);
    return replaceCell(attributes, update.numeric, update.value);
  });

  const missingByRow = new Map<string, string[]>();
  for (const [reference, update] of updates) {
    if (found.has(reference)) continue;
    const rowNumber = reference.match(/\d+$/)?.[0];
    if (!rowNumber) continue;
    const cell = `<c r="${reference}"${update.numeric ? "" : " t=\"inlineStr\""}>${cellContent(update.value, update.numeric)}</c>`;
    missingByRow.set(rowNumber, [...(missingByRow.get(rowNumber) ?? []), cell]);
  }
  if (missingByRow.size === 0) return xml;
  return xml.replace(/<row\b([^>]*\br=["'](\d+)["'][^>]*)>([\s\S]*?)<\/row>/g, (row, attributes, rowNumber, content) => {
    const missing = missingByRow.get(rowNumber);
    return missing ? `<row${attributes}>${content}${missing.join("")}</row>` : row;
  });
}

/**
 * Reproduces the input-sheet reset performed by the ABCS workbook's
 * initialization macro.  Only cell contents are removed; cell styles,
 * merged ranges, validation, row layout and formulas outside the macro's
 * input ranges remain untouched.
 */
function clearCells(xml: string, references: string[]) {
  const targets = new Set(references);
  const clearCell = (cell: string, attributes: string, reference: string, content?: string) => {
    if (!targets.has(reference)) return cell;
    const withoutType = attributes.replace(/\s+t=["'][^"']*["']/g, "");
    if (content === undefined) return `<c${withoutType}/>`;
    // Initialization clears user-entered constants, but never removes a
    // template formula or its cached display value. Excel will recalculate it
    // on open; retaining the cache prevents the sheet from appearing blank.
    const preservedFormula = content.match(/<f\b[^>]*(?:\/>|>[\s\S]*?<\/f\s*>)/)?.[0] ?? "";
    const preservedCache = preservedFormula ? content.match(/<v\b[^>]*>[\s\S]*?<\/v\s*>/)?.[0] ?? "" : "";
    return `<c${withoutType}>${preservedFormula}${preservedCache}</c>`;
  };
  xml = xml.replace(/<c\b([^>]*\br=["']([^"']+)["'][^>]*?)(?<!\/)>([\s\S]*?)<\/c>/g, clearCell);
  return xml.replace(/<c\b([^>]*\br=["']([^"']+)["'][^>]*)\/>/g, (cell, attributes, reference) => clearCell(cell, attributes, reference));
}

function expandCellRange(startColumn: number, endColumn: number, startRow: number, endRow: number) {
  const references: string[] = [];
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) references.push(`${excelColumn(column)}${row}`);
  }
  return references;
}

function initializeAbcsInputSheet(xml: string) {
  // Match the VBA initialization ranges. D11:AH11 and D15:AH25 are not
  // input-clear ranges and must remain intact.
  return clearCells(xml, [
    ...expandCellRange(4, 34, 9, 10),
    ...expandCellRange(4, 34, 12, 14),
    ...expandCellRange(4, 34, 26, 55),
  ]);
}

function worksheetPath(entries: Record<string, Uint8Array>, names: string[]) {
  const workbook = strFromU8(entries["xl/workbook.xml"] ?? new Uint8Array());
  const relationships = strFromU8(entries["xl/_rels/workbook.xml.rels"] ?? new Uint8Array());
  const targets = new Map<string, string>();
  for (const match of relationships.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?>(?:<\/Relationship>)?/g)) {
    const target = match[2].replace(/^\/+/, "").replace(/^\.\.\//, "xl/");
    targets.set(match[1], target.startsWith("xl/") ? target : `xl/${target}`);
  }
  for (const name of names) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sheet = workbook.match(new RegExp(`<sheet\\b[^>]*\\bname="${escapedName}"[^>]*\\br:id="([^"]+)"`));
    const path = sheet ? targets.get(sheet[1]) : undefined;
    if (path && entries[path]) return path;
  }
  return null;
}

function setWorksheetVisibility(entries: Record<string, Uint8Array>, names: string[], hidden: boolean) {
  const source = entries["xl/workbook.xml"];
  if (!source) throw new Error("テンプレートにworkbook.xmlがありません");
  let workbook = strFromU8(source);
  const targets = new Set(names);
  workbook = workbook.replace(/<sheet\b([^>]*\bname="([^"]+)"[^>]*)\/>/g, (sheet, attributes, name) => {
    if (!targets.has(name)) return sheet;
    const withoutState = attributes.replace(/\s+state="[^"]*"/g, "");
    return `<sheet${hidden ? `${withoutState} state="hidden"` : withoutState}/>`;
  });
  entries["xl/workbook.xml"] = strToU8(workbook);
}

function isMeaningfulReportValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function hasMonthlyReportInput(report: Record<string, unknown> | null | undefined) {
  return [report?.summary, report?.achievements, report?.next_steps, report?.overtime_comment].some(isMeaningfulReportValue);
}

function timeNumberFromMinutes(value: unknown) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) return 0;
  return Math.floor(minutes / 60) * 100 + (minutes % 60);
}

function refreshSpDateFormulaCaches(xml: string, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return xml;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  for (let day = 1; day <= 31; day += 1) {
    const row = 11 + day;
    const date = day <= daysInMonth ? new Date(Date.UTC(year, monthNumber - 1, day)) : null;
    xml = patchTypedFormulaCache(xml, `A${row}`, date ? excelSerial(`${month}-${String(day).padStart(2, "0")}`) : "", date ? "number" : "string");
    xml = patchTypedFormulaCache(xml, `B${row}`, date ? weekdays[date.getUTCDay()] : "", "string");
  }
  return xml;
}

function clearSpReportInput(xml: string) {
  return clearCells(xml, [
    ...expandCellRange(3, 5, 12, 42),
    ...expandCellRange(7, 8, 12, 42),
  ]);
}

function applySpReportVisibility(entries: Record<string, Uint8Array>, input: TemplateInput) {
  setWorksheetVisibility(entries, ["作業報告書 (サンプル)", "立替金明細書 (サンプル)"], true);
  setWorksheetVisibility(entries, ["作業報告書"], !hasMonthlyReportInput(input.report));
  const hasExpenses = input.expenses.length > 0;
  setWorksheetVisibility(entries, ["立替金明細書", "立替金明細書(No2)", "立替金明細書(No3)", "領収書添付用紙"], !hasExpenses);
}

function expenseRowCapacity(path: string) {
  return path.endsWith("sheet4.xml") ? { firstRow: 11, lastRow: 44 } : { firstRow: 7, lastRow: 50 };
}

function clearExpenseInputs(xml: string, firstRow: number, lastRow: number) {
  const references: string[] = [];
  for (let row = firstRow; row <= lastRow; row += 2) {
    // Clear every detail field so sample values cannot leak into a real export.
    // clearCells retains formula bodies and their existing cache by design.
    for (let column = 1; column <= 38; column += 1) references.push(`${excelColumn(column)}${row}`);
  }
  return clearCells(xml, references);
}

function applySpExpenseInputs(entries: Record<string, Uint8Array>, input: TemplateInput, changedPaths: Set<string>) {
  const pageNames = ["立替金明細書", "立替金明細書(No2)", "立替金明細書(No3)"];
  const pages = pageNames.map((name) => ({ name, path: worksheetPath(entries, [name]) })).filter((page): page is { name: string; path: string } => Boolean(page.path));
  const pageCapacity = pages.reduce((total, page) => {
    const { firstRow, lastRow } = expenseRowCapacity(page.path);
    return total + Math.floor((lastRow - firstRow) / 2) + 1;
  }, 0);
  if (input.expenses.length > pageCapacity) throw new Error(`経費明細がテンプレートの収容件数(${pageCapacity}件)を超えています`);

  let expenseIndex = 0;
  for (const page of pages) {
    const { firstRow, lastRow } = expenseRowCapacity(page.path);
    let xml = clearExpenseInputs(strFromU8(entries[page.path]), firstRow, lastRow);
    for (let row = firstRow; row <= lastRow && expenseIndex < input.expenses.length; row += 2, expenseIndex += 1) {
      const expense = input.expenses[expenseIndex];
      const values: Array<[string, unknown, boolean?]> = [];
      if (expense.expense_date) values.push([`A${row}`, excelSerial(String(expense.expense_date)), true]);
      if (expense.category) values.push([`C${row}`, expense.category]);
      if (expense.description) values.push([`G${row}`, expense.description]);
      if (expense.amount !== null && expense.amount !== undefined && expense.amount !== "") {
        // The current model stores a total amount, while the template calculates
        // amount as unit price × count. Represent the total as one unit.
        values.push([`X${row}`, Number(expense.amount), true], [`AA${row}`, 1, true]);
      }
      if (values.length) xml = patchCells(xml, values);
    }
    entries[page.path] = strToU8(xml);
    changedPaths.add(page.path);
  }

  for (let index = 0; index < pages.length; index += 1) {
    setWorksheetVisibility(entries, [pages[index].name], input.expenses.length === 0 || input.expenses.length <= pages.slice(0, index).reduce((total, page) => {
      const { firstRow, lastRow } = expenseRowCapacity(page.path);
      return total + Math.floor((lastRow - firstRow) / 2) + 1;
    }, 0));
  }
}

function requestFormulaRecalculation(entries: Record<string, Uint8Array>) {
  const source = entries["xl/workbook.xml"];
  if (!source) return;
  let workbook = strFromU8(source);
  const attributes = ` calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"`;
  const calcPattern = /<calcPr\b([^>]*)\s*\/>|<calcPr\b([^>]*)>[\s\S]*?<\/calcPr\s*>/;
  if (calcPattern.test(workbook)) {
    workbook = workbook.replace(calcPattern, `<calcPr${attributes}/>`);
  } else {
    workbook = workbook.replace(/<\/workbook>/, `<calcPr${attributes}/></workbook>`);
  }
  entries["xl/workbook.xml"] = strToU8(workbook);
  removeCalcChainParts(entries);
}

function removeCalcChainParts(entries: Record<string, Uint8Array>) {
  delete entries["xl/calcChain.xml"];
  const relationshipsPath = "xl/_rels/workbook.xml.rels";
  const relationships = entries[relationshipsPath];
  if (relationships) {
    entries[relationshipsPath] = strToU8(strFromU8(relationships).replace(
      /<Relationship\b(?=[^>]*\bType=["']http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/calcChain["'])[^>]*(?:\/>|><\/Relationship\s*>)/g,
      "",
    ));
  }
  const contentTypesPath = "[Content_Types].xml";
  const contentTypes = entries[contentTypesPath];
  if (contentTypes) {
    entries[contentTypesPath] = strToU8(strFromU8(contentTypes).replace(
      /<Override\b(?=[^>]*\bPartName=["']\/xl\/calcChain\.xml["'])[^>]*(?:\/>|><\/Override\s*>)/g,
      "",
    ));
  }
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function worksheetValues(xml: string) {
  const values = new Map<string, { value: string; numeric: boolean }>();
  for (const match of xml.matchAll(/<c\b([^>]*?\br=["']([^"']+)["'][^>]*?)\/>|<c\b([^>]*?\br=["']([^"']+)["'][^>]*?)>([\s\S]*?)<\/c\s*>/g)) {
    const attributes = match[1] ?? match[3];
    const reference = match[2] ?? match[4];
    const content = match[5] ?? "";
    if (/<f\b/.test(content)) {
      const cached = content.match(/<v\b[^>]*>([\s\S]*?)<\/v\s*>/)?.[1];
      if (cached !== undefined) values.set(reference, { value: decodeXml(cached), numeric: !/\bt=["'](?:str|inlineStr|s)["']/.test(attributes) });
      continue;
    }
    const inline = content.match(/<t\b[^>]*>([\s\S]*?)<\/t\s*>/)?.[1];
    const numeric = content.match(/<v\b[^>]*>([\s\S]*?)<\/v\s*>/)?.[1];
    if (inline !== undefined) values.set(reference, { value: decodeXml(inline), numeric: false });
    else if (numeric !== undefined) values.set(reference, { value: decodeXml(numeric), numeric: !/\bt=["'](?:str|inlineStr|s)["']/.test(attributes) });
  }
  return values;
}

function clearFormulaCaches(xml: string, shouldClear: (reference: string, formula: string) => boolean) {
  return xml.replace(/<c\b([^>]*\br=["']([^"']+)["'][^>]*?)>([\s\S]*?)<\/c>/g, (cell, attributes, reference, content) => {
    const formula = content.match(/<f\b[^>]*(?:\/>|>([\s\S]*?)<\/f\s*>)/);
    if (!formula || !shouldClear(reference, formula[1] ?? "")) return cell;
    const cachePattern = /<v\b[^>]*(?:\/>|>[\s\S]*?<\/v\s*>)/;
    const nextContent = cachePattern.test(content) ? content.replace(cachePattern, "<v/>") : `${content}<v/>`;
    return `<c${attributes}>${nextContent}</c>`;
  });
}

/**
 * Refresh the cached result for the simple cross-sheet formulas used by the
 * submission sheet. Excel/VBA itself cannot run in Workers, so custom VBA
 * functions remain delegated to Excel; however, direct references must still
 * show the values entered through the web UI before the workbook is opened.
 */
function refreshSubmissionReferenceCaches(xml: string, inputXml: string) {
  const sourceValues = worksheetValues(inputXml);
  // Do not match self-closing cells. Empty cells are common in the submission
  // sheet; consuming the following cells here produces malformed worksheet XML.
  return xml.replace(/<c\b([^>]*\br=["']([^"']+)["'][^>]*?)(?<!\/)>([\s\S]*?)<\/c>/g, (cell, attributes, _reference, content) => {
    const formula = content.match(/<f\b[^>]*>([\s\S]*?)<\/f\s*>/)?.[1];
    if (!formula) return cell;
    const normalized = decodeXml(formula).trim();
    const source = normalized.match(/'?勤務表（入力用）'?!\$?([A-Z]+)\$?(\d+)/i);
    if (!source) return cell;
    const sourceReference = `${source[1]}${source[2]}`;
    const value = sourceValues.get(sourceReference) ?? { value: "", numeric: false };
    const numericValue = Number(value.value);
    let result = value.value;
    if (/IF\([^,]+(?:<>0|=0|="")\s*,\s*""/i.test(normalized)) result = value.value === "" || /(?:<>0|=0)/i.test(normalized) && numericValue === 0 ? "" : value.value;
    else if (/IF\([^,]+=0\s*,\s*0\s*,/i.test(normalized)) result = value.value === "" || numericValue === 0 ? "0" : value.value;
    if (/TEXT\([^,]+,\s*"\[h\]:mm"\s*\)/i.test(normalized) && Number.isFinite(numericValue)) { const minutes = Math.round(numericValue * 1440); result = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`; }
    const resultIsString = result === "" || /TEXT\(/i.test(normalized) || !value.numeric;
    const withoutType = attributes.replace(/\s+t=["'][^"']*["']/g, "");
    const nextAttributes = resultIsString ? `${withoutType} t="str"` : withoutType;
    const cached = `<v>${escapeXml(result)}</v>`;
    const cachePattern = /<v\b[^>]*(?:\/>|>[\s\S]*?<\/v\s*>)/;
    if (cachePattern.test(content)) return `<c${nextAttributes}>${content.replace(cachePattern, cached)}</c>`;
    return `<c${nextAttributes}>${content}</c>`.replace(/<\/c>$/, `${cached}</c>`);
  });
}

function patchFormulaCache(xml: string, reference: string, value: unknown) {
  return xml.replace(new RegExp(`<c\\b([^>]*\\br="${reference}"[^>]*)>([\\s\\S]*?)</c>`), (_cell, attributes, content) => {
    const cache = `<v>${escapeXml(asCell(value))}</v>`;
    const pattern = /<v\b[^>]*(?:\/>|>[\s\S]*?<\/v\s*>)/;
    return `<c${attributes}>${pattern.test(content) ? content.replace(pattern, cache) : `${content}${cache}`}</c>`;
  });
}

function patchTypedFormulaCache(xml: string, reference: string, value: unknown, type: "number" | "string") {
  return xml.replace(new RegExp(`<c\\b([^>]*\\br="${reference}"[^>]*)>([\\s\\S]*?)</c>`), (_cell, attributes, content) => {
    const withoutType = attributes.replace(/\s+t=["'][^"']*["']/g, "");
    const nextAttributes = type === "string" ? `${withoutType} t="str"` : withoutType;
    const cache = `<v>${escapeXml(type === "string" ? String(value ?? "") : asCell(value))}</v>`;
    const pattern = /<v\b[^>]*(?:\/>|>[\s\S]*?<\/v\s*>)/;
    const nextContent = pattern.test(content) ? content.replace(pattern, cache) : `${content}${cache}`;
    return `<c${nextAttributes}>${nextContent}</c>`;
  });
}

/**
 * The company-submission sheet is a presentation sheet.  Some source
 * templates contain a strikethrough font in a style that is also shared by
 * the input sheet.  Changing that shared font would alter the input sheet,
 * so clone only the affected cell styles and remove strikethrough from the
 * clones used by the submission sheet.
 */
function removeSubmissionStrikethrough(entries: Record<string, Uint8Array>, submissionXml: string) {
  const stylesPath = "xl/styles.xml";
  const stylesSource = entries[stylesPath];
  if (!stylesSource) return { xml: submissionXml, changed: false };
  let styles = strFromU8(stylesSource);
  const cellXfsMatch = styles.match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs\s*>/);
  const fontsMatch = styles.match(/<fonts\b([^>]*)>([\s\S]*?)<\/fonts\s*>/);
  if (!cellXfsMatch || !fontsMatch) return { xml: submissionXml, changed: false };

  const styleIds = new Set<number>();
  for (const match of submissionXml.matchAll(/<c\b[^>]*\bs="(\d+)"[^>]*>/g)) styleIds.add(Number(match[1]));
  if (!styleIds.size) return { xml: submissionXml, changed: false };

  const xfTags = [...cellXfsMatch[2].matchAll(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf\s*>)/g)].map((match) => match[0]);
  const fontTags = [...fontsMatch[2].matchAll(/<font\b[\s\S]*?(?:<\/font\s*>)/g)].map((match) => match[0]);
  const struckFontIds = new Set<number>();
  const stylesToClone = new Map<number, { xf: string; fontId: number }>();
  for (const styleId of styleIds) {
    const xf = xfTags[styleId];
    if (!xf) continue;
    const fontId = Number(xf.match(/\bfontId="(\d+)"/)?.[1]);
    const font = fontTags[fontId];
    if (!font || !/<strike\b/i.test(font) || /<strike\b[^>]*\bval="0"/i.test(font)) continue;
    struckFontIds.add(fontId);
    stylesToClone.set(styleId, { xf, fontId });
  }
  if (!stylesToClone.size) return { xml: submissionXml, changed: false };

  const fontCloneIds = new Map<number, number>();
  let nextFontId = fontTags.length;
  let nextStyleId = xfTags.length;
  let fontBody = fontsMatch[2];
  for (const fontId of struckFontIds) {
    const font = fontTags[fontId];
    if (!font) continue;
    fontCloneIds.set(fontId, nextFontId++);
    fontBody += font.replace(/<strike\b[^>]*\/\s*>/gi, "").replace(/<strike\b[^>]*>[\s\S]*?<\/strike\s*>/gi, "");
  }
  const styleCloneIds = new Map<number, number>();
  let xfBody = cellXfsMatch[2];
  for (const [styleId, descriptor] of stylesToClone) {
    const cloneId = nextStyleId++;
    styleCloneIds.set(styleId, cloneId);
    const clonedXf = descriptor.xf.replace(/\bfontId="\d+"/, `fontId="${fontCloneIds.get(descriptor.fontId)}"`);
    xfBody += clonedXf;
  }
  styles = styles.replace(fontsMatch[0], `<fonts${fontsMatch[1].replace(/\bcount="\d+"/, `count="${nextFontId}"`)}>${fontBody}</fonts>`);
  styles = styles.replace(cellXfsMatch[0], `<cellXfs${cellXfsMatch[1].replace(/\bcount="\d+"/, `count="${nextStyleId}"`)}>${xfBody}</cellXfs>`);
  entries[stylesPath] = strToU8(styles);

  const rewrittenXml = submissionXml.replace(/(<c\b[^>]*\bs=")(\d+)("[^>]*>)/g, (cell, prefix, styleIdText, suffix) => {
    const cloneId = styleCloneIds.get(Number(styleIdText));
    return cloneId === undefined ? cell : `${prefix}${cloneId}${suffix}`;
  });
  return { xml: rewrittenXml, changed: true };
}

function applyAbcsCalendarResults(xml: string, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return xml;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  for (let day = 1; day <= 31; day += 1) {
    const column = excelColumn(3 + day);
    const value = day <= daysInMonth ? excelSerial(`${month}-${String(day).padStart(2, "0")}`) : "";
    xml = patchTypedFormulaCache(xml, `${column}7`, value, value === "" ? "string" : "number");
    xml = patchTypedFormulaCache(xml, `${column}8`, value, value === "" ? "string" : "number");
  }
  return xml;
}

function applySubmissionDailyReferenceCaches(xml: string, inputXml: string) {
  const sourceValues = worksheetValues(inputXml);
  const sourceRows: Record<string, number> = { A: 7, B: 8, C: 9, D: 10, E: 12, F: 13, G: 14, H: 18, I: 19, J: 20, K: 22, L: 23 };
  const formulaForCell = (reference: string) => xml.match(new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>([\\s\\S]*?)</c\\s*>`))?.[1]?.match(/<f\b[^>]*(?:>|\/>)((?:[\s\S]*?))<\/f\s*>/)?.[1] ?? "";
  const returnsBlankForZero = (formula: string) => /\bIF\s*\([^,]*(?:=|<>)\s*0\s*,\s*""\s*,/i.test(formula);
  for (let day = 1; day <= 31; day += 1) {
    const inputColumn = excelColumn(3 + day);
    const submissionRow = 15 + day;
    for (const [submissionColumn, sourceRow] of Object.entries(sourceRows)) {
      const reference = `${submissionColumn}${submissionRow}`;
      const source = sourceValues.get(`${inputColumn}${sourceRow}`);
      const sourceValue = source?.numeric && source?.value !== "" && Number.isFinite(Number(source?.value)) ? Number(source.value) : (source?.value ?? "");
      const value = typeof sourceValue === "number" && sourceValue === 0 && returnsBlankForZero(formulaForCell(reference)) ? "" : sourceValue;
      const type = typeof value === "number" ? "number" : "string";
      xml = patchTypedFormulaCache(xml, reference, value, type);
    }
  }
  return xml;
}

function minutesAsHundredHours(value: unknown) {
  const minutes = Number(value ?? 0);
  if (!Number.isFinite(minutes) || minutes < 0) return 0;
  return Math.floor(minutes / 60) * 100 + (minutes % 60);
}

function refreshSpWorkFormulaCaches(xml: string, entries: Array<Record<string, unknown>>) {
  const byDay = new Map<number, Record<string, unknown>>();
  for (const entry of entries) {
    const day = Number(String(entry.work_date ?? "").slice(-2));
    if (Number.isInteger(day) && day >= 1 && day <= 31) byDay.set(day, entry);
  }
  for (let day = 1; day <= 31; day += 1) {
    const row = 11 + day;
    const entry = byDay.get(day);
    const start = entry?.start_time ? timeNumber(entry.start_time) : 0;
    const end = entry?.end_time ? timeNumber(entry.end_time) : 0;
    const breakValue = entry?.break_minutes === null || entry?.break_minutes === undefined || entry?.break_minutes === ""
      ? 0
      : timeNumberFromMinutes(entry.break_minutes);
    const startMinutes = Math.floor(start / 100) * 60 + start % 100;
    const endMinutes = Math.floor(end / 100) * 60 + end % 100;
    const elapsed = endMinutes - startMinutes;
    const breakMinutes = Math.floor(breakValue / 100) * 60 + breakValue % 100;
    const netMinutes = entry?.start_time ? (elapsed > 0 ? elapsed - breakMinutes : elapsed + 1440 - breakMinutes) : 0;
    const workValue = Math.floor(netMinutes / 60) * 100 + (netMinutes % 60);
    const displayedBreak = Math.floor(breakValue / 60) * 100 + (breakValue % 60);
    for (const [reference, value] of Object.entries({
      [`F${row}`]: workValue,
      [`J${row}`]: entry?.start_time ? elapsed : 0,
      [`K${row}`]: netMinutes,
      [`L${row}`]: displayedBreak,
    })) {
      if (new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>[\\s\\S]*?<f\\b`).test(xml)) {
        xml = patchTypedFormulaCache(xml, reference, value, "number");
      }
    }
  }
  const totalNetMinutes = [...byDay.values()].reduce((sum, entry) => {
    const start = entry.start_time ? timeNumber(entry.start_time) : 0;
    const end = entry.end_time ? timeNumber(entry.end_time) : 0;
    if (!entry.start_time) return sum;
    const startMinutes = Math.floor(start / 100) * 60 + start % 100;
    const endMinutes = Math.floor(end / 100) * 60 + end % 100;
    const elapsed = endMinutes - startMinutes;
    const breakValue = entry.break_minutes === null || entry.break_minutes === undefined || entry.break_minutes === ""
      ? 0
      : timeNumberFromMinutes(entry.break_minutes);
    const breakMinutes = Math.floor(breakValue / 100) * 60 + breakValue % 100;
    return sum + (elapsed > 0 ? elapsed : elapsed + 1440) - breakMinutes;
  }, 0);
  const totalWorkValue = Math.floor(totalNetMinutes / 60) * 100 + (totalNetMinutes % 60);
  for (const [reference, value] of [["K43", totalNetMinutes], ["F43", totalWorkValue]] as const) {
    if (new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>[\\s\\S]*?<f\\b`).test(xml)) {
      xml = patchTypedFormulaCache(xml, reference, value, "number");
    }
  }
  return xml;
}

function refreshSpExpenseFormulaCaches(entries: Record<string, Uint8Array>, input: TemplateInput) {
  const pageNames = ["立替金明細書", "立替金明細書(No2)", "立替金明細書(No3)"];
  const pages = pageNames.map((name) => ({ name, path: worksheetPath(entries, [name]) })).filter((page): page is { name: string; path: string } => Boolean(page.path));
  let expenseIndex = 0;
  const pageTotals: number[] = [];
  for (const page of pages) {
    const { firstRow, lastRow } = expenseRowCapacity(page.path);
    let xml = strFromU8(entries[page.path]);
    let total = 0;
    for (let row = firstRow; row <= lastRow; row += 2, expenseIndex += 1) {
      const expense = input.expenses[expenseIndex];
      const amount = expense && expense.amount !== null && expense.amount !== undefined && expense.amount !== "" ? Number(expense.amount) : 0;
      const numericAmount = Number.isFinite(amount) ? amount : 0;
      if (expense) total += numericAmount;
      const amountReference = `AB${row}`;
      const reimbursedReference = `AE${row}`;
      if (new RegExp(`<c\\b[^>]*\\br="${amountReference}"[^>]*>[\\s\\S]*?<f\\b`).test(xml)) xml = patchTypedFormulaCache(xml, amountReference, numericAmount, "number");
      if (new RegExp(`<c\\b[^>]*\\br="${reimbursedReference}"[^>]*>[\\s\\S]*?<f\\b`).test(xml)) xml = patchTypedFormulaCache(xml, reimbursedReference, "", "string");
    }
    const totalRow = page.path.endsWith("sheet4.xml") ? 45 : 51;
    for (const [reference, value] of [[`AB${totalRow}`, total], [`AE${totalRow}`, 0]] as const) {
      if (new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>[\\s\\S]*?<f\\b`).test(xml)) xml = patchTypedFormulaCache(xml, reference, value, "number");
    }
    entries[page.path] = strToU8(xml);
    pageTotals.push(total);
  }
  const firstPage = pages[0];
  if (firstPage) {
    let xml = strFromU8(entries[firstPage.path]);
    const total = pageTotals.reduce((sum, value) => sum + value, 0);
    for (const [reference, value] of [["AB46", total], ["AE46", 0], ["AB47", total]] as const) {
      if (new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>[\\s\\S]*?<f\\b`).test(xml)) xml = patchTypedFormulaCache(xml, reference, value, "number");
    }
    entries[firstPage.path] = strToU8(xml);
  }
}

function clockMinutes(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function calculatedAbcsRows(entries: Array<Record<string, unknown>>) {
  const byDay = new Map<number, { worked: number; ordinary: number; holiday: number; night: number; total: number; substitute: number; late: number }>();
  for (const entry of entries) {
    const day = Number(String(entry.work_date ?? "").slice(-2));
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const start = clockMinutes(entry.start_time); const end = clockMinutes(entry.end_time);
    const ordinaryBreak = Math.max(0, Number(entry.ordinary_break_minutes ?? entry.break_minutes ?? 0) || 0);
    const nightBreak = Math.max(0, Number(entry.night_break_minutes ?? 0) || 0);
    const span = start === null || end === null ? 0 : (end >= start ? end - start : end + 1440 - start);
    const worked = Math.max(0, span - ordinaryBreak - nightBreak) / 1440;
    const code = entryAbcsWorkCode(entry);
    const holiday = code === "*" || code === "H" || code === "Y";
    const ordinary = holiday ? 0 : Math.max(0, worked - 465 / 1440);
    const holidayValue = holiday ? worked : 0;
    byDay.set(day, { worked, ordinary, holiday: holidayValue, night: 0, total: ordinary + holidayValue, substitute: 0, late: 0 });
  }
  return byDay;
}

function defaultAbcsWorkCode(month: string, day: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || day < 1 || day > new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()) return "";
  const weekday = new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6 ? "*" : "";
}

function entryAbcsWorkCode(entry: Record<string, unknown>) {
  const explicit = typeof entry.work_code === "string" ? entry.work_code : "";
  if (explicit) return explicit;
  if (entry.start_time || entry.end_time) return "";
  const date = String(entry.work_date ?? "");
  return date.length >= 10 ? defaultAbcsWorkCode(date.slice(0, 7), Number(date.slice(-2))) : "";
}

function applyAbcsFormulaResults(xml: string, entries: Array<Record<string, unknown>>) {
  const byDay = new Map<number, { worked: number; ordinary: number; holiday: number; night: number; total: number; substitute: number; late: number }>();
  for (const entry of entries) {
    const day = Number(String(entry.work_date ?? "").slice(-2));
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const start = clockMinutes(entry.start_time); const end = clockMinutes(entry.end_time);
    const ordinaryBreak = Math.max(0, Number(entry.ordinary_break_minutes ?? entry.break_minutes ?? 0) || 0);
    const nightBreak = Math.max(0, Number(entry.night_break_minutes ?? 0) || 0);
    const span = start === null || end === null ? 0 : (end >= start ? end - start : end + 1440 - start);
    const worked = Math.max(0, span - ordinaryBreak - nightBreak) / 1440;
    const code = entryAbcsWorkCode(entry);
    const holiday = code === "*" || code === "H" || code === "Y";
    const ordinary = holiday ? 0 : Math.max(0, worked - 465 / 1440);
    const holidayValue = holiday ? worked : 0;
    byDay.set(day, { worked, ordinary, holiday: holidayValue, night: 0, total: ordinary + holidayValue, substitute: 0, late: 0 });
  }
  for (let day = 1; day <= 31; day += 1) {
    const column = excelColumn(3 + day); const result = byDay.get(day) ?? { worked: 0, ordinary: 0, holiday: 0, night: 0, total: 0, substitute: 0, late: 0 };
    for (const [row, value] of Object.entries({ 15: result.worked, 18: result.ordinary, 19: result.holiday, 20: result.night, 21: result.total, 22: result.substitute, 23: result.late })) {
      const reference = `${column}${row}`;
      if (new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>[\\s\\S]*?<f\\b`).test(xml)) xml = patchTypedFormulaCache(xml, reference, value, "number");
    }
    const reference = `${column}24`;
    if (new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>[\\s\\S]*?<f\\b`).test(xml)) {
      // 時間差(D15,D74): when no project-time detail exists, the difference is
      // the day's calculated work time.  The VBA function returns the ABCS
      // workbook's HHMM number (730, 1030, ...), not an Excel day fraction.
      // Empty days remain zero.
      const workedMinutes = Math.round(result.worked * 1440);
      xml = patchTypedFormulaCache(xml, reference, minutesAsHundredHours(workedMinutes), "number");
    }
  }
  // The workbook uses shared formulas for the monthly summary cells.  The
  // generic evaluator cannot reliably refresh shared-formula child caches,
  // so rebuild them from the now-current daily caches.  Keep the values as
  // Excel time serials; the template's number formats render them as hours.
  const dailyValues = worksheetValues(xml);
  for (let row = 17; row <= 23; row += 1) {
    const reference = `B${row}`;
    if (!new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>[\\s\\S]*?<f\\b`).test(xml)) continue;
    let sum = 0;
    for (let day = 1; day <= 31; day += 1) {
      const entry = dailyValues.get(`${excelColumn(3 + day)}${row}`);
      const value = entry?.numeric ? Number(entry.value) : NaN;
      if (Number.isFinite(value)) sum += value;
    }
    xml = patchTypedFormulaCache(xml, reference, sum, "number");
  }
  // Different ABCS template revisions place the total of the work-time row
  // in AI15 or AT15.  Refresh whichever formula cell exists, without adding
  // or changing any layout cells.
  let workTotal = 0;
  for (let day = 1; day <= 31; day += 1) {
    const entry = dailyValues.get(`${excelColumn(3 + day)}15`);
    const value = entry?.numeric ? Number(entry.value) : NaN;
    if (Number.isFinite(value)) workTotal += value;
  }
  for (const reference of ["AI15", "AT15"]) {
    if (new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>[\\s\\S]*?<f\\b`).test(xml)) {
      xml = patchTypedFormulaCache(xml, reference, workTotal, "number");
    }
  }
  return xml;
}

function applySubmissionFormulaResults(xml: string, inputXml: string, entries: Array<Record<string, unknown>>) {
  const byDay = calculatedAbcsRows(entries);
  const totals = [...byDay.values()].reduce((sum, value) => ({ ordinary: sum.ordinary + value.ordinary, holiday: sum.holiday + value.holiday, night: sum.night + value.night, total: sum.total + value.total, substitute: sum.substitute + value.substitute, late: sum.late + value.late }), { ordinary: 0, holiday: 0, night: 0, total: 0, substitute: 0, late: 0 });
  const sourceValues = worksheetValues(inputXml);
  const workedTotal = [...byDay.values()].reduce((sum, value) => sum + value.total, 0);
  const codeCount = (codes: string[]) => entries.filter((entry) => codes.includes(entryAbcsWorkCode(entry))).length;
  const monthlyHours = sourceValues.get("B23")?.value;
  const monthlyHoursNumber = Number(monthlyHours);
  const monthlyHoursText = Number.isFinite(monthlyHoursNumber)
    ? `${Math.floor(Math.round(monthlyHoursNumber * 1440) / 60)}:${String(Math.round(monthlyHoursNumber * 1440) % 60).padStart(2, "0")}`
    : monthlyHours ?? "";
  const values: Record<string, unknown> = {
    M48: totals.total === 0 ? (totals.substitute === 0 ? "" : "-") : (totals.substitute === 0 || totals.total >= totals.substitute ? "" : "-"),
    H48: totals.ordinary,
    I48: totals.holiday,
    J48: totals.night,
    K48: totals.substitute,
    L48: totals.late,
    N48: totals.total - totals.substitute,
    P48: Math.round((totals.total - totals.substitute) * 1440) % 60,
    Q48: workedTotal,
    D52: entries.filter((entry) => entry.end_time).length,
    E52: entries.filter((entry) => byDay.get(Number(String(entry.work_date ?? "").slice(-2)))?.holiday).length,
    F52: codeCount(["D"]) + codeCount(["DH"]) * 0.5,
    G52: codeCount(["Y"]) + codeCount(["H"]) * 0.5,
    H52: codeCount(["K"]) + codeCount(["KH"]) * 0.5,
    I52: codeCount(["T"]) + codeCount(["TH"]) * 0.5,
    J52: codeCount(["TN"]) + codeCount(["THN"]) * 0.5,
    K52: entries.filter((entry) => byDay.get(Number(String(entry.work_date ?? "").slice(-2)))?.late).length,
    L52: monthlyHoursText,
  };
  for (const [reference, value] of Object.entries(values)) {
    if (new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>[\\s\\S]*?<f\\b`).test(xml)) {
      xml = patchTypedFormulaCache(xml, reference, value, typeof value === "number" ? "number" : "string");
    }
  }
  return xml;
}

function finalizeWorkbookBeforeOutput(entries: Record<string, Uint8Array>, recalculateOnOpen = false) {
  // Preserve the calculated caches. Recalculating VBA UDFs on open while
  // macros are blocked would replace them with #NAME?; Excel users can still
  // recalculate manually when macros are enabled.
  const source = entries["xl/workbook.xml"];
  if (!source) return;
  let workbook = strFromU8(source);
  const attributes = recalculateOnOpen
    ? ` calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"`
    : ` calcMode="manual" fullCalcOnLoad="0" forceFullCalc="0"`;
  const pattern = /<calcPr\b([^>]*)\s*\/>|<calcPr\b([^>]*)>[\s\S]*?<\/calcPr\s*>/;
  workbook = pattern.test(workbook) ? workbook.replace(pattern, `<calcPr${attributes}/>` ) : workbook.replace(/<\/workbook>/, `<calcPr${attributes}/></workbook>`);
  entries["xl/workbook.xml"] = strToU8(workbook);
  removeCalcChainParts(entries);
}

function excelColumn(number: number) {
  let result = "";
  for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

function timeNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value) return 0;
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 100 + minutes : 0;
}

function minutesAsExcelTime(value: unknown) {
  const minutes = Number(value ?? 0);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes / 1440 : 0;
}


export function createAttendanceWorkbookFromTemplate(template: Uint8Array, input: TemplateInput) {
  const originalEntries = unzipSync(template);
  const entries = unzipSync(template);
  const originalInspection = inspectWorkbook(originalEntries);
  if (!originalInspection.sheets.length) throw new Error("テンプレートにワークシートがありません");
  const profile = input.profile;
  const name = input.displayName;
  const monthValue = excelSerial(`${input.month}-01`);
  const generatedValue = excelSerial(input.generatedAt.slice(0, 10));
  const employeeCode = profile.employee_code ?? "";
  const nameKana = profile.name_kana ?? name;
  const companyName = profile.company_name ?? "";
  const divisionName = profile.division_name ?? "";
  const departmentName = profile.department_name ?? "";
  const projectName = profile.project_name ?? "";
  const clientName = profile.client_name ?? "";

  const changedPaths = new Set<string>(["xl/workbook.xml", "xl/calcChain.xml", "xl/_rels/workbook.xml.rels", "[Content_Types].xml"]);
  if (input.format === "aaaa_sp") {
    const path = worksheetPath(entries, ["作業実績表(ABC用)"]);
    if (!path) throw new Error("テンプレートに作業実績表(ABC用)シートがありません");
    changedPaths.add(path);
    entries[path] = strToU8(patchCells(strFromU8(entries[path]), [["C3", monthValue, true], ["E6", companyName], ["E7", name], ["E8", projectName], ["E9", clientName]]));
  }
  if (input.format === "abcs_regular") {
    const path = worksheetPath(entries, ["勤務表（入力用）"]);
    if (!path) throw new Error("テンプレートに勤務表（入力用）シートがありません");
    changedPaths.add(path);
    // The macro requires the month and employee identity before it resets the
    // day-entry area.  Keep this order: identity -> macro-equivalent reset -> data.
    let xml = patchCells(strFromU8(entries[path]), [["A5", monthValue, true], ["B5", employeeCode], ["C5", nameKana], ["D5", name], ["K5", divisionName], ["P5", departmentName]]);
    xml = initializeAbcsInputSheet(xml);
    input.entries.forEach((entry) => {
      const day = Number(String(entry.work_date ?? "").slice(-2));
      if (!Number.isInteger(day) || day < 1 || day > 31) return;
      const column = excelColumn(3 + day);
      const workCode = entryAbcsWorkCode(entry);
      const ordinaryBreak = Number(entry.ordinary_break_minutes ?? 0) === 0 && Number(entry.night_break_minutes ?? 0) === 0 && Number(entry.break_minutes ?? 0) > 0 ? entry.break_minutes : entry.ordinary_break_minutes ?? 0;
      const nightBreak = entry.night_break_minutes ?? 0;
      xml = patchCells(xml, [[`${column}9`, workCode], [`${column}10`, timeNumber(entry.start_time), true], [`${column}12`, timeNumber(entry.end_time), true], [`${column}13`, minutesAsHundredHours(ordinaryBreak), true], [`${column}14`, minutesAsHundredHours(nightBreak), true]]);
    });
    // The template contains cached results for the sample data. Clear only
    // calculated attendance rows so those results cannot leak into an empty
    // export; formulas themselves remain intact for Excel to recalculate.
    xml = applyAbcsCalendarResults(xml, input.month);
    xml = applyAbcsFormulaResults(xml, input.entries);
    entries[path] = strToU8(xml);
    const submissionPath = worksheetPath(entries, ["勤務表（会社提出用）"]);
    let submissionXml = submissionPath
      ? clearCells(strFromU8(entries[submissionPath]), [...expandCellRange(13, 13, 16, 46), "A56", "L1", "M18", "M56", "P56"])
      : null;
    input.entries.forEach((entry) => {
      const day = Number(String(entry.work_date ?? "").slice(-2));
      if (!submissionXml || !Number.isInteger(day) || day < 1 || day > 31) return;
      submissionXml = patchCells(submissionXml, [[`M${15 + day}`, entry.note ?? ""]]);
    });
    if (submissionXml) submissionXml = patchCells(submissionXml, [["A56", input.report?.overtime_comment ?? ""]]);
    if (submissionPath && submissionXml) {
      changedPaths.add(submissionPath);
      submissionXml = refreshSubmissionReferenceCaches(submissionXml, xml);
      submissionXml = applySubmissionDailyReferenceCaches(submissionXml, xml);
      submissionXml = applySubmissionFormulaResults(submissionXml, xml, input.entries);
      const submissionStyleResult = removeSubmissionStrikethrough(entries, submissionXml);
      submissionXml = submissionStyleResult.xml;
      if (submissionStyleResult.changed) changedPaths.add("xl/styles.xml");
      entries[submissionPath] = strToU8(submissionXml);
    }
  }
  if (input.format === "leave_request") {
    const path = worksheetPath(entries, ["1ﾍﾟｰｼﾞ~5ﾍﾟｰｼﾞ"]);
    if (!path) throw new Error("テンプレートに休暇申請シートがありません");
    changedPaths.add(path);
    entries[path] = strToU8(patchCells(strFromU8(entries[path]), [["C2", employeeCode], ["E2", departmentName], ["H2", name]]));
    input.leaveRequests.slice(0, 40).forEach((request, index) => {
      const rowNumber = 9 + index * 2;
      entries[path] = strToU8(patchCells(strFromU8(entries[path]), [[`C${rowNumber}`, excelSerial(String(request.start_date)), true], [`D${rowNumber}`, request.leave_type], [`E${rowNumber}`, excelSerial(String(request.start_date)), true], [`H${rowNumber}`, request.reason ?? ""]]));
    });
  }
  if (input.format === "sp_report") {
    const path = worksheetPath(entries, ["作業実績表(ABC用)"]);
    if (!path) throw new Error("テンプレートに作業実績表(ABC用)シートがありません");
    changedPaths.add(path);
    let xml = clearSpReportInput(strFromU8(entries[path]));
    xml = patchCells(xml, [["H1", generatedValue, true], ["E5", companyName], ["E6", name], ["A9", monthValue, true], ["C9", name], ["E9", projectName || clientName]]);
    for (const entry of input.entries) {
      const day = Number(String(entry.work_date ?? "").slice(-2));
      if (!Number.isInteger(day) || day < 1 || day > 31) continue;
      const rowNumber = 11 + day;
      const values: Array<[string, unknown, boolean?]> = [];
      if (entry.start_time) values.push([`C${rowNumber}`, timeNumber(entry.start_time), true]);
      if (entry.end_time) values.push([`D${rowNumber}`, timeNumber(entry.end_time), true]);
      if (entry.break_minutes !== null && entry.break_minutes !== undefined && entry.break_minutes !== "") values.push([`E${rowNumber}`, timeNumberFromMinutes(entry.break_minutes), true]);
      if (entry.note !== null && entry.note !== undefined && entry.note !== "") values.push([`G${rowNumber}`, entry.note]);
      if (values.length) xml = patchCells(xml, values);
    }
    entries[path] = strToU8(xml);
    applySpReportVisibility(entries, input);
    applySpExpenseInputs(entries, input, changedPaths);
    let refreshedXml = refreshSpDateFormulaCaches(strFromU8(entries[path]), input.month);
    refreshedXml = refreshSpWorkFormulaCaches(refreshedXml, input.entries);
    entries[path] = strToU8(refreshedXml);
    refreshSpExpenseFormulaCaches(entries, input);
    requestFormulaRecalculation(entries);
    changedPaths.add("xl/workbook.xml");
  }
  // VBA and Excel's calculation engine cannot run inside Workers. Preserve the
  // formulas and finalize the workbook for a full recalculation on open.
  finalizeWorkbookBeforeOutput(entries, input.format === "sp_report");
  const integrity = validateWorkbookIntegrity(originalEntries, entries, [...changedPaths]);
  if (!integrity.ok) {
    const detail = integrity.issues.map((issue) => `${issue.kind}:${issue.path}`).join(", ");
    throw new Error(`テンプレート保全検証に失敗しました: ${detail}`);
  }
  return zipSync(entries, { level: 6 });
}
