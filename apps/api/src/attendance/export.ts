import type { AttendanceExportFormat } from "@timesheet/shared";

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
