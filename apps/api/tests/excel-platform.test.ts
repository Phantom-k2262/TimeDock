import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { calculateDailyAttendance } from "../src/excel/calculations";
import { classifyFormula } from "../src/excel/formulas";
import { inspectWorkbook, validateWorkbookIntegrity } from "../src/excel/workbook";

const workbook = (vba = true) => ({
  "xl/workbook.xml": strToU8(`<workbook><sheets><sheet name="入力" state="hidden" r:id="rId1"/></sheets><definedNames><definedName name="入力欄">'入力'!$A$1</definedName></definedNames></workbook>`),
  "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`),
  "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row r="1"><c r="A1"><f>勤務時間(A1:A2,ｺｰﾄﾞ表)</f><v>0</v></c><c r="B1"><f>SUM(A1)</f><v>1</v></c></row></sheetData></worksheet>`),
  ...(vba ? { "xl/vbaProject.bin": new Uint8Array([1, 2, 3]) } : {}),
});

describe("Excel platform services", () => {
  it("inspects macro, hidden-sheet, name and formula metadata without rebuilding the package", () => {
    const result = inspectWorkbook(workbook());
    expect(result.hasVbaProject).toBe(true);
    expect(result.sheets).toEqual([{ name: "入力", path: "xl/worksheets/sheet1.xml", state: "hidden" }]);
    expect(result.definedNames).toContain("入力欄");
    expect(result.formulaCount).toBe(2);
    expect(result.customFormulaCount).toBe(1);
  });

  it("fails closed when a non-permitted package part changes", () => {
    const before = workbook();
    const after = { ...before, "xl/vbaProject.bin": new Uint8Array([9, 9, 9]) };
    expect(validateWorkbookIntegrity(before, after, ["xl/worksheets/sheet1.xml"]).ok).toBe(false);
    expect(validateWorkbookIntegrity(before, { ...before, "xl/worksheets/sheet1.xml": strToU8("changed") }, ["xl/worksheets/sheet1.xml"]).ok).toBe(true);
  });

  it("keeps attendance calculation independent from Excel cell addresses", () => {
    expect(calculateDailyAttendance({ startTime: "22:00", endTime: "06:00", ordinaryBreakMinutes: 45, nightBreakMinutes: 30 })).toEqual({ ordinaryBreakMinutes: 45, nightBreakMinutes: 30, totalBreakMinutes: 75, workedMinutes: 405 });
    expect(calculateDailyAttendance({ startTime: null, endTime: null })).toMatchObject({ workedMinutes: null, totalBreakMinutes: 0 });
  });

  it("does not claim VBA or external-link formulas were evaluated", async () => {
    expect(classifyFormula("勤務時間(D61:D66,ｺｰﾄﾞ表)").status).toBe("unsupported");
    expect(classifyFormula("[other.xlsx]Sheet1!A1").status).toBe("unsupported");
    expect(classifyFormula("SUM(A1:A2)").status).toBe("deferred-to-excel");
  });

  it("keeps the ZIP editor input available for later service integration", () => {
    expect(zipSync(workbook()).length).toBeGreaterThan(0);
  });
});
