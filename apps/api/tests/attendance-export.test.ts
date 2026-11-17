import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { attendanceFilename, createAttendanceWorkbookFromTemplate } from "../src/attendance/export";

describe("attendance workbook export", () => {
  it("preserves the template package including macros and uses the attached filename format", () => {
    const template = zipSync({
      "[Content_Types].xml": strToU8("<Types><Override PartName=\"/xl/vbaProject.bin\" ContentType=\"application/vnd.ms-office.vbaProject\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.ms-excel.sheet.macroEnabled.main+xml\"/></Types>"),
      "xl/vbaProject.bin": new Uint8Array([1, 2, 3]),
      "xl/_rels/workbook.xml.rels": strToU8("<Relationships><Relationship Type=\"http://schemas.microsoft.com/office/2006/relationships/vbaProject\"/></Relationships>"),
      "xl/worksheets/sheet1.xml": strToU8("<worksheet><sheetData><row r=\"1\"><c r=\"A1\" s=\"4\"><v>0</v></c><c r=\"H1\" s=\"5\"><v>0</v></c></row></sheetData></worksheet>"),
      "xl/worksheets/sheet3.xml": strToU8("<worksheet><sheetData><row r=\"5\"><c r=\"A5\" s=\"4\"><v>0</v></c><c r=\"B5\" s=\"6\"><v>0</v></c><c r=\"C5\" s=\"7\"><v>0</v></c><c r=\"D5\" s=\"8\"><v>0</v></c><c r=\"K5\" s=\"9\"><v>0</v></c><c r=\"P5\" s=\"10\"><v>0</v></c></row><row r=\"9\"><c r=\"D9\" s=\"13\"><v>0</v></c></row><row r=\"10\"><c r=\"D10\" s=\"11\"><v>0</v></c></row><row r=\"12\"><c r=\"D12\" s=\"12\"><v>0</v></c></row><row r=\"13\"><c r=\"D13\" s=\"14\"><v>0</v></c></row></sheetData></worksheet>"),
    });
    const workbook = unzipSync(createAttendanceWorkbookFromTemplate(template, {
      format: "abcs_regular",
      month: "2026-11",
      generatedAt: "2026-11-17T06:00:00.000Z",
      profile: { display_name: "相澤友佑", employee_code: "553", company_name: "ABC" },
      entries: [{ work_date: "2026-11-01", start_time: "09:00", end_time: "17:30", break_minutes: 60, project_name: "案件A", note: "" }],
      leaveRequests: [],
      expenses: [],
      report: null,
      displayName: "相澤友佑",
    }));

    expect(workbook["xl/vbaProject.bin"]).toEqual(new Uint8Array([1, 2, 3]));
    expect(strFromU8(workbook["[Content_Types].xml"])).toContain("macroEnabled.main+xml");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("相澤友佑");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("s=\"11\"");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("r=\"D9\"");
    expect(strFromU8(workbook["xl/worksheets/sheet3.xml"])).toContain("案件A");
    expect(attendanceFilename("abcs_regular", "2026-11", "相澤友佑")).toBe("ABCS正社員（普通）勤務表11月(相澤友佑).xlsx");
    expect(attendanceFilename("abcs_regular", "2026-11", "相澤友佑", "ABCS正社員（普通）勤務表.xlsm")).toBe("ABCS正社員（普通）勤務表11月(相澤友佑).xlsm");
  });
});
