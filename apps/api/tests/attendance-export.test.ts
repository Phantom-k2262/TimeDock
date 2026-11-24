import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { attendanceFilename, createAttendanceWorkbookFromTemplate } from "../src/attendance/export";

describe("attendance workbook export", () => {
  it.skipIf(!existsSync("D:/yusuke/ダウンロード/ABCS正社員（普通）勤務表M月(氏名).xlsm"))("keeps the real ABCS XLSM worksheets well-formed", () => {
    const template = readFileSync("D:/yusuke/ダウンロード/ABCS正社員（普通）勤務表M月(氏名).xlsm");
    const workbook = unzipSync(createAttendanceWorkbookFromTemplate(template, {
      format: "abcs_regular",
      month: "2026-11",
      generatedAt: "2026-11-20T06:00:00.000Z",
      profile: { display_name: "テスト利用者", name_kana: "テスト", employee_code: "00553", company_name: "ABC", division_name: "事業部", department_name: "部署" },
      entries: [{ work_date: "2026-11-01", start_time: "09:00", end_time: "18:00", break_minutes: 60, ordinary_break_minutes: 60, night_break_minutes: 0, work_code: "D", note: "" }],
      leaveRequests: [],
      expenses: [],
      report: null,
      displayName: "テスト利用者",
    }));
    for (const path of ["xl/worksheets/sheet3.xml", "xl/worksheets/sheet4.xml"]) {
      const parsed = new DOMParser().parseFromString(strFromU8(workbook[path]), "application/xml");
      expect(parsed.getElementsByTagName("parsererror").length, path).toBe(0);
    }
    const submission = strFromU8(workbook["xl/worksheets/sheet4.xml"]);
    const inputSheet = strFromU8(workbook["xl/worksheets/sheet3.xml"]);
    const styles = strFromU8(workbook["xl/styles.xml"]);
    expect(styles, "ABCS export must not introduce strikethrough fonts").not.toMatch(/<strike\b/i);
    const directReferenceCells = [...submission.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)]
      .filter(([, attributes, content]) => /\bt="str"\b/.test(attributes) && /<f[\s\S]*?勤務表（入力用）/.test(content));
    expect(directReferenceCells, "cross-sheet numeric caches must not remain string-typed").toEqual([]);

    const f16 = submission.match(/<c\b([^>]*\br="F16"[^>]*)>([\s\S]*?)<\/c>/);
    expect(f16?.[1]).not.toContain('t="str"');
    expect(f16?.[2]).toContain("<v>100</v>");
    expect(inputSheet).toContain('r="D7" s="161"><f>$A$5</f><v>46327</v></c>');
    expect(inputSheet).toContain('r="E7" s="161"><f t="shared" ref="E7:N7" si="0">IF(D7="","",IF(MONTH(D7)=MONTH(D7+1),D7+1,""))</f><v>46328</v></c>');
    expect(inputSheet).toMatch(/<c\b[^>]*\br="D13"[^>]*><v>100<\/v><\/c>/);
    const d24 = inputSheet.match(/<c\b[^>]*\br="D24"[^>]*>[\s\S]*?<v>([^<]+)<\/v>/);
    expect(Number(d24?.[1])).toBe(800);
    const ai15 = inputSheet.match(/<c\b[^>]*\br="AI15"[^>]*>[\s\S]*?<v>([^<]+)<\/v>/);
    expect(Number(ai15?.[1])).toBeCloseTo(1 / 3, 10);
    const l1 = submission.match(/<c\b([^>]*\br="L1"[^>]*)>([\s\S]*?)<\/c>/);
    expect(l1?.[2]).toMatch(/<v><\/v>/);
    expect(submission).toMatch(/<c\b[^>]*\br="F52"[^>]*>[\s\S]*?<v>1<\/v>/);
  });

  it.skipIf(!existsSync("D:/yusuke/ダウンロード/作業報告書・作業実績報告書(SP用)Ver2.2.xlsx"))("maps SP report data by calendar day and hides unused sheets", () => {
    const template = readFileSync("D:/yusuke/ダウンロード/作業報告書・作業実績報告書(SP用)Ver2.2.xlsx");
    const workbook = unzipSync(createAttendanceWorkbookFromTemplate(template, {
      format: "sp_report",
      month: "2026-11",
      generatedAt: "2026-11-20T06:00:00.000Z",
      profile: { display_name: "テスト利用者", company_name: "ABC", project_name: "案件" },
      entries: [
        { work_date: "2026-11-03", start_time: "09:00", end_time: "18:00", break_minutes: 75, note: "3日" },
      ],
      leaveRequests: [],
      expenses: [],
      report: null,
      displayName: "テスト利用者",
    }));
    const workSheet = strFromU8(workbook["xl/worksheets/sheet1.xml"]);
    const reportSheet = strFromU8(workbook["xl/worksheets/sheet2.xml"]);
    const workbookXml = strFromU8(workbook["xl/workbook.xml"]);
    expect(workSheet).toContain('r="C14"');
    expect(workSheet).toContain('r="C14" s="');
    expect(workSheet).toContain('r="D14"');
    expect(workSheet).toContain('r="E14"');
    expect(workSheet).toContain("115");
    expect(workSheet).toMatch(/r="F14"[^>]*>[\s\S]*?<f[^>]*(?:\/>|>[\s\S]*?<\/f>)[\s\S]*?<v>745<\/v>/);
    expect(workSheet).toMatch(/r="J14"[^>]*>[\s\S]*?<f[^>]*(?:\/>|>[\s\S]*?<\/f>)[\s\S]*?<v>540<\/v>/);
    expect(workSheet).toMatch(/r="K14"[^>]*>[\s\S]*?<f[^>]*(?:\/>|>[\s\S]*?<\/f>)[\s\S]*?<v>465<\/v>/);
    expect(workSheet).toMatch(/r="A12"[^>]*>[\s\S]*?<v>46327<\/v>/);
    expect(workSheet).toMatch(/r="A13"[^>]*>[\s\S]*?<v>46328<\/v>/);
    expect(workSheet).toMatch(/r="A42"[^>]*t="str"[^>]*>[\s\S]*?<f[^>]*>[\s\S]*?<\/f>[\s\S]*?<v><\/v>/);
    expect(workSheet).toMatch(/r="B13"[^>]*>[\s\S]*?<v>月<\/v>/);
    expect(workSheet).toContain('r="G14" s="134" t="inlineStr"><is><t xml:space="preserve">3日</t></is></c>');
    for (let row = 12; row <= 42; row += 1) {
      const marker = `r="G${row}"`;
      const markerIndex = workSheet.indexOf(marker);
      expect(markerIndex).toBeGreaterThan(-1);
      const cellStart = workSheet.lastIndexOf("<c ", markerIndex);
      const nextCell = workSheet.indexOf("<c ", markerIndex + marker.length);
      const cell = workSheet.slice(cellStart, nextCell === -1 ? workSheet.length : nextCell);
      expect(cell).not.toContain("<v>");
    }
    expect(reportSheet).toContain("<f>'作業実績表(ABC用)'!A9</f><v>46327</v>");
    expect(workSheet).not.toContain("00:60");
    expect(workSheet).toMatch(/r="E14"[^>]*>[\s\S]*?<v>115<\/v>/);
    expect(workSheet).toMatch(/r="F14"[^>]*>[\s\S]*?<f t="shared" si="1"\/><v>745<\/v>/);
    expect(workSheet).toMatch(/r="F43"[^>]*>[\s\S]*?<f t="shared" si="1"\/><v>745<\/v>/);
    expect(workSheet).toMatch(/r="K43"[^>]*>[\s\S]*?<f>SUM\(K12:K42\)<\/f><v>465<\/v>/);
    expect(workbook).not.toHaveProperty("xl/calcChain.xml");
    expect(workSheet).toContain('r="F12" s="82"><f t="shared" ref="F12:F43" si="1">');
    expect(workSheet).toContain('r="F14" s="82"><f t="shared" si="1"/>');
    expect(workbookXml).toMatch(/name="作業報告書 \(サンプル\)"[^>]*state="hidden"/);
    expect(workbookXml).toMatch(/name="立替金明細書"[^>]*state="hidden"/);
    expect(workbookXml).toMatch(/name="領収書添付用紙"[^>]*state="hidden"/);
    expect(workbookXml).toMatch(/name="作業報告書"[^>]*state="hidden"/);
  });

  it.skipIf(!existsSync("D:/yusuke/ダウンロード/作業報告書・作業実績報告書(SP用)Ver2.2.xlsx"))("writes one-hour breaks as HHMM 100 and keeps notes in G:H", () => {
    const template = readFileSync("D:/yusuke/ダウンロード/作業報告書・作業実績報告書(SP用)Ver2.2.xlsx");
    const workbook = unzipSync(createAttendanceWorkbookFromTemplate(template, {
      format: "sp_report",
      month: "2026-11",
      generatedAt: "2026-11-20T06:00:00.000Z",
      profile: { display_name: "テスト利用者", company_name: "ABC", project_name: "案件" },
      entries: [
        { work_date: "2026-11-01", start_time: "09:00", end_time: "18:00", break_minutes: 60, note: "備考" },
      ],
      leaveRequests: [],
      expenses: [],
      report: null,
      displayName: "テスト利用者",
    }));
    const workSheet = strFromU8(workbook["xl/worksheets/sheet1.xml"]);
    expect(workSheet).toMatch(/r="E12"[^>]*>[\s\S]*?<v>100<\/v>/);
    expect(workSheet).toMatch(/r="F43"[^>]*>[\s\S]*?<f t="shared" si="1"\/><v>800<\/v>/);
    expect(workSheet).toMatch(/r="K43"[^>]*>[\s\S]*?<f>SUM\(K12:K42\)<\/f><v>480<\/v>/);
    expect(workSheet).toMatch(/<c r="G12"[^>]*t="inlineStr"><is><t xml:space="preserve">備考<\/t><\/is><\/c>/);
    expect(workSheet).not.toMatch(/r="G12"[^>]*>[^<]*<f/);
  });

  it.skipIf(!existsSync("D:/yusuke/ダウンロード/作業報告書・作業実績報告書(SP用)Ver2.2.xlsx"))("maps available expense fields without retaining template samples", () => {
    const template = readFileSync("D:/yusuke/ダウンロード/作業報告書・作業実績報告書(SP用)Ver2.2.xlsx");
    const workbook = unzipSync(createAttendanceWorkbookFromTemplate(template, {
      format: "sp_report",
      month: "2026-11",
      generatedAt: "2026-11-20T06:00:00.000Z",
      profile: { display_name: "テスト利用者", company_name: "ABC" },
      entries: [],
      leaveRequests: [],
      expenses: [{ expense_date: "2026-11-04", category: "交通費", amount: 1200, description: "客先訪問" }],
      report: null,
      displayName: "テスト利用者",
    }));
    const expenseSheet = strFromU8(workbook["xl/worksheets/sheet4.xml"]);
    const workbookXml = strFromU8(workbook["xl/workbook.xml"]);
    expect(expenseSheet).toContain('r="A11"');
    expect(expenseSheet).toContain('r="C11"');
    expect(expenseSheet).toContain("客先訪問");
    expect(expenseSheet).toContain('r="X11"');
    expect(expenseSheet).toContain('r="AA11"');
    expect(expenseSheet).toMatch(/r="AB11"[^>]*>[\s\S]*?<f[^>]*(?:\/>|>[\s\S]*?<\/f>)[\s\S]*?<v>1200<\/v>/);
    expect(expenseSheet).toMatch(/r="AE11"[^>]*t="str"[^>]*>[\s\S]*?<f[^>]*(?:\/>|>[\s\S]*?<\/f>)[\s\S]*?<v><\/v>/);
    expect(expenseSheet).toMatch(/r="AB45"[^>]*>[\s\S]*?<f[^>]*(?:\/>|>[\s\S]*?<\/f>)[\s\S]*?<v>1200<\/v>/);
    expect(expenseSheet).not.toContain("大阪");
    expect(workbookXml).not.toMatch(/name="立替金明細書"[^>]*state="hidden"/);
    expect(workbookXml).toMatch(/name="立替金明細書\(No2\)"[^>]*state="hidden"/);
    expect(workbookXml).toMatch(/name="立替金明細書\(No3\)"[^>]*state="hidden"/);
    expect(workbookXml).not.toMatch(/name="領収書添付用紙"[^>]*state="hidden"/);
  });

  it.skipIf(!existsSync("D:/yusuke/ダウンロード/作業報告書・作業実績報告書(SP用)Ver2.2.xlsx"))("keeps overtime-only comments out of the monthly report sheet", () => {
    const template = readFileSync("D:/yusuke/ダウンロード/作業報告書・作業実績報告書(SP用)Ver2.2.xlsx");
    const workbook = unzipSync(createAttendanceWorkbookFromTemplate(template, {
      format: "sp_report",
      month: "2026-11",
      generatedAt: "2026-11-20T06:00:00.000Z",
      profile: { display_name: "テスト利用者" },
      entries: [],
      leaveRequests: [],
      expenses: [],
      report: { summary: "", achievements: "   ", next_steps: null, overtime_comment: "残業なし" },
      displayName: "テスト利用者",
    }));
    const workbookXml = strFromU8(workbook["xl/workbook.xml"]);
    expect(workbookXml).toMatch(/name="作業報告書"[^>]*state="hidden"/);
  });

  it("preserves the template package including macros and uses the attached filename format", () => {
    const styleXfs = Array.from({ length: 23 }, (_, index) => `<xf fontId="${index === 20 ? 1 : 0}" fillId="0" borderId="0" numFmtId="0"/>`).join("");
    const template = zipSync({
      "[Content_Types].xml": strToU8("<Types><Override PartName=\"/xl/vbaProject.bin\" ContentType=\"application/vnd.ms-office.vbaProject\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.ms-excel.sheet.macroEnabled.main+xml\"/></Types>"),
      "xl/vbaProject.bin": new Uint8Array([1, 2, 3]),
      "xl/styles.xml": strToU8(`<styleSheet><fonts count="2"><font><sz val="11"/></font><font><strike/><sz val="11"/></font></fonts><cellXfs count="23">${styleXfs}</cellXfs></styleSheet>`),
      "xl/workbook.xml": strToU8("<workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"勤務表（入力用）\" sheetId=\"3\" r:id=\"rId3\"/><sheet name=\"勤務表（会社提出用）\" sheetId=\"4\" r:id=\"rId4\"/></sheets><definedNames><definedName name=\"KeepMe\">'勤務表（入力用）'!$D$26</definedName></definedNames></workbook>"),
      "xl/_rels/workbook.xml.rels": strToU8("<Relationships><Relationship Id=\"rId3\" Target=\"worksheets/sheet3.xml\"/><Relationship Id=\"rId4\" Target=\"worksheets/sheet4.xml\"/><Relationship Type=\"http://schemas.microsoft.com/office/2006/relationships/vbaProject\"/></Relationships>"),
      "xl/worksheets/sheet1.xml": strToU8("<worksheet><sheetData><row r=\"1\"><c r=\"A1\" s=\"4\"><v>0</v></c><c r=\"H1\" s=\"5\"><v>0</v></c></row></sheetData></worksheet>"),
      "xl/worksheets/sheet4.xml": strToU8("<worksheet><sheetData><row r=\"16\"><c r=\"C16\" s=\"20\" t=\"str\"><f>IF('勤務表（入力用）'!D9=\"\",\"\",'勤務表（入力用）'!D9)</f><v/></c><c r=\"F16\" s=\"20\" t=\"str\"><f>IF('勤務表（入力用）'!D13=\"\",\"\",'勤務表（入力用）'!D13)</f><v/></c><c r=\"M16\" s=\"21\" t=\"inlineStr\"><is><t>提出用の既存文字</t></is></c></row><row r=\"18\"><c r=\"M18\" s=\"22\"><f>SUM(M16)</f><v>99</v></c></row><row r=\"46\"><c r=\"M46\" s=\"21\" t=\"inlineStr\"><is><t>末尾文字</t></is></c></row></sheetData></worksheet>"),
      "xl/worksheets/sheet3.xml": strToU8("<worksheet><sheetData><row r=\"5\"><c r=\"A5\" s=\"4\"><v>0</v></c><c r=\"B5\" s=\"6\"><v>0</v></c><c r=\"C5\" s=\"7\"><v>0</v></c><c r=\"D5\" s=\"8\"><v>0</v></c><c r=\"K5\" s=\"9\"><v>0</v></c><c r=\"P5\" s=\"10\"><v>0</v></c><c r=\"Z5\" s=\"99\" t=\"inlineStr\"><is><t>既存データ</t></is></c></row><row r=\"9\"><c r=\"D9\" s=\"13\"><v>145</v></c><c r=\"AA9\" s=\"13\"/><c r=\"E9\" s=\"13\" t=\"inlineStr\"><is><t>前回の残存データ</t></is></c></row><row r=\"10\"><c r=\"D10\" s=\"11\"><v>900</v></c></row><row r=\"12\"><c r=\"D12\" s=\"12\"><v>2300</v></c></row><row r=\"13\"><c r=\"D13\" s=\"14\"><v>0.5</v></c><c r=\"E13\" s=\"14\"><v>0</v></c></row><row r=\"14\"><c r=\"D14\" s=\"14\"><v>0.5</v></c><c r=\"E14\" s=\"14\"><v>0</v></c></row><row r=\"15\"><c r=\"D15\" s=\"18\"><f>SUM(D9)</f><v>99</v></c></row><row r=\"18\"><c r=\"D18\" s=\"14\"><v>0.10416666666666669</v></c></row><row r=\"26\"><c r=\"D26\" s=\"15\"><f>KeepMe</f><v>99</v></c><c r=\"E26\" s=\"15\"><f t=\"shared\" si=\"42\"/><v>123</v></c></row></sheetData></worksheet>"),
    });
    const workbook = unzipSync(createAttendanceWorkbookFromTemplate(template, {
      format: "abcs_regular",
      month: "2026-11",
      generatedAt: "2026-11-17T06:00:00.000Z",
      profile: { display_name: "相澤友佑", employee_code: "553", company_name: "ABC" },
      entries: [{ work_date: "2026-11-01", start_time: "09:00", end_time: "17:30", break_minutes: 75, ordinary_break_minutes: 60, night_break_minutes: 15, project_name: "案件A", note: "初回提出" }, { work_date: "2026-11-02", start_time: "09:00", end_time: "17:30", ordinary_break_minutes: "", night_break_minutes: "", project_name: "案件B", note: "" }, { work_date: "2026-11-04", start_time: "09:00", end_time: "17:30", break_minutes: 30, ordinary_break_minutes: 0, night_break_minutes: 0, project_name: "案件C", note: "" }],
      leaveRequests: [],
      expenses: [],
      report: null,
      displayName: "相澤友佑",
    }));

    expect(workbook["xl/vbaProject.bin"]).toEqual(new Uint8Array([1, 2, 3]));
    expect(strFromU8(workbook["[Content_Types].xml"])).toContain("macroEnabled.main+xml");
    expect(strFromU8(workbook["xl/workbook.xml"])).toContain('fullCalcOnLoad="1"');
    expect(strFromU8(workbook["xl/workbook.xml"])).toContain('calcMode="auto"');
    expect(strFromU8(workbook["xl/workbook.xml"])).toContain('forceFullCalc="1"');
    expect(strFromU8(workbook["xl/workbook.xml"])).toContain("name=\"KeepMe\"");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("相澤友佑");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("s=\"11\"");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("r=\"D9\"");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="D13" s="14"><v>100</v>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="D14" s="14"><v>15</v>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="E13" s="14"><v>0</v>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="E14" s="14"><v>0</v>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="G13"><v>30</v>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("既存データ");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="D26" s="15"><f>KeepMe</f><v>99</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="E26" s="15"><f t="shared" si="42"/><v>123</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="D15" s="18"><f>SUM(D9)</f><v>0.3020833333333333</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).not.toContain("前回の残存データ");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="E9" s="13"');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toMatch(/r="AA9" s="13"/);
    expect(new DOMParser().parseFromString(strFromU8(workbook["xl/worksheets/sheet3.xml"]), "application/xml").getElementsByTagName("parsererror").length).toBe(0);
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="M16" s="21" t="inlineStr"><is><t xml:space="preserve">初回提出</t></is></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).not.toContain("末尾文字");
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="M18" s="22"><f>SUM(M16)</f><v>0</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="C16" s="20" t="str"><f>IF(\'勤務表（入力用）\'!D9="","",\'勤務表（入力用）\'!D9)</f><v></v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="F16" s="20"><f>IF(\'勤務表（入力用）\'!D13="","",\'勤務表（入力用）\'!D13)</f><v>100</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toMatch(/r="F16" s="20"/);
    expect(strFromU8(workbook["xl/styles.xml"])).toContain("<strike/>");
    expect(strFromU8(workbook["xl/styles.xml"])).toMatch(/<fonts count="2">[\s\S]*<font><strike\/><sz val="11"\/><\/font><\/fonts>/);
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).not.toContain("<v/><v>");

    const emptyWorkbook = unzipSync(createAttendanceWorkbookFromTemplate(template, {
      format: "abcs_regular", month: "2026-11", generatedAt: "2026-11-17T06:00:00.000Z",
      profile: { display_name: "相澤友佑", employee_code: "553", company_name: "ABC" },
      entries: [], leaveRequests: [], expenses: [], report: null, displayName: "相澤友佑",
    }));
    const emptyInputSheet = strFromU8(emptyWorkbook["xl/worksheets/sheet3.xml"]);
    expect(emptyInputSheet).not.toContain('r="D9" s="13"><v>145</v>');
    expect(emptyInputSheet).not.toContain('r="D10" s="11"><v>900</v>');
    expect(emptyInputSheet).not.toContain('r="D12" s="12"><v>2300</v>');
    expect(emptyInputSheet).not.toContain('r="D13" s="14"><v>0.5</v>');
    expect(emptyInputSheet).not.toContain('r="D14" s="14"><v>0.5</v>');
    expect(attendanceFilename("abcs_regular", "2026-11", "相澤友佑")).toBe("ABCS正社員（普通）勤務表11月(相澤友佑).xlsx");
    expect(attendanceFilename("abcs_regular", "2026-11", "相澤友佑", "ABCS正社員（普通）勤務表.xlsm")).toBe("ABCS正社員（普通）勤務表11月(相澤友佑).xlsm");
  });
});
