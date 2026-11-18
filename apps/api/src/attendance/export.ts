import type { AttendanceExportFormat } from "@timesheet/shared";
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
  return xml.replace(/<c\b(?![^>]*\/>)((?:[^>]*\br=["']([^"']+)["'][^>]*))>([\s\S]*?)<\/c>/g, (cell, attributes, reference, content) => {
    if (!targets.has(reference)) return cell;
    const withoutType = attributes.replace(/\s+t=["'][^"']*["']/g, "");
    // Initialization clears user-entered constants, but never removes a
    // template formula or its cached display value. Excel will recalculate it
    // on open; retaining the cache prevents the sheet from appearing blank.
    const preservedFormula = content.match(/<f\b[\s\S]*?<\/f\s*>/)?.[0] ?? "";
    const preservedCache = content.match(/<v\b[^>]*>[\s\S]*?<\/v\s*>/)?.[0] ?? "";
    return `<c${withoutType}>${preservedFormula}${preservedCache}</c>`;
  });
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
  let workbook = strFromU8(source);
  const attributes = ` calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"`;
  const calcPattern = /<calcPr\b([^>]*)\s*\/>|<calcPr\b([^>]*)>[\s\S]*?<\/calcPr\s*>/;
  if (calcPattern.test(workbook)) {
    workbook = workbook.replace(calcPattern, `<calcPr${attributes}/>`);
  } else {
    workbook = workbook.replace(/<\/workbook>/, `<calcPr${attributes}/></workbook>`);
  }
  entries["xl/workbook.xml"] = strToU8(workbook);
  delete entries["xl/calcChain.xml"];
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function worksheetValues(xml: string) {
  const values = new Map<string, { value: string; numeric: boolean }>();
  for (const match of xml.matchAll(/<c\b([^>]*\br=["']([^"']+)["'][^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attributes = match[1];
    const content = match[3] ?? "";
    if (/<f\b/.test(content)) {
      const cached = content.match(/<v\b[^>]*>([\s\S]*?)<\/v\s*>/)?.[1];
      if (cached !== undefined) values.set(match[2], { value: decodeXml(cached), numeric: !/\bt=["'](?:str|inlineStr)["']/.test(attributes) });
      continue;
    }
    const inline = content.match(/<t\b[^>]*>([\s\S]*?)<\/t\s*>/)?.[1];
    const numeric = content.match(/<v\b[^>]*>([\s\S]*?)<\/v\s*>/)?.[1];
    if (inline !== undefined) values.set(match[2], { value: decodeXml(inline), numeric: false });
    else if (numeric !== undefined) values.set(match[2], { value: decodeXml(numeric), numeric: true });
  }
  return values;
}

/**
 * Refresh the cached result for the simple cross-sheet formulas used by the
 * submission sheet. Excel/VBA itself cannot run in Workers, so custom VBA
 * functions remain delegated to Excel; however, direct references must still
 * show the values entered through the web UI before the workbook is opened.
 */
function refreshSubmissionReferenceCaches(xml: string, inputXml: string) {
  const sourceValues = worksheetValues(inputXml);
  return xml.replace(/<c\b([^>]*\br=["']([^"']+)["'][^>]*?)>([\s\S]*?)<\/c>/g, (cell, attributes, _reference, content) => {
    const formula = content.match(/<f\b[^>]*>([\s\S]*?)<\/f\s*>/)?.[1];
    if (!formula) return cell;
    const normalized = decodeXml(formula).trim();
    const source = normalized.match(/^IF\(\s*'?勤務表（入力用）'?!(\$?[A-Z]+\$?\d+)\s*(<>0|=0|="")\s*,\s*""\s*,\s*'?勤務表（入力用）'?!\$?([A-Z]+)\$?(\d+)\s*\)$/i);
    if (!source) return cell;
    const sourceReference = source[1].replace(/\$/g, "");
    const value = sourceValues.get(sourceReference);
    if (!value) return cell;
    const empty = value.value === "" || (source[2] === "<>0" || source[2] === "=0") && Number(value.value) === 0;
    const result = empty ? "" : value.value;
    const cached = `<v>${escapeXml(result)}</v>`;
    if (/<v\b[^>]*>[\s\S]*?<\/v\s*>/.test(content)) return `<c${attributes}>${content.replace(/<v\b[^>]*>[\s\S]*?<\/v\s*>/, cached)}</c>`;
    return `<c${attributes}>${content}</c>`.replace(/<\/c>$/, `${cached}</c>`);
  });
}

function finalizeWorkbookBeforeOutput(entries: Record<string, Uint8Array>) {
  // This is intentionally the last workbook mutation before ZIP creation.
  // Workers cannot execute Excel's calculation engine or VBA. Keep the
  // template's cached values (removing them makes the workbook appear blank),
  // refresh direct input-sheet references, and ask Excel to recalculate all
  // formulas when the workbook is opened.
  requestFormulaRecalculation(entries);
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
    const submissionPath = worksheetPath(entries, ["勤務表（会社提出用）"]);
    let submissionXml = submissionPath
      ? clearCells(strFromU8(entries[submissionPath]), expandCellRange(13, 13, 16, 46))
      : null;
    input.entries.forEach((entry) => {
      const day = Number(String(entry.work_date ?? "").slice(-2));
      if (!submissionXml || !Number.isInteger(day) || day < 1 || day > 31) return;
      submissionXml = patchCells(submissionXml, [[`M${15 + day}`, entry.note ?? ""]]);
    });
    if (submissionPath && submissionXml) {
      submissionXml = refreshSubmissionReferenceCaches(submissionXml, xml);
      entries[submissionPath] = strToU8(submissionXml);
    }
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
  // VBA and Excel's calculation engine cannot run inside Workers. Preserve the
  // formulas and finalize the workbook for a full recalculation on open.
  finalizeWorkbookBeforeOutput(entries);
  return zipSync(entries, { level: 6 });
}
