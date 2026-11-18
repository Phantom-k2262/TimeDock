import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { attendanceFilename, createAttendanceWorkbookFromTemplate } from "../src/attendance/export";

describe("attendance workbook export", () => {
  it("preserves the template package including macros and uses the attached filename format", () => {
    const template = zipSync({
      "[Content_Types].xml": strToU8("<Types><Override PartName=\"/xl/vbaProject.bin\" ContentType=\"application/vnd.ms-office.vbaProject\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.ms-excel.sheet.macroEnabled.main+xml\"/></Types>"),
      "xl/vbaProject.bin": new Uint8Array([1, 2, 3]),
      "xl/workbook.xml": strToU8("<workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"勤務表（入力用）\" sheetId=\"3\" r:id=\"rId3\"/><sheet name=\"勤務表（会社提出用）\" sheetId=\"4\" r:id=\"rId4\"/></sheets><definedNames><definedName name=\"KeepMe\">'勤務表（入力用）'!$D$26</definedName></definedNames></workbook>"),
      "xl/_rels/workbook.xml.rels": strToU8("<Relationships><Relationship Id=\"rId3\" Target=\"worksheets/sheet3.xml\"/><Relationship Id=\"rId4\" Target=\"worksheets/sheet4.xml\"/><Relationship Type=\"http://schemas.microsoft.com/office/2006/relationships/vbaProject\"/></Relationships>"),
      "xl/worksheets/sheet1.xml": strToU8("<worksheet><sheetData><row r=\"1\"><c r=\"A1\" s=\"4\"><v>0</v></c><c r=\"H1\" s=\"5\"><v>0</v></c></row></sheetData></worksheet>"),
      "xl/worksheets/sheet4.xml": strToU8("<worksheet><sheetData><row r=\"16\"><c r=\"C16\" s=\"20\" t=\"str\"><f>IF('勤務表（入力用）'!D9=\"\",\"\",'勤務表（入力用）'!D9)</f><v/></c><c r=\"M16\" s=\"21\" t=\"inlineStr\"><is><t>提出用の既存文字</t></is></c></row><row r=\"18\"><c r=\"M18\" s=\"22\"><f>SUM(M16)</f><v>99</v></c></row><row r=\"46\"><c r=\"M46\" s=\"21\" t=\"inlineStr\"><is><t>末尾文字</t></is></c></row></sheetData></worksheet>"),
      "xl/worksheets/sheet3.xml": strToU8("<worksheet><sheetData><row r=\"5\"><c r=\"A5\" s=\"4\"><v>0</v></c><c r=\"B5\" s=\"6\"><v>0</v></c><c r=\"C5\" s=\"7\"><v>0</v></c><c r=\"D5\" s=\"8\"><v>0</v></c><c r=\"K5\" s=\"9\"><v>0</v></c><c r=\"P5\" s=\"10\"><v>0</v></c><c r=\"Z5\" s=\"99\" t=\"inlineStr\"><is><t>既存データ</t></is></c></row><row r=\"9\"><c r=\"D9\" s=\"13\"><v>145</v></c><c r=\"AA9\" s=\"13\"/><c r=\"E9\" s=\"13\" t=\"inlineStr\"><is><t>前回の残存データ</t></is></c></row><row r=\"10\"><c r=\"D10\" s=\"11\"><v>900</v></c></row><row r=\"12\"><c r=\"D12\" s=\"12\"><v>2300</v></c></row><row r=\"13\"><c r=\"D13\" s=\"14\"><v>0.5</v></c><c r=\"E13\" s=\"14\"><v>0</v></c></row><row r=\"14\"><c r=\"D14\" s=\"14\"><v>0.5</v></c><c r=\"E14\" s=\"14\"><v>0</v></c></row><row r=\"15\"><c r=\"D15\" s=\"18\"><f>SUM(D9)</f><v>99</v></c></row><row r=\"26\"><c r=\"D26\" s=\"15\"><f>KeepMe</f><v>99</v></c><c r=\"E26\" s=\"15\"><f t=\"shared\" si=\"42\"/><v>123</v></c></row></sheetData></worksheet>"),
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
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("0.041666666666666664");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("0.010416666666666666");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="E13" s="14"><v>0</v>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="E14" s="14"><v>0</v>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="G13"><v>0.020833333333333332</v>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("既存データ");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="D26" s="15"><f>KeepMe</f><v>99</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="E26" s="15"><f t="shared" si="42"/><v>123</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="D15" s="18"><f>SUM(D9)</f><v/></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).not.toContain("前回の残存データ");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="E9" s="13"');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('<c r="AA9" s="13"/>');
    expect(new DOMParser().parseFromString(strFromU8(workbook["xl/worksheets/sheet3.xml"]), "application/xml").getElementsByTagName("parsererror").length).toBe(0);
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="M16" s="21" t="inlineStr"><is><t xml:space="preserve">初回提出</t></is></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).not.toContain("末尾文字");
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="M18" s="22"><f>SUM(M16)</f><v>99</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="C16" s="20" t="str"><f>IF(\'勤務表（入力用）\'!D9="","",\'勤務表（入力用）\'!D9)</f><v>D</v></c>');
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
