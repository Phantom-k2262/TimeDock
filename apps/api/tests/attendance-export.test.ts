import { describe, expect, it, vi } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { attendanceFilename, createAttendanceWorkbookFromTemplate, validateAbcsAttendanceExport } from "../src/attendance/export";

describe("attendance workbook export", () => {
  it("continues XLSM generation when Workers metric APIs throw", () => {
    const cpuUsage = vi.spyOn(process, "cpuUsage").mockImplementation(() => {
      throw new Error("The process.cpuUsage method is not implemented");
    });
    const memoryUsage = vi.spyOn(process, "memoryUsage").mockImplementation(() => {
      throw new Error("The process.memoryUsage method is not implemented");
    });
    try {
      const template = zipSync({
        "[Content_Types].xml": strToU8("<Types><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.ms-excel.sheet.macroEnabled.main+xml\"/></Types>"),
        "xl/workbook.xml": strToU8("<workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"勤務表（入力用）\" sheetId=\"3\" r:id=\"rId3\"/><sheet name=\"勤務表（会社提出用）\" sheetId=\"4\" r:id=\"rId4\"/></sheets></workbook>"),
        "xl/_rels/workbook.xml.rels": strToU8("<Relationships><Relationship Id=\"rId3\" Target=\"worksheets/sheet3.xml\"/><Relationship Id=\"rId4\" Target=\"worksheets/sheet4.xml\"/></Relationships>"),
        "xl/worksheets/sheet3.xml": strToU8("<worksheet><sheetData><row r=\"5\"><c r=\"A5\"><v>0</v></c></row></sheetData></worksheet>"),
        "xl/worksheets/sheet4.xml": strToU8("<worksheet><sheetData/></worksheet>"),
      });
      expect(() => createAttendanceWorkbookFromTemplate(template, {
        format: "abcs_regular", month: "2026-11", generatedAt: "2026-11-17T06:00:00.000Z",
        profile: { display_name: "テスト", employee_code: "1" }, entries: [], leaveRequests: [], expenses: [], report: null, displayName: "テスト",
      })).not.toThrow();
    } finally {
      cpuUsage.mockRestore();
      memoryUsage.mockRestore();
    }
  });

  it("preserves the template package including macros and uses the attached filename format", () => {
    const template = zipSync({
      "[Content_Types].xml": strToU8("<Types><Override PartName=\"/xl/vbaProject.bin\" ContentType=\"application/vnd.ms-office.vbaProject\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.ms-excel.sheet.macroEnabled.main+xml\"/></Types>"),
      "xl/vbaProject.bin": new Uint8Array([1, 2, 3]),
      "xl/workbook.xml": strToU8("<workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"勤務表（入力用）\" sheetId=\"3\" r:id=\"rId3\"/><sheet name=\"勤務表（会社提出用）\" sheetId=\"4\" r:id=\"rId4\"/></sheets><definedNames><definedName name=\"KeepMe\">'勤務表（入力用）'!$D$26</definedName></definedNames></workbook>"),
      "xl/_rels/workbook.xml.rels": strToU8("<Relationships><Relationship Id=\"rId3\" Target=\"worksheets/sheet3.xml\"/><Relationship Id=\"rId4\" Target=\"worksheets/sheet4.xml\"/><Relationship Type=\"http://schemas.microsoft.com/office/2006/relationships/vbaProject\"/></Relationships>"),
      "xl/worksheets/sheet1.xml": strToU8("<worksheet><sheetData><row r=\"1\"><c r=\"A1\" s=\"4\"><v>0</v></c><c r=\"H1\" s=\"5\"><v>0</v></c></row></sheetData></worksheet>"),
      "xl/worksheets/sheet4.xml": strToU8("<worksheet><sheetData><row r=\"1\"><c r=\"A1\" s=\"547\" t=\"inlineStr\"><is><t>ABCSシステム正社員（普通）勤務表</t></is></c><c r=\"B1\" s=\"1\"><v>0</v></c><c r=\"L1\" s=\"549\" t=\"inlineStr\"><is><t>未確認データ</t></is></c></row><row r=\"3\"><c r=\"B3\" s=\"23\" t=\"str\"><f>IF('勤務表（入力用）'!A5&lt;&gt;0,'勤務表（入力用）'!A5,\"\")</f><v/></c></row><row r=\"16\"><c r=\"C16\" s=\"20\" t=\"str\"><f>IF('勤務表（入力用）'!D9=\"\",\"\",'勤務表（入力用）'!D9)</f><v/></c><c r=\"D16\" s=\"24\" t=\"str\"><f>IF('勤務表（入力用）'!D10=\"\",\"\",'勤務表（入力用）'!D10)</f><v/></c><c r=\"M16\" s=\"21\" t=\"inlineStr\"><is><t>提出用の既存文字</t></is></c></row><row r=\"18\"><c r=\"M18\" s=\"22\"><f>SUM(M16)</f><v>99</v></c></row><row r=\"19\"><c r=\"Q19\" s=\"21\"><v>0</v></c></row><row r=\"46\"><c r=\"M46\" s=\"21\" t=\"inlineStr\"><is><t>末尾文字</t></is></c></row></sheetData></worksheet>"),
      "xl/worksheets/sheet3.xml": strToU8("<worksheet><sheetData><row r=\"5\"><c r=\"A5\" s=\"4\"><v>0</v></c><c r=\"B5\" s=\"6\"><v>0</v></c><c r=\"C5\" s=\"7\"><v>0</v></c><c r=\"D5\" s=\"8\"><v>0</v></c><c r=\"K5\" s=\"9\"><v>0</v></c><c r=\"P5\" s=\"10\"><v>0</v></c><c r=\"Z5\" s=\"99\" t=\"inlineStr\"><is><t>既存データ</t></is></c></row><row r=\"7\"><c r=\"D7\" s=\"161\"><f>$A$5</f><v>0</v></c><c r=\"E7\" s=\"161\"><f t=\"shared\" si=\"0\"><![CDATA[IF(D7=\"\",\"\",IF(MONTH(D7)=MONTH(D7+1),D7+1,\"\"))]]></f><v>1</v></c><c r=\"AH7\" s=\"162\"><f t=\"shared\" si=\"2\"/><v>30</v></c></row><row r=\"8\"><c r=\"D8\" s=\"102\"><f t=\"shared\" si=\"3\">D7</f><v>0</v></c><c r=\"E8\" s=\"102\"><f t=\"shared\" si=\"3\"/><v>1</v></c></row><row r=\"9\"><c r=\"D9\" s=\"13\"><v>145</v></c><c r=\"AA9\" s=\"13\"/><c r=\"E9\" s=\"13\" t=\"inlineStr\"><is><t>前回の残存データ</t></is></c></row><row r=\"10\"><c r=\"D10\" s=\"11\"><v>900</v></c></row><row r=\"12\"><c r=\"D12\" s=\"12\"><v>2300</v></c></row><row r=\"13\"><c r=\"D13\" s=\"14\"><v>0.5</v></c><c r=\"E13\" s=\"14\"><v>0</v></c></row><row r=\"14\"><c r=\"D14\" s=\"14\"><v>0.5</v></c><c r=\"E14\" s=\"14\"><v>0</v></c></row><row r=\"15\"><c r=\"D15\" s=\"18\"><f>勤務時間(D61:D66,ｺｰﾄﾞ表)</f><v>99</v></c></row><row r=\"26\"><c r=\"D26\" s=\"15\"><f>KeepMe</f><v>99</v></c><c r=\"E26\" s=\"15\"><f t=\"shared\" si=\"42\"/><v>123</v></c></row></sheetData></worksheet>"),
    });
    const sourceSubmissionSheet = strFromU8(unzipSync(template)["xl/worksheets/sheet4.xml"]);
    const workbook = unzipSync(createAttendanceWorkbookFromTemplate(template, {
      format: "abcs_regular",
      month: "2026-11",
      generatedAt: "2026-11-17T06:00:00.000Z",
      profile: { display_name: "相澤友佑", employee_code: "553", company_name: "ABC" },
      entries: [{ work_date: "2026-11-01", start_time: "09:00", end_time: "17:30", break_minutes: 60, ordinary_break_minutes: 0, night_break_minutes: 0, project_name: "案件A", note: "初回提出" }, { work_date: "2026-11-02", start_time: "09:00", end_time: "17:30", ordinary_break_minutes: "", night_break_minutes: "", project_name: "案件B", note: "" }, { work_date: "2026-11-04", start_time: "09:00", end_time: "17:30", work_code: "T", break_minutes: 30, ordinary_break_minutes: 0, night_break_minutes: 0, project_name: "案件C", note: "" }],
      leaveRequests: [],
      expenses: [],
      report: null,
      submissionReady: true,
      validationWarnings: ["2026-11-04：実労働8時間超・休憩1時間未満です。"],
      displayName: "相澤友佑",
    }));

    expect(workbook["xl/vbaProject.bin"]).toEqual(new Uint8Array([1, 2, 3]));
    expect(strFromU8(workbook["[Content_Types].xml"])).toContain("macroEnabled.main+xml");
    expect(strFromU8(workbook["xl/workbook.xml"])).toContain('fullCalcOnLoad="1"');
    expect(strFromU8(workbook["xl/workbook.xml"])).toContain('calcMode="auto"');
    expect(strFromU8(workbook["xl/workbook.xml"])).toContain('calcCompleted="0"');
    expect(strFromU8(workbook["xl/workbook.xml"])).toContain('forceFullCalc="1"');
    expect(strFromU8(workbook["xl/workbook.xml"])).toContain('calcOnSave="1"');
    expect(strFromU8(workbook["xl/workbook.xml"])).toContain("name=\"KeepMe\"");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("相澤友佑");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="D7" s="161"><f>$A$5</f><v>46327</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="E7" s="161"><f t="shared" si="0"><![CDATA[IF(D7="","",IF(MONTH(D7)=MONTH(D7+1),D7+1,""))]]></f><v>46328</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="D8" s="102"><f t="shared" si="3">D7</f><v>46327</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("s=\"11\"");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("r=\"D9\"");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="D13" s="14"><v>100</v>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).not.toContain("0.041666666666666664");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="E13" s="14"><v>0</v>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="E14" s="14"><v>0</v>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="G13"><v>30</v>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).not.toContain("0.020833333333333332");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("既存データ");
    // D26/E26 do not depend on any written input. Their existing caches must
    // survive; Excel recalculation flags are not a reason to discard them.
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="D26" s="15"><f>KeepMe</f><v>99</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="E26" s="15"><f t="shared" si="42"/><v>123</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="D15" s="18"><f>勤務時間(D61:D66,ｺｰﾄﾞ表)</f><v>0.3125</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).not.toContain("前回の残存データ");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="E9" s="13"');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="AA9" s="13" t="inlineStr"><is><t xml:space="preserve"></t></is></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="D9" s="13" t="inlineStr"><is><t xml:space="preserve"></t></is></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain('r="G9" t="inlineStr"><is><t xml:space="preserve">T</t></is></c>');
    expect(new DOMParser().parseFromString(strFromU8(workbook["xl/worksheets/sheet3.xml"]), "application/xml").getElementsByTagName("parsererror").length).toBe(0);
    expect(new DOMParser().parseFromString(strFromU8(workbook["xl/worksheets/sheet4.xml"]), "application/xml").getElementsByTagName("parsererror").length).toBe(0);
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="M16" s="21" t="inlineStr"><is><t xml:space="preserve">初回提出</t></is></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="B3" s="23"><f>IF(\'勤務表（入力用）\'!A5&lt;&gt;0,\'勤務表（入力用）\'!A5,"")</f><v>46327</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="D16" s="24"><f>IF(\'勤務表（入力用）\'!D10="","",\'勤務表（入力用）\'!D10)</f><v>900</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="L1" s="549"><v></v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).not.toContain("未確認データ");
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).not.toContain('r="B1" s="1" t="inlineStr"');
    const outputSubmissionSheet = strFromU8(workbook["xl/worksheets/sheet4.xml"]);
    for (const reference of ["A1", "B1"]) {
      const sourceCell = sourceSubmissionSheet.match(new RegExp(`<c r="${reference}"[\\s\\S]*?<\\/c>|<c r="${reference}"[^>]*/>`))?.[0];
      expect(sourceCell).toBeTruthy();
      expect(outputSubmissionSheet).toContain(sourceCell!);
    }
    expect(outputSubmissionSheet).toContain('r="A1" s="547" t="inlineStr"><is><t>ABCSシステム正社員（普通）勤務表</t></is></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="Q19" s="21" t="inlineStr"><is><t xml:space="preserve">休憩1時間未満</t></is></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).not.toContain("末尾文字");
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="M18" s="22"><f>SUM(M16)</f><v>0</v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).toContain('r="C16" s="20" t="str"><f>IF(\'勤務表（入力用）\'!D9="","",\'勤務表（入力用）\'!D9)</f><v></v></c>');
    expect(strFromU8(workbook["xl/worksheets/sheet4.xml"])).not.toContain("<v/><v>");

    const emptyWorkbook = unzipSync(createAttendanceWorkbookFromTemplate(template, {
      format: "abcs_regular", month: "2026-11", generatedAt: "2026-11-17T06:00:00.000Z",
      profile: { display_name: "相澤友佑", employee_code: "553", company_name: "ABC" },
      entries: [], leaveRequests: [], expenses: [], report: null, displayName: "相澤友佑",
    }));
    const emptyInputSheet = strFromU8(emptyWorkbook["xl/worksheets/sheet3.xml"]);
    const emptySubmissionSheet = strFromU8(emptyWorkbook["xl/worksheets/sheet4.xml"]);
    expect(emptySubmissionSheet).not.toContain("未確認データ");
    expect(emptyInputSheet).not.toContain('r="D9" s="13"><v>145</v>');
    expect(emptyInputSheet).not.toContain('r="D10" s="11"><v>900</v>');
    expect(emptyInputSheet).not.toContain('r="D12" s="12"><v>2300</v>');
    expect(emptyInputSheet).not.toContain('r="D13" s="14"><v>0.5</v>');
    expect(emptyInputSheet).not.toContain('r="D14" s="14"><v>0.5</v>');
    expect(emptyInputSheet).toContain('r="D9" s="13" t="inlineStr"><is><t xml:space="preserve">*</t></is></c>');
    expect(emptySubmissionSheet).not.toContain("提出用の既存文字");
    expect(emptySubmissionSheet).not.toContain("末尾文字");
    expect(attendanceFilename("abcs_regular", "2026-11", "相澤友佑")).toBe("ABCS正社員（普通）勤務表11月(相澤友佑).xlsx");
    expect(attendanceFilename("abcs_regular", "2026-11", "相澤友佑", "ABCS正社員（普通）勤務表.xlsm")).toBe("ABCS正社員（普通）勤務表11月(相澤友佑).xlsm");
  });

  it("separates blocking input errors from the final break-time warning", () => {
    const result = validateAbcsAttendanceExport({ employee_code: "12345", name_kana: "テスト", display_name: "テスト", division_name: "事業部", department_name: "部署" }, [
      { work_date: "2026-11-02", start_time: "09:00", end_time: "18:00", ordinary_break_minutes: 30, night_break_minutes: 0, work_code: "", note: "" },
    ], "2026-11", "業務都合のため対応しました");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(["2026-11-02：実労働8時間超・休憩1時間未満です。"]);

    const missingOvertimeComment = validateAbcsAttendanceExport({ employee_code: "12345", name_kana: "テスト", display_name: "テスト", division_name: "事業部", department_name: "部署" }, [
      { work_date: "2026-11-02", start_time: "09:00", end_time: "18:00", ordinary_break_minutes: 30, night_break_minutes: 0, work_code: "", note: "" },
    ], "2026-11");
    expect(missingOvertimeComment.errors).toContain("当月残業時間があるため、勤務表の当月残業時間コメントを入力してください。");

    const invalid = validateAbcsAttendanceExport({ employee_code: "12345", name_kana: "テスト", display_name: "テスト", division_name: "事業部", department_name: "部署" }, [
      { work_date: "2026-11-02", start_time: "09:00", end_time: "17:30", ordinary_break_minutes: 60, night_break_minutes: 0, work_code: "T", note: "" },
    ], "2026-11");
    expect(invalid.errors).toContain("2026-11-02：この勤務種類には開始・終了時刻を入力できません。");
  });
});
