import type { AttendanceExportFormat } from "@timesheet/shared";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

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

function parseXml(xml: string) {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function patchCells(xml: string, values: Array<[string, unknown, boolean?]>) {
  const document = parseXml(xml);
  const cells = document.getElementsByTagName("c");
  const rows = document.getElementsByTagName("row");
  for (const [reference, value, numeric] of values) {
    let cell = Array.from(cells).find((candidate) => candidate.getAttribute("r") === reference);
    if (!cell) {
      const rowNumber = reference.match(/\d+$/)?.[0];
      const row = Array.from(rows).find((candidate) => candidate.getAttribute("r") === rowNumber);
      if (!row) continue;
      cell = document.createElement("c");
      cell.setAttribute("r", reference);
      row.appendChild(cell);
    }
    cell.removeAttribute("t");
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    if (numeric) {
      const valueElement = document.createElement("v");
      valueElement.appendChild(document.createTextNode(String(value ?? "")));
      cell.appendChild(valueElement);
    } else {
      cell.setAttribute("t", "inlineStr");
      const inlineString = document.createElement("is");
      const text = document.createElement("t");
      text.setAttribute("xml:space", "preserve");
      text.appendChild(document.createTextNode(String(value ?? "")));
      inlineString.appendChild(text);
      cell.appendChild(inlineString);
    }
  }
  return new XMLSerializer().serializeToString(document);
}

/**
 * Reproduces the input-sheet reset performed by the ABCS workbook's
 * initialization macro.  Only cell contents are removed; cell styles,
 * merged ranges, validation, row layout and formulas outside the macro's
 * input ranges remain untouched.
 */
function clearCells(xml: string, references: string[]) {
  const document = parseXml(xml);
  const cells = document.getElementsByTagName("c");
  for (const reference of references) {
    const cell = Array.from(cells).find((candidate) => candidate.getAttribute("r") === reference);
    if (!cell) continue;
    cell.removeAttribute("t");
    for (const child of Array.from(cell.childNodes)) {
      if (child.nodeName === "f" || child.nodeName === "v" || child.nodeName === "is") cell.removeChild(child);
    }
  }
  return new XMLSerializer().serializeToString(document);
}

function expandCellRange(startColumn: number, endColumn: number, startRow: number, endRow: number) {
  const references: string[] = [];
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) references.push(`${excelColumn(column)}${row}`);
  }
  return references;
}

function initializeAbcsInputSheet(xml: string) {
  // The VBA macro clears these user-entry ranges after identity/month are set.
  // Run this before applying attendance entries so stale sample data can never
  // leak into a generated submission.
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

function requestFormulaRecalculation(entries: Record<string, Uint8Array>) {
  const source = entries["xl/workbook.xml"];
  if (!source) return;
  const document = parseXml(strFromU8(source));
  const existing = document.getElementsByTagName("calcPr")[0];
  const calcPr = existing ?? document.createElement("calcPr");
  calcPr.setAttribute("calcMode", "auto");
  calcPr.setAttribute("fullCalcOnLoad", "1");
  calcPr.setAttribute("forceFullCalc", "1");
  if (!existing) document.documentElement.appendChild(calcPr);
  entries["xl/workbook.xml"] = strToU8(new XMLSerializer().serializeToString(document));
  delete entries["xl/calcChain.xml"];
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
  const entries = unzipSync(template);
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

  if (input.format === "aaaa_sp") {
    const path = worksheetPath(entries, ["作業実績表(ABC用)"]);
    if (!path) throw new Error("テンプレートに作業実績表(ABC用)シートがありません");
    entries[path] = strToU8(patchCells(strFromU8(entries[path]), [["C3", monthValue, true], ["E6", companyName], ["E7", name], ["E8", projectName], ["E9", clientName]]));
  }
  if (input.format === "abcs_regular") {
    const path = worksheetPath(entries, ["勤務表（入力用）"]);
    if (!path) throw new Error("テンプレートに勤務表（入力用）シートがありません");
    // The macro requires the month and employee identity before it resets the
    // day-entry area.  Keep this order: identity -> macro-equivalent reset -> data.
    let xml = patchCells(strFromU8(entries[path]), [["A5", monthValue, true], ["B5", employeeCode], ["C5", nameKana], ["D5", name], ["K5", divisionName], ["P5", departmentName]]);
    xml = initializeAbcsInputSheet(xml);
    input.entries.forEach((entry) => {
      const day = Number(String(entry.work_date ?? "").slice(-2));
      if (!Number.isInteger(day) || day < 1 || day > 31) return;
      const column = excelColumn(3 + day);
      const workCode = typeof entry.work_code === "string" && entry.work_code ? entry.work_code : "D";
      const ordinaryBreak = Number(entry.ordinary_break_minutes ?? 0) === 0 && Number(entry.night_break_minutes ?? 0) === 0 && Number(entry.break_minutes ?? 0) > 0 ? entry.break_minutes : entry.ordinary_break_minutes ?? 0;
      const nightBreak = entry.night_break_minutes ?? 0;
      xml = patchCells(xml, [[`${column}9`, workCode], [`${column}10`, timeNumber(entry.start_time), true], [`${column}12`, timeNumber(entry.end_time), true], [`${column}13`, minutesAsExcelTime(ordinaryBreak), true], [`${column}14`, minutesAsExcelTime(nightBreak), true]]);
    });
    entries[path] = strToU8(xml);
  }
  if (input.format === "leave_request") {
    const path = worksheetPath(entries, ["1ﾍﾟｰｼﾞ~5ﾍﾟｰｼﾞ"]);
    if (!path) throw new Error("テンプレートに休暇申請シートがありません");
    entries[path] = strToU8(patchCells(strFromU8(entries[path]), [["C2", employeeCode], ["E2", departmentName], ["H2", name]]));
    input.leaveRequests.slice(0, 40).forEach((request, index) => {
      const rowNumber = 9 + index * 2;
      entries[path] = strToU8(patchCells(strFromU8(entries[path]), [[`C${rowNumber}`, excelSerial(String(request.start_date)), true], [`D${rowNumber}`, request.leave_type], [`E${rowNumber}`, excelSerial(String(request.start_date)), true], [`H${rowNumber}`, request.reason ?? ""]]));
    });
  }
  if (input.format === "sp_report") {
    const path = worksheetPath(entries, ["作業実績表(ABC用)"]);
    if (!path) throw new Error("テンプレートに作業実績表(ABC用)シートがありません");
    let xml = patchCells(strFromU8(entries[path]), [["H1", generatedValue, true], ["E5", companyName], ["E6", name], ["A9", monthValue, true], ["C9", name], ["E9", projectName || clientName]]);
    input.entries.slice(0, 31).forEach((entry, index) => {
      const rowNumber = 13 + index;
      const toNumber = (value: unknown) => typeof value === "string" ? Number(String(value).replace(":", "")) : Number(value ?? 0);
      xml = patchCells(xml, [[`A${rowNumber}`, excelSerial(String(entry.work_date)), true], [`C${rowNumber}`, toNumber(entry.start_time), true], [`D${rowNumber}`, toNumber(entry.end_time), true], [`E${rowNumber}`, Number(entry.break_minutes ?? 0), true], [`G${rowNumber}`, entry.note ?? ""]]);
    });
    entries[path] = strToU8(xml);
  }
  // VBA cannot run inside Workers. Preserve the formulas and ask Excel to recalculate
  // them when the copied workbook is opened, matching the macro-enabled template flow.
  requestFormulaRecalculation(entries);
  return zipSync(entries, { level: 6 });
}
