import type { AttendanceExportFormat } from "@timesheet/shared";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { cloneEntries, inspectWorkbook, updateFormulaCachesXml, validateWorkbookIntegrity } from "../excel/workbook";
import { invalidateImpactedFormulaCaches } from "../excel/formulas";
import { recalculateWorkbookFormulas } from "../excel/workbook-recalculation";
import { readCpuUsage, readHeapUsed } from "../runtime-metrics";

type Cell = string | number | null | undefined;
type CacheUpdate = { reference: string; value: string | number | null; numeric?: boolean };
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
  monthlyInput?: Record<string, unknown> | null;
  submissionReady?: boolean;
  validationWarnings?: string[];
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

const abcsWorkCodes = new Set(["", "*", "F", "Y", "H", "T", "TH", "TN", "THN", "D", "DH", "K", "KH"]);
const abcsTimeRequiredCodes = new Set(["F", "H", "DH", "KH", "TH", "THN"]);
const abcsTimeForbiddenCodes = new Set(["T", "TN", "D", "Y", "K"]);

function timeMinutes(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isInteger(hours) && Number.isInteger(minutes) && minutes < 60 ? hours * 60 + minutes : null;
}

function dateInMonth(value: unknown, month: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !value.startsWith(`${month}-`)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export type AttendanceExportValidation = { errors: string[]; warnings: string[] };

export type AttendanceSummary = {
  workDays: number;
  totalMinutes: number;
  overtimeMinutes: number;
  breakMinutes: number;
};

export function summarizeAttendanceEntries(entries: Array<Record<string, unknown>>): AttendanceSummary {
  let workDays = 0;
  let totalMinutes = 0;
  let overtimeMinutes = 0;
  let breakMinutes = 0;
  for (const entry of entries) {
    const start = timeMinutes(entry.start_time);
    const end = timeMinutes(entry.end_time);
    if (start === null || end === null) continue;
    const span = end >= start ? end - start : end + 1440 - start;
    const ordinary = Math.max(0, Number(entry.ordinary_break_minutes ?? entry.break_minutes ?? 0) || 0);
    const night = Math.max(0, Number(entry.night_break_minutes ?? 0) || 0);
    const worked = Math.max(0, span - ordinary - night);
    workDays += 1;
    totalMinutes += worked;
    overtimeMinutes += Math.max(0, worked - 8 * 60);
    breakMinutes += ordinary + night;
  }
  return { workDays, totalMinutes, overtimeMinutes, breakMinutes };
}

export function validateAbcsAttendanceExport(profile: Record<string, unknown> | null, entries: Array<Record<string, unknown>>, month: string, overtimeComment?: unknown): AttendanceExportValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!profile || !/^\d{5}$/.test(String(profile.employee_code ?? ""))) errors.push("社員コードを半角数字5桁で入力してください。");
  if (!profile || !String(profile.name_kana ?? "").trim()) errors.push("フリガナを入力してください。");
  if (!profile || !String(profile.display_name ?? "").trim()) errors.push("氏名を入力してください。");
  if (!profile || !String(profile.division_name ?? "").trim()) errors.push("所属事業部名を入力してください。");
  if (!profile || !String(profile.department_name ?? "").trim()) errors.push("所属部署名を入力してください。");

  const seenDates = new Set<string>();
  for (const entry of entries) {
    const date = String(entry.work_date ?? "");
    const label = date || "勤務日未設定";
    if (!dateInMonth(date, month)) {
      errors.push(`${label}：対象月以外、または存在しない勤務日です。`);
      continue;
    }
    if (seenDates.has(date)) errors.push(`${date}：勤務実績が重複しています。`);
    seenDates.add(date);
    const code = typeof entry.work_code === "string" ? entry.work_code : "";
    const start = entry.start_time;
    const end = entry.end_time;
    const hasStart = start !== null && start !== undefined && String(start) !== "";
    const hasEnd = end !== null && end !== undefined && String(end) !== "";
    if (!abcsWorkCodes.has(code)) errors.push(`${date}：勤務種類が不正です。`);
    if ((hasStart && !hasEnd) || (!hasStart && hasEnd)) errors.push(`${date}：開始・終了時刻を両方入力してください。`);
    if (hasStart && timeMinutes(start) === null) errors.push(`${date}：開始時刻の形式が不正です。`);
    if (hasEnd && timeMinutes(end) === null) errors.push(`${date}：終了時刻の形式が不正です。`);
    if (code && abcsTimeRequiredCodes.has(code) && (!hasStart || !hasEnd)) errors.push(`${date}：この勤務種類には開始・終了時刻が必要です。`);
    if (code && abcsTimeForbiddenCodes.has(code) && (hasStart || hasEnd)) errors.push(`${date}：この勤務種類には開始・終了時刻を入力できません。`);
    if ((code && code !== "*") || (code === "*" && (hasStart || hasEnd))) {
      if (!String(entry.note ?? "").trim()) errors.push(`${date}：勤務種類に対する備考を入力してください。`);
    }
    if (hasStart && hasEnd && timeMinutes(start) !== null && timeMinutes(end) !== null) {
      const startMinutes = timeMinutes(start)!; const endMinutes = timeMinutes(end)!;
      const span = endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 1440 - startMinutes;
      const ordinary = Math.max(0, Number(entry.ordinary_break_minutes ?? entry.break_minutes ?? 0) || 0);
      const night = Math.max(0, Number(entry.night_break_minutes ?? 0) || 0);
      const breakTotal = ordinary + night;
      const actualWork = span - breakTotal;
      if (actualWork > 8 * 60 && breakTotal < 60) warnings.push(`${date}：実労働8時間超・休憩1時間未満です。`);
      else if (actualWork > 6 * 60 && breakTotal < 45) warnings.push(`${date}：実労働6時間超・休憩45分未満です。`);
    }
  }
  if (summarizeAttendanceEntries(entries).overtimeMinutes > 0 && !String(overtimeComment ?? "").trim()) {
    errors.push("当月残業時間があるため、勤務表の当月残業時間コメントを入力してください。");
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
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
  xml = xml.replace(/<c\b([^>]*?\br=["']([^"']+)["'][^>]*?)\/>|<c\b([^>]*?\br=["']([^"']+)["'][^>]*?)>([\s\S]*?)<\/c\s*>/g, (cell, selfAttributes, selfReference, pairedAttributes, pairedReference) => {
    const attributes = selfAttributes ?? pairedAttributes;
    const reference = selfReference ?? pairedReference;
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
  // Exact equivalent of the VBA macro's Selection.ClearContents range:
  // D9:AH10,D12:AH14,D26:AH55.  In particular, D11:AH11 is intentionally
  // preserved because the macro does not clear it.
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

function isMeaningfulReportValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function hasMonthlyReportInput(report: Record<string, unknown> | null | undefined) {
  return [report?.summary, report?.achievements, report?.next_steps].some(isMeaningfulReportValue);
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

function patchTypedFormulaCache(xml: string, reference: string, value: unknown, type: "number" | "string") {
  return updateFormulaCachesXml(xml, [{ reference, value: type === "number" ? (asCell(value) ?? null) : String(value ?? ""), numeric: type === "number" }]);
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



function refreshSpReportReferenceCaches(xml: string, workXml: string) {
  const sourceValues = worksheetValues(workXml);
  return xml.replace(/<c\b([^>]*\br=["']([^"']+)["'][^>]*?)(?<!\/)>([\s\S]*?)<\/c\s*>/g, (cell, attributes, _reference, content) => {
    const formula = content.match(/<f\b[^>]*>([\s\S]*?)<\/f\s*>/)?.[1];
    if (!formula) return cell;
    const normalized = decodeXml(formula).trim();
    const source = normalized.match(/'?作業実績表\(ABC用\)'?!\$?([A-Z]+)\$?(\d+)/i);
    if (!source) return cell;
    const sourceValue = sourceValues.get(`${source[1]}${source[2]}`) ?? { value: "", numeric: false };
    const withoutType = attributes.replace(/\s+t=["'][^"']*["']/g, "");
    const nextAttributes = sourceValue.numeric && sourceValue.value !== "" ? withoutType : `${withoutType} t="str"`;
    const cached = `<v>${escapeXml(String(sourceValue.value))}</v>`;
    const cachePattern = /<v\b[^>]*(?:\/>|>[\s\S]*?<\/v\s*>)/;
    if (cachePattern.test(content)) return `<c${nextAttributes}>${content.replace(cachePattern, cached)}</c>`;
    return `<c${nextAttributes}>${content}</c>`.replace(/<\/c>$/, `${cached}</c>`);
  });
}
function monthlyReportBody(report: Record<string, unknown> | null | undefined) {
  return [report?.summary, report?.achievements, report?.next_steps].filter(isMeaningfulReportValue).map((value) => String(value)).join("\n\n");
}
function monthlyReportRows(body: string, maxRows: number) {
  const rows: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line) { rows.push(""); continue; }
    const characters = Array.from(line);
    for (let index = 0; index < characters.length; index += 60) rows.push(characters.slice(index, index + 60).join(""));
  }
  if (rows.length > maxRows) throw new Error(`月次報告の本文がテンプレートの入力行数(${maxRows}行)を超えています`);
  return rows;
}
function applySpMonthlyReport(entries: Record<string, Uint8Array>, input: TemplateInput, workXml: string, changedPaths: Set<string>) {
  const path = worksheetPath(entries, ["作業報告書"]);
  if (!path) return;
  const body = monthlyReportRows(monthlyReportBody(input.report), 27);
  let xml = clearCells(strFromU8(entries[path]), [...expandCellRange(1, 12, 9, 35)]);
  if (body.length) xml = patchCells(xml, body.map((value, index) => [`A${9 + index}`, value] as [string, unknown]));
  entries[path] = strToU8(refreshSpReportReferenceCaches(xml, workXml));
  changedPaths.add(path);
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

function finalizeWorkbookBeforeOutput(entries: Record<string, Uint8Array>, recalculateOnOpen: boolean) {
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

/**
 * Removing calcChain.xml also requires removing its package references.
 * Leaving the relationship and content-type Override behind produces a
 * dangling OOXML part reference, which Excel reports as a repaired workbook.
 */
function removeCalcChainParts(entries: Record<string, Uint8Array>) {
  delete entries["xl/calcChain.xml"];
  const relationshipsPath = "xl/_rels/workbook.xml.rels";
  const relationships = entries[relationshipsPath];
  if (relationships) {
    const xml = strFromU8(relationships).replace(
      /<Relationship\b(?=[^>]*\bType=["']http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/calcChain["'])[^>]*(?:\/>|><\/Relationship\s*>)/g,
      "",
    );
    entries[relationshipsPath] = strToU8(xml);
  }
  const contentTypesPath = "[Content_Types].xml";
  const contentTypes = entries[contentTypesPath];
  if (contentTypes) {
    const xml = strFromU8(contentTypes).replace(
      /<Override\b(?=[^>]*\bPartName=["']\/xl\/calcChain\.xml["'])[^>]*(?:\/>|><\/Override\s*>)/g,
      "",
    );
    entries[contentTypesPath] = strToU8(xml);
  }
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function sharedStringValues(xml?: string) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si\s*>/g)].map((match) =>
    [...match[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t\s*>/g)]
      .map((text) => decodeXml(text[1]))
      .join(""),
  );
}

function worksheetValues(xml: string, sharedStringsXml?: string) {
  const values = new Map<string, { value: string | number | boolean; numeric: boolean }>();
  const sharedStrings = sharedStringValues(sharedStringsXml);
  for (const match of xml.matchAll(/<c\b([^>]*?\br=["']([^"']+)["'][^>]*?)\/>|<c\b([^>]*?\br=["']([^"']+)["'][^>]*?)>([\s\S]*?)<\/c\s*>/g)) {
    const attributes = match[1] ?? match[3];
    const reference = match[2] ?? match[4];
    const content = match[5] ?? "";
    const type = attributes.match(/\bt=["']([^"']+)["']/)?.[1];
    const resolveValue = (value: string): string | number | boolean => {
      if (type === "s") return sharedStrings[Number(value)] ?? "";
      if (type === "str" || type === "inlineStr") return value;
      if (type === "b") return value === "1";
      const numericValue = Number(value);
      return value !== "" && Number.isFinite(numericValue) ? numericValue : value;
    };
    if (/<f\b/.test(content)) {
      const cached = content.match(/<v\b[^>]*>([\s\S]*?)<\/v\s*>/)?.[1];
      if (cached !== undefined) values.set(reference, { value: resolveValue(decodeXml(cached)), numeric: !/\bt=["'](?:str|inlineStr|s)["']/.test(attributes) });
      continue;
    }
    const inline = content.match(/<t\b[^>]*>([\s\S]*?)<\/t\s*>/)?.[1];
    const numeric = content.match(/<v\b[^>]*>([\s\S]*?)<\/v\s*>/)?.[1];
    if (inline !== undefined) values.set(reference, { value: decodeXml(inline), numeric: false });
    else if (numeric !== undefined) values.set(reference, { value: resolveValue(decodeXml(numeric)), numeric: type !== "s" });
  }
  return values;
}

/**
 * Refresh the cached result for the simple cross-sheet formulas used by the
 * submission sheet. Excel/VBA itself cannot run in Workers, so custom VBA
 * functions remain delegated to Excel; however, direct references must still
 * show the values entered through the web UI before the workbook is opened.
 */
function refreshSubmissionReferenceCaches(xml: string, inputXml: string, sharedStringsXml?: string) {
  const sourceValues = worksheetValues(inputXml, sharedStringsXml);
  // Do not match self-closing cells. The submission sheet contains many
  // intentional empty cells; treating `<c .../>` as an opening tag would
  // consume subsequent cells and produce malformed worksheet XML.
  return xml.replace(/<c\b([^>]*\br=["']([^"']+)["'][^>]*?)(?<!\/)>([\s\S]*?)<\/c>/g, (cell, attributes, _reference, content) => {
    const formula = content.match(/<f\b[^>]*>([\s\S]*?)<\/f\s*>/)?.[1];
    if (!formula) return cell;
    const normalized = decodeXml(formula).trim();
    const source = normalized.match(/'?勤務表（入力用）'?!\$?([A-Z]+)\$?(\d+)/i);
    if (!source) return cell;
    const sourceReference = `${source[1]}${source[2]}`;
    // A blank source cell is commonly serialized as `<c .../>` (or omitted
    // entirely), so it has no entry in worksheetValues.  It still represents
    // the empty result of a direct cross-sheet reference and must clear any
    // stale template cache.  Treat the missing source as a string empty value
    // rather than leaving the old cache in place.
    const value = sourceValues.get(sourceReference) ?? { value: "", numeric: false };
    const numericValue = Number(value.value);
    let result = value.value;
    if (/IF\([^,]+(?:<>0|=0|="")\s*,\s*""/i.test(normalized)) result = value.value === "" || /(?:<>0|=0)/i.test(normalized) && numericValue === 0 ? "" : value.value;
    else if (/IF\([^,]+=0\s*,\s*0\s*,/i.test(normalized)) result = value.value === "" || numericValue === 0 ? "0" : value.value;
    if (/TEXT\([^,]+,\s*"\[h\]:mm"\s*\)/i.test(normalized) && Number.isFinite(numericValue)) { const minutes = Math.round(numericValue * 1440); result = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`; }
    // The template marks many cross-sheet results as t="str" even when the
    // referenced input is a date/time number. Keep the formula, but match the
    // cache type to its result so Excel applies the template number format.
    const numeric = typeof result === "number";
    const nextAttributes = numeric
      ? attributes.replace(/\s+t="[^"]*"/g, "")
      : `${attributes.replace(/\s+t="[^"]*"/g, "")} t="str"`;
    const cached = `<v>${escapeXml(String(result))}</v>`;
    const cachePattern = /<v\b[^>]*(?:\/>|>[\s\S]*?<\/v\s*>)/;
    return `<c${nextAttributes}>${cachePattern.test(content) ? content.replace(cachePattern, cached) : `${content}${cached}`}</c>`;
  });
}

/**
 * Populate visible daily values on the company-submission sheet without
 * replacing its formulas. Shared-formula child cells have no formula text,
 * but their cached value can still be refreshed from the input sheet.
 */
function applySubmissionDailyReferenceCaches(xml: string, inputXml: string, sharedStringsXml?: string) {
  const sourceValues = worksheetValues(inputXml, sharedStringsXml);
  const sourceRows: Record<string, number> = {
    A: 7, B: 8, C: 9, D: 10, E: 12, F: 13, G: 14,
    H: 18, I: 19, J: 20, K: 22, L: 23,
  };
  const updates: CacheUpdate[] = [];
  const formulaForCell = (reference: string) => {
    const cell = xml.match(new RegExp(`<c\\b[^>]*\\br=["']${reference}["'][^>]*>([\\s\\S]*?)</c\\s*>`))?.[1] ?? "";
    return cell.match(/<f\b[^>]*(?:>|\/>)([\s\S]*?)<\/f\s*>/)?.[1] ?? "";
  };
  const returnsBlankForZero = (formula: string) => /\bIF\s*\([^,]*(?:=|<>)\s*0\s*,\s*""\s*,/i.test(formula);
  for (let day = 1; day <= 31; day += 1) {
    const inputColumn = excelColumn(3 + day);
    const submissionRow = 15 + day;
    for (const [submissionColumn, sourceRow] of Object.entries(sourceRows)) {
      const source = sourceValues.get(`${inputColumn}${sourceRow}`);
      // A formula cell with an empty source must have its old cache removed as
      // well. Leaving the previous numeric cache is what made blank days look
      // like a copied 730 in the generated workbook.
      const reference = `${submissionColumn}${submissionRow}`;
      const sourceValue = asCell(source?.value) ?? null;
      // These cells are direct IF(...=0,"",reference) formulas.  Their zero
      // branch is a string result, so keep zero as an empty string cache and
      // retain numeric caches only for non-zero source values.
      const value = typeof sourceValue === "number" && sourceValue === 0 && returnsBlankForZero(formulaForCell(reference))
        ? ""
        : sourceValue;
      updates.push({ reference, value });
    }
  }
  return updateFormulaCachesXml(xml, updates);
}

function cellXml(xml: string, reference: string) {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return xml.match(new RegExp(`<c\\b[^>]*?\\br=["']${escaped}["'][^>]*?/>`))?.[0]
    ?? xml.match(new RegExp(`<c\\b[^>]*?\\br=["']${escaped}["'][^>]*?>[\\s\\S]*?</c\\s*>`))?.[0]
    ?? null;
}

function restoreCellXml(xml: string, originalCell: string, reference: string) {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<c\\b[^>]*?\\br=["']${escaped}["'][^>]*?/>|<c\\b[^>]*?\\br=["']${escaped}["'][^>]*?>[\\s\\S]*?</c\\s*>`);
  return xml.replace(pattern, originalCell);
}

function restoreUntouchedCells(xml: string, cells: Map<string, string>) {
  let result = xml;
  for (const [reference, originalCell] of cells) result = restoreCellXml(result, originalCell, reference);
  return result;
}

function applyAbcsCalendarResults(xml: string, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return xml;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const updates: CacheUpdate[] = [];
  for (let day = 1; day <= 31; day += 1) {
    const value = day <= daysInMonth ? excelSerial(`${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`) : "";
    const column = excelColumn(3 + day);
    // D7:AH7 are dates and D8:AH8 are the corresponding weekday formulas.
    // The Workers runtime cannot evaluate Excel's date/weekday formulas, so
    // refresh only their cached values while preserving the formulas/styles.
    const numeric = value !== "";
    updates.push({ reference: `${column}7`, value, numeric }, { reference: `${column}8`, value, numeric });
  }
  return updateFormulaCachesXml(xml, updates);
}

function styleIdForCell(xml: string, reference: string) {
  return Number(xml.match(new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*\\bs="(\\d+)"`))?.[1]);
}

/**
 * The VBA initialization paints the two daily entry blocks according to the
 * weekly calendar.  The template stores the green and unfilled variants as
 * cell styles, so create style variants instead of rewriting fills globally.
 */
function applyAbcsCalendarColors(entries: Record<string, Uint8Array>, sheetPath: string, month: string) {
  const sheetSource = entries[sheetPath];
  const stylesSource = entries["xl/styles.xml"];
  if (!sheetSource || !stylesSource) return;
  let sheet = strFromU8(sheetSource);
  let styles = strFromU8(stylesSource);
  const xfsMatch = styles.match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/);
  if (!xfsMatch) return;
  // Match self-closing XFs and paired XFs separately.  The compact form with
  // `[^>]*` can skip XFs in this template when a later style has nested
  // alignment/protection elements, shifting style indexes and aborting the
  // recoloring pass.
  const xfList = [...xfsMatch[2].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map((match) => match[0]);
  if (!xfList.length) return;
  const greenSourceId = styleIdForCell(sheet, "D8");
  const plainSourceId = styleIdForCell(sheet, "I8");
  if (!Number.isInteger(greenSourceId) || !Number.isInteger(plainSourceId) || !xfList[greenSourceId] || !xfList[plainSourceId]) return;
  const fillId = (style: string) => Number(style.match(/\bfillId="(\d+)"/)?.[1]);
  const greenFillId = fillId(xfList[greenSourceId]);
  const plainFillId = fillId(xfList[plainSourceId]);
  if (!Number.isInteger(greenFillId) || !Number.isInteger(plainFillId)) return;
  const variants = new Map<string, number>();
  xfList.forEach((style, index) => variants.set(style, index));
  const variantStyle = (sourceId: number, targetFillId: number) => {
    const source = xfList[sourceId];
    if (!source) return sourceId;
    const variant = /\bfillId="\d+"/.test(source)
      ? source.replace(/\bfillId="\d+"/, `fillId="${targetFillId}"`)
      : source.replace(/<xf\b/, `<xf fillId="${targetFillId}"`);
    const existing = variants.get(variant);
    if (existing !== undefined) return existing;
    const id = xfList.length;
    xfList.push(variant);
    variants.set(variant, id);
    return id;
  };
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber)) return;
  const holidayDays = new Set<number>();
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, monthNumber - 1, day));
    // SetHolidayPatternCall1 uses the holiday module plus these workbook-
    // specific holidays.  ColorIndex 35 is represented by the template's
    // green fill; workdays use xlNone (the unfilled variant).
    if (isAbcsHoliday(date)) holidayDays.add(day);
  }
  const targets = new Set(expandCellRange(4, 34, 8, 24).concat(expandCellRange(4, 34, 26, 55)));
  sheet = sheet.replace(/<c\b([^>]*?\br="([A-Z]+)(\d+)"[^>]*)>/g, (cell, attributes, column, row) => {
    const reference = `${column}${row}`;
    if (!targets.has(reference)) return cell;
    const day = excelColumnToNumber(column) - 3;
    const sourceId = Number(attributes.match(/\bs="(\d+)"/)?.[1]);
    if (!Number.isInteger(sourceId) || !xfList[sourceId]) return cell;
    const targetFillId = holidayDays.has(day) ? greenFillId : plainFillId;
    const nextStyleId = variantStyle(sourceId, targetFillId);
    return attributes.match(/\bs="\d+"/)
      ? `<c${attributes.replace(/\bs="\d+"/, `s="${nextStyleId}"`)}>`
      : `<c${attributes} s="${nextStyleId}">`;
  });
  styles = styles.replace(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/, (_block, attributes) => `<cellXfs${attributes.replace(/\bcount="\d+"/, `count="${xfList.length}"`)}>${xfList.join("")}</cellXfs>`);
  entries[sheetPath] = strToU8(sheet);
  entries["xl/styles.xml"] = strToU8(styles);
}

function excelColumnToNumber(column: string) {
  let result = 0;
  for (const character of column) result = result * 26 + character.charCodeAt(0) - 64;
  return result;
}

function isJapaneseCalendarHoliday(date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  if (month === 1 && day === 1) return true;
  if (["2-11", "2-23", "4-29", "5-3", "5-4", "5-5", "8-11", "11-3", "11-23"].includes(`${month}-${day}`)) return true;
  const weekday = date.getUTCDay();
  const nthWeekday = Math.floor((day - 1) / 7) + 1;
  if ((month === 1 && weekday === 1 && nthWeekday === 2) || (month === 7 && weekday === 1 && nthWeekday === 3) || (month === 9 && weekday === 1 && nthWeekday === 3) || (month === 10 && weekday === 1 && nthWeekday === 2)) return true;
  if ((month === 3 && day === Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))) || (month === 9 && day === Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4)))) return true;
  // Explicitly present in the extracted VBA holiday table.
  return year === 2026 && month === 9 && day === 22;
}

function isJapaneseHoliday(date: Date) {
  // The application rule is 土日祝: Sundays are handled here and Saturdays
  // are handled by isAbcsHoliday. Do not promote every Monday after Sunday to
  // a substitute holiday; only actual public holidays are added.
  return isJapaneseCalendarHoliday(date) || date.getUTCDay() === 0;
}

function isAbcsHoliday(date: Date) {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const weekday = date.getUTCDay();
  // SetHolidayPatternCall1 adds Saturday and the fixed year-end/year-start
  // shutdown days to the calendar holiday module.
  return weekday === 0 || weekday === 6 || isJapaneseHoliday(date)
    || (month === 1 && (day === 2 || day === 3))
    || (month === 12 && (day === 30 || day === 31));
}

function defaultAbcsWorkCode(month: string, day: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || day < 1 || day > new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()) return "";
  const date = new Date(`${month}-${String(day).padStart(2, "0")}T00:00:00Z`);
  return date.getUTCDay() === 0 || date.getUTCDay() === 6 || isJapaneseHoliday(date) ? "*" : "";
}

function entryAbcsWorkCode(entry: Record<string, unknown>) {
  const explicit = typeof entry.work_code === "string" ? entry.work_code : "";
  if (explicit) return explicit;
  // An attendance entry with a start or end time represents ordinary work,
  // even when the calendar default for that date is the holiday marker (*).
  // This is how a user records a substitute/holiday workday as 就業.
  if (entry.start_time || entry.end_time) return "";
  const workDate = String(entry.work_date ?? "");
  return workDate.length >= 7 ? defaultAbcsWorkCode(workDate.slice(0, 7), Number(workDate.slice(-2))) : "";
}

function applyAbcsWorkCodeDefaults(xml: string, month: string) {
  const values: Array<[string, unknown]> = [];
  for (let day = 1; day <= 31; day += 1) {
    const column = excelColumn(3 + day);
    values.push([`${column}9`, defaultAbcsWorkCode(month, day)]);
  }
  return patchCells(xml, values);
}

function clockMinutes(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function ordinaryBreakMinutes(entry: Record<string, unknown>) {
  const ordinary = Number(entry.ordinary_break_minutes ?? 0) || 0;
  const night = Number(entry.night_break_minutes ?? 0) || 0;
  const legacy = Number(entry.break_minutes ?? 0) || 0;
  // Older GUI payloads send the single break field while leaving the split
  // fields at zero. Treat that value as ordinary break time, including the
  // required 60-minute + 0-minute night-break case.
  return ordinary === 0 && night === 0 && legacy > 0 ? legacy : ordinary;
}

function calculatedAbcsRows(entries: Array<Record<string, unknown>>) {
  const byDay = new Map<number, { worked: number; ordinary: number; holiday: number; night: number; total: number; substitute: number; late: number }>();
  for (const entry of entries) {
    const day = Number(String(entry.work_date ?? "").slice(-2));
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const start = clockMinutes(entry.start_time); const end = clockMinutes(entry.end_time);
    const ordinaryBreak = Math.max(0, ordinaryBreakMinutes(entry));
    const nightBreak = Math.max(0, Number(entry.night_break_minutes ?? 0) || 0);
    const span = start === null || end === null ? 0 : (end >= start ? end - start : end + 1440 - start);
    const worked = Math.max(0, span - ordinaryBreak - nightBreak) / 1440;
    const code = entryAbcsWorkCode(entry);
    const holiday = code === "*" || code === "H" || code === "Y";
    // ABCS VBA's regular threshold is 7:45.  Keep this seed compatible with
    // 残業時間 before the standard formulas propagate into the submission sheet.
    const ordinary = holiday ? 0 : Math.max(0, worked - 465 / 1440);
    const holidayValue = holiday ? worked : 0;
    byDay.set(day, { worked, ordinary, holiday: holidayValue, night: 0, total: ordinary + holidayValue, substitute: 0, late: 0 });
  }
  return byDay;
}

function applyAbcsFormulaResults(xml: string, entries: Array<Record<string, unknown>>) {
  const byDay = new Map<number, { worked: number; ordinary: number; holiday: number; night: number; total: number; substitute: number; late: number }>();
  for (const entry of entries) {
    const day = Number(String(entry.work_date ?? "").slice(-2));
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const start = clockMinutes(entry.start_time); const end = clockMinutes(entry.end_time);
    const ordinaryBreak = Math.max(0, ordinaryBreakMinutes(entry));
    const nightBreak = Math.max(0, Number(entry.night_break_minutes ?? 0) || 0);
    const span = start === null || end === null ? 0 : (end >= start ? end - start : end + 1440 - start);
    const worked = Math.max(0, span - ordinaryBreak - nightBreak) / 1440;
    const code = entryAbcsWorkCode(entry);
    const holiday = code === "*" || code === "H" || code === "Y";
    const ordinary = holiday ? 0 : Math.max(0, worked - 465 / 1440);
    const holidayValue = holiday ? worked : 0;
    byDay.set(day, { worked, ordinary, holiday: holidayValue, night: 0, total: ordinary + holidayValue, substitute: 0, late: 0 });
  }
  const updates: CacheUpdate[] = [];
  const hasFormula = (reference: string) => new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>[\\s\\S]*?<f\\b`).test(xml);
  for (let day = 1; day <= 31; day += 1) {
    const column = excelColumn(3 + day); const result = byDay.get(day) ?? { worked: 0, ordinary: 0, holiday: 0, night: 0, total: 0, substitute: 0, late: 0 };
    // Shared-formula children contain `<f t="shared" si="…"/>`, so the
    // formula text is present only on the parent. Presence of any formula is
    // the correct criterion for refreshing the cache.
    if (hasFormula(`${column}15`)) updates.push({ reference: `${column}15`, value: result.worked });
    for (const [row, value] of Object.entries({ 18: result.ordinary, 19: result.holiday, 20: result.night, 21: result.total, 22: result.substitute, 23: result.late })) {
      const reference = `${column}${row}`;
      if (hasFormula(reference)) updates.push({ reference, value });
    }
    // 時間差() is workbook/VBA-specific. At minimum, remove a stale numeric
    // cache on an empty day; for populated days Excel can recalculate the
    // original formula against the preserved row-74 inputs.
    if (!byDay.has(day) && hasFormula(`${column}24`)) updates.push({ reference: `${column}24`, value: 0 });
  }
  let nextXml = updateFormulaCachesXml(xml, updates);
  // B17:B23 are another shared-formula family (the parent is B17). The
  // generic evaluator can see the parent but, depending on the original
  // shared-formula layout, may leave child caches untouched. Rebuild these
  // SUM(D:AH) caches from the now-current daily result cells so stale values
  // such as 97/87/16130 cannot feed the submission sheet.
  const dailyValues = worksheetValues(nextXml);
  const summaryUpdates: CacheUpdate[] = [];
  for (let row = 17; row <= 23; row += 1) {
    const reference = `B${row}`;
    if (!hasFormula(reference)) continue;
    let sum = 0;
    for (let day = 1; day <= 31; day += 1) {
      const value = dailyValues.get(`${excelColumn(3 + day)}${row}`)?.value;
      if (typeof value === "number" && Number.isFinite(value)) sum += value;
    }
    summaryUpdates.push({ reference, value: sum });
  }
  return updateFormulaCachesXml(nextXml, summaryUpdates);
}

function applySubmissionFormulaResults(xml: string, inputXml: string, entries: Array<Record<string, unknown>>) {
  const byDay = calculatedAbcsRows(entries);
  const totals = [...byDay.values()].reduce((sum, value) => ({ ordinary: sum.ordinary + value.ordinary, holiday: sum.holiday + value.holiday, night: sum.night + value.night, total: sum.total + value.total, substitute: sum.substitute + value.substitute, late: sum.late + value.late }), { ordinary: 0, holiday: 0, night: 0, total: 0, substitute: 0, late: 0 });
  const sourceValues = worksheetValues(inputXml);
  const workedTotal = [...byDay.values()].reduce((sum, value) => sum + value.total, 0);
  const codeCount = (codes: string[]) => entries.filter((entry) => codes.includes(entryAbcsWorkCode(entry))).length;
  const monthlyHours = sourceValues.get("B23")?.value;
  const monthlyHoursText = typeof monthlyHours === "number"
    ? `${Math.floor(Math.round(monthlyHours * 1440) / 60)}:${String(Math.round(monthlyHours * 1440) % 60).padStart(2, "0")}`
    : monthlyHours ?? "";
  const values: Record<string, unknown> = {
    M48: totals.total === 0
      ? (totals.substitute === 0 ? "" : "-")
      : (totals.substitute === 0 || totals.total >= totals.substitute ? "" : "-"),
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
  const updates = Object.entries(values)
    .filter(([reference]) => new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>[\\s\\S]*?<f\\b`).test(xml))
    .map(([reference, value]) => ({ reference, value: asCell(value) ?? null }));
  return updateFormulaCachesXml(xml, updates);
}

function applyAbcsSubmissionCheckResult(xml: string, _ready: boolean, warnings: string[]) {
  // Do not touch the template's first row. Its blank cells are part of the
  // original layout that lets the A1 title display across the header.
  const values: Array<[string, unknown, boolean?]> = [];
  for (const warning of warnings) {
    const day = Number(warning.match(/^\d{4}-\d{2}-(\d{2})：/)?.[1]);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const message = warning.includes("8時間超") ? "休憩1時間未満" : "休憩45分未満";
    values.push([`Q${15 + day}`, message]);
  }
  return patchCells(xml, values);
}

function clearAbcsSubmissionHeaderError(entries: Record<string, Uint8Array>, sheetPath: string) {
  const sheetSource = entries[sheetPath];
  const stylesSource = entries["xl/styles.xml"];
  if (!sheetSource || !stylesSource) return;
  let sheet = strFromU8(sheetSource);
  let styles = strFromU8(stylesSource);
  const xfsMatch = styles.match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/);
  if (!xfsMatch) return;
  const xfList = [...xfsMatch[2].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map((match) => match[0]);
  const variants = new Map<string, number>();
  xfList.forEach((style, index) => variants.set(style, index));
  const noFillStyle = (sourceId: number) => {
    const source = xfList[sourceId];
    if (!source) return sourceId;
    const variant = /\bfillId="\d+"/.test(source) ? source.replace(/\bfillId="\d+"/, "fillId=\"0\"") : source.replace(/<xf\b/, "<xf fillId=\"0\"");
    const existing = variants.get(variant);
    if (existing !== undefined) return existing;
    const id = xfList.length;
    xfList.push(variant);
    variants.set(variant, id);
    return id;
  };
  const targets = new Set(expandCellRange(1, 18, 1, 1));
  sheet = sheet.replace(/<c\b([^>]*?\br="([A-Z]+)(\d+)"[^>]*)>/g, (cell, attributes, column, row) => {
    const reference = `${column}${row}`;
    if (!targets.has(reference)) return cell;
    const sourceId = Number(attributes.match(/\bs="(\d+)"/)?.[1]);
    if (!Number.isInteger(sourceId)) return cell;
    const nextStyleId = noFillStyle(sourceId);
    return attributes.match(/\bs="\d+"/) ? `<c${attributes.replace(/\bs="\d+"/, `s="${nextStyleId}"`)}>` : cell;
  });
  styles = styles.replace(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/, (_block, attributes) => `<cellXfs${attributes.replace(/\bcount="\d+"/, `count="${xfList.length}"`)}>${xfList.join("")}</cellXfs>`);
  entries[sheetPath] = strToU8(sheet);
  entries["xl/styles.xml"] = strToU8(styles);
}

function recalculateWorkbookBeforeOutput(entries: Record<string, Uint8Array>, input: TemplateInput) {
  // Seed the VBA-dependent daily cells first, then recalculate every supported
  // standard formula in the original OOXML package. Unsupported UDF cells keep
  // their original cache and are explicitly left for Excel.
  let untouchedTemplateCells = new Map<string, string>();
  if (input.format === "abcs_regular") {
    const inputPath = worksheetPath(entries, ["勤務表（入力用）"]);
    const submissionPath = worksheetPath(entries, ["勤務表（会社提出用）"]);
    const inputXml = inputPath ? strFromU8(entries[inputPath]) : "";
    const submissionXml = submissionPath ? strFromU8(entries[submissionPath]) : "";
    untouchedTemplateCells = new Map([
      ...["AF5", "AG5", "AH5"].map((reference) => [reference, cellXml(inputXml, reference)] as const),
      ...(submissionPath ? [["R47", cellXml(submissionXml, "R47")] as const] : []),
    ].filter((entry): entry is [string, string] => Boolean(entry[1])));
    if (inputPath) {
      // R47 is a template-owned formatting cell, not an attendance result.
      // Capture it before invalidation/evaluation so no generic formula pass
      // can turn it into a calculated cache.
      const changedInput = new Set(["A5", "B5", "C5", "D5", "K5", "P5", ...expandCellRange(4, 34, 7, 14)]);
      const changedSubmission = new Set(["A56", "M56", "P56", "L1", ...expandCellRange(13, 13, 16, 46)]);
      const invalidationInputs = [{ path: inputPath, name: "勤務表（入力用）", changed: changedInput }];
      if (submissionPath) invalidationInputs.push({ path: submissionPath, name: "勤務表（会社提出用）", changed: changedSubmission });
      // Direct dependencies are enough here because deterministic result
      // writers below cover the known transitive totals. The full transitive
      // analyzer remains available off the request path.
      invalidateImpactedFormulaCaches(entries, invalidationInputs, { transitive: false });

      let inputXml = strFromU8(entries[inputPath]);
      inputXml = applyAbcsCalendarResults(inputXml, input.month);
      inputXml = applyAbcsFormulaResults(inputXml, input.entries);
      inputXml = restoreUntouchedCells(inputXml, untouchedTemplateCells);
      entries[inputPath] = strToU8(inputXml);

      if (submissionPath) {
        let submissionXml = strFromU8(entries[submissionPath]);
        const sharedStringsXml = strFromU8(entries["xl/sharedStrings.xml"] ?? new Uint8Array());
        submissionXml = refreshSubmissionReferenceCaches(submissionXml, inputXml, sharedStringsXml);
        submissionXml = applySubmissionDailyReferenceCaches(submissionXml, inputXml, sharedStringsXml);
        submissionXml = applySubmissionFormulaResults(submissionXml, inputXml, input.entries);
        submissionXml = applyAbcsSubmissionCheckResult(submissionXml, input.submissionReady === true, input.validationWarnings ?? []);
        submissionXml = restoreUntouchedCells(submissionXml, untouchedTemplateCells);
        entries[submissionPath] = strToU8(submissionXml);
      }
    }
  }

  // Do not trust old caches for cells whose inputs were changed by this
  // export. Supported VBA-compatible functions are evaluated below; only
  // genuinely unsupported cells retain their prior cache by policy.
  const report = recalculateWorkbookFormulas(entries);
  console.info("excel_recalculation_metrics", JSON.stringify({
    totalFormulas: report.totalFormulas,
    calculationTargets: report.calculationTargets,
    evaluationSuccesses: report.evaluationSuccesses,
    evaluationFailures: report.evaluationFailures,
    unsupported: report.unsupported,
    emptyCachesBefore: report.emptyCachesBefore,
    emptyCachesAfter: report.emptyCachesAfter,
    unsupportedCategories: report.unsupportedCells.reduce<Record<string, number>>((out, cell) => { const key = cell.category ?? "unknown"; out[key] = (out[key] ?? 0) + 1; return out; }, {}),
    timings: report.timings,
    resourceUsage: report.resourceUsage,
  }));

  // The calendar rows are part of the template's VBA-facing display contract.
  // The generic formula pass intentionally does not invent values for formulas
  // that are represented by shared/legacy date formulas.  Re-apply the
  // month-derived cache after that pass while preserving the original formula
  // text, style and shared-formula metadata.  Submission-sheet references are
  // refreshed from the final input XML so both sheets end with the same dates.
  if (input.format === "abcs_regular") {
    const inputPath = worksheetPath(entries, ["勤務表（入力用）"]);
    const submissionPath = worksheetPath(entries, ["勤務表（会社提出用）"]);
    if (inputPath) {
      const sharedStringsXml = strFromU8(entries["xl/sharedStrings.xml"] ?? new Uint8Array());
      let finalInputXml = applyAbcsCalendarResults(strFromU8(entries[inputPath]), input.month);
      // Re-apply the deterministic VBA-compatible daily caches after the
      // generic evaluator. Otherwise unsupported/shared formulas can restore
      // the template's stale cache between the first and final passes.
      finalInputXml = applyAbcsFormulaResults(finalInputXml, input.entries);
      finalInputXml = restoreUntouchedCells(finalInputXml, untouchedTemplateCells);
      entries[inputPath] = strToU8(finalInputXml);
      if (submissionPath) {
        let finalSubmissionXml = strFromU8(entries[submissionPath]);
        finalSubmissionXml = refreshSubmissionReferenceCaches(finalSubmissionXml, finalInputXml, sharedStringsXml);
        finalSubmissionXml = applySubmissionDailyReferenceCaches(finalSubmissionXml, finalInputXml, sharedStringsXml);
        // The generic evaluator cannot reproduce the workbook's VBA-backed
        // monthly totals reliably. Re-apply the deterministic result writer
        // after the final cache pass so stale numeric caches cannot return.
        finalSubmissionXml = applySubmissionFormulaResults(finalSubmissionXml, finalInputXml, input.entries);
        finalSubmissionXml = restoreUntouchedCells(finalSubmissionXml, untouchedTemplateCells);
        entries[submissionPath] = strToU8(finalSubmissionXml);
      }
    }
  }

  // Finally request a full Excel recalculation. Workers cannot execute
  // Excel/VBA UDFs, so those remaining formulas are recalculated by Excel on
  // open/save while all deterministic caches above are already current.
  const source = entries["xl/workbook.xml"];
  if (!source) return;
  let workbook = strFromU8(source);
  const calcId = workbook.match(/<calcPr\b[^>]*\bcalcId="([^"]+)"/)?.[1];
  const attributes = `${calcId ? ` calcId="${calcId}"` : ""} calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1" calcCompleted="0" calcOnSave="1"`;
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

function minutesAsHundredHours(value: unknown) {
  const minutes = Number(value ?? 0);
  // ABCS templates use HHMM notation for every time input, including breaks:
  // 09:00 -> 900, 17:30 -> 1730, 60 minutes -> 100, 30 minutes -> 30.
  if (!Number.isFinite(minutes) || minutes < 0) return 0;
  const hours = Math.floor(minutes / 60);
  return hours * 100 + (minutes % 60);
}


export function createAttendanceWorkbookFromTemplate(template: Uint8Array, input: TemplateInput) {
  const runtime = (globalThis as typeof globalThis & { process?: unknown }).process;
  const cpuStart = readCpuUsage(runtime);
  const heapBefore = readHeapUsed(runtime);
  const unzipStarted = typeof performance === "undefined" ? Date.now() : performance.now();
  const originalEntries = unzipSync(template);
  const unzipElapsed = (typeof performance === "undefined" ? Date.now() : performance.now()) - unzipStarted;
  const entries = cloneEntries(originalEntries);
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

  const changedPaths = new Set<string>([
    "xl/workbook.xml",
    "xl/calcChain.xml",
    "xl/_rels/workbook.xml.rels",
    "[Content_Types].xml",
  ]);
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
    xml = applyAbcsCalendarResults(xml, input.month);
    entries[path] = strToU8(xml);
    applyAbcsCalendarColors(entries, path, input.month);
    changedPaths.add("xl/styles.xml");
    xml = strFromU8(entries[path]);
    xml = initializeAbcsInputSheet(xml);
    xml = applyAbcsWorkCodeDefaults(xml, input.month);
    const entryValues: Array<[string, unknown, boolean?]> = [];
    input.entries.forEach((entry) => {
      const day = Number(String(entry.work_date ?? "").slice(-2));
      if (!Number.isInteger(day) || day < 1 || day > 31) return;
      const column = excelColumn(3 + day);
      const workCode = entryAbcsWorkCode(entry);
      const ordinaryBreak = ordinaryBreakMinutes(entry);
      const nightBreak = entry.night_break_minutes ?? 0;
      entryValues.push([`${column}9`, workCode], [`${column}10`, timeNumber(entry.start_time), true], [`${column}12`, timeNumber(entry.end_time), true], [`${column}13`, minutesAsHundredHours(ordinaryBreak), true], [`${column}14`, minutesAsHundredHours(nightBreak), true]);
    });
    xml = patchCells(xml, entryValues);
    // The template contains cached results for the sample data. Clear only
    // calculated attendance rows so those results cannot leak into an empty
    // export; formulas themselves remain intact for Excel to recalculate.
    xml = applyAbcsFormulaResults(xml, input.entries);
    entries[path] = strToU8(xml);
    const submissionPath = worksheetPath(entries, ["勤務表（会社提出用）"]);
    let submissionXml = submissionPath
      ? clearCells(strFromU8(entries[submissionPath]), [...expandCellRange(13, 13, 16, 46), "A56", "M56", "P56", "L1", "M18"])
      : null;
    if (submissionXml) {
      submissionXml = updateFormulaCachesXml(submissionXml, [{ reference: "L1", value: null }, { reference: "M18", value: null }]);
      // Values reset by the VBA macro's company-submission-sheet section.
      submissionXml = patchCells(submissionXml, [["M56", 0, true], ["P56", 0, true]]);
    }
    const noteValues: Array<[string, unknown]> = [];
    input.entries.forEach((entry) => {
      const day = Number(String(entry.work_date ?? "").slice(-2));
      if (!submissionXml || !Number.isInteger(day) || day < 1 || day > 31) return;
      noteValues.push([`M${15 + day}`, entry.note ?? ""]);
    });
    if (submissionXml) submissionXml = patchCells(submissionXml, [...noteValues, ["A56", input.monthlyInput?.overtime_comment ?? ""]]);
    if (submissionPath && submissionXml) {
      changedPaths.add(submissionPath);
      const sharedStringsXml = strFromU8(entries["xl/sharedStrings.xml"] ?? new Uint8Array());
      submissionXml = refreshSubmissionReferenceCaches(submissionXml, xml, sharedStringsXml);
      submissionXml = applySubmissionDailyReferenceCaches(submissionXml, xml, sharedStringsXml);
      submissionXml = applySubmissionFormulaResults(submissionXml, xml, input.entries);
      submissionXml = applyAbcsSubmissionCheckResult(submissionXml, input.submissionReady === true, input.validationWarnings ?? []);
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
    applySpMonthlyReport(entries, input, refreshedXml, changedPaths);
    refreshSpExpenseFormulaCaches(entries, input);
    requestFormulaRecalculation(entries);
    changedPaths.add("xl/workbook.xml");
  }
  // VBA and Excel's calculation engine cannot run inside Workers. Preserve the
  // formulas and the supported cached results, then leave Excel an explicit
  // final recalculation request for opening the downloaded workbook.
  // The SP workbook has its own explicit cache updates above. Running the
  // ABCS-wide evaluator here would treat blank note cells as formula targets
  // and can write time caches into G12:G42 or erase cross-sheet reference
  // caches such as 作業報告書!I5. Keep that evaluator isolated to ABCS.
  if (input.format !== "sp_report") recalculateWorkbookBeforeOutput(entries, input);
  if (input.format === "sp_report") {
    const workPath = worksheetPath(entries, ["作業実績表(ABC用)"]);
    if (workPath) {
      let workXml = refreshSpDateFormulaCaches(strFromU8(entries[workPath]), input.month);
      workXml = refreshSpWorkFormulaCaches(workXml, input.entries);
      entries[workPath] = strToU8(workXml);
    }
  }
  if (input.format === "sp_report") finalizeWorkbookBeforeOutput(entries, true);
  // Recalculation may update formula caches on any worksheet, including hidden
  // support sheets. Allow those intended XML cache edits while still keeping
  // VBA, styles, relationships and other package parts byte-stable.
  for (const path of Object.keys(entries)) if (/^xl\/worksheets\/.*\.xml$/.test(path)) changedPaths.add(path);
  const integrity = validateWorkbookIntegrity(originalEntries, entries, [...changedPaths]);
  if (!integrity.ok) {
    const detail = integrity.issues.map((issue) => `${issue.kind}:${issue.path}`).join(", ");
    throw new Error(`テンプレート保全検証に失敗しました: ${detail}`);
  }
  // Low compression is intentional: Workers CPU is the limiting resource for
  // this macro-enabled workbook. The workbook parts remain byte-for-byte the
  // same; only the ZIP compression ratio changes.
  const zipStarted = typeof performance === "undefined" ? Date.now() : performance.now();
  const output = zipSync(entries, { level: 1 });
  const zipElapsed = (typeof performance === "undefined" ? Date.now() : performance.now()) - zipStarted;
  const heapAfter = readHeapUsed(runtime);
  const cpu = cpuStart ? readCpuUsage(runtime, cpuStart) : undefined;
  console.info("excel_export_metrics", JSON.stringify({ unzipWallMs: unzipElapsed, zipWallMs: zipElapsed, inputBytes: template.byteLength, outputBytes: output.byteLength, changedParts: changedPaths.size, resourceUsage: { cpuUserMs: cpu ? cpu.user / 1000 : undefined, cpuSystemMs: cpu ? cpu.system / 1000 : undefined, heapUsedBefore: heapBefore, heapUsedAfter: heapAfter, heapSampleDelta: heapBefore !== undefined && heapAfter !== undefined ? heapAfter - heapBefore : undefined } }));
  return output;
}
