import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { calculateDailyAttendance } from "../src/excel/calculations";
import { classifyFormula } from "../src/excel/formulas";
import { inspectFormulaInventory, invalidateImpactedFormulaCaches } from "../src/excel/formulas";
import { inspectWorkbook, updateFormulaCacheXml, updateWorksheetCellXml, validateWorkbookIntegrity } from "../src/excel/workbook";
import { COUNTIF2, HMINT, INTHM, VBA_EMPTY, 時間差, 勤務時間FromRanges, 代休取得時間, 遅刻早退時間 } from "../src/excel/vba-functions";
import { CalculationValidator, DependencyResolver, metricsFor } from "../src/excel/recalculation";
import { StandardFormulaEngine } from "../src/excel/standard-formulas";
import { recalculateWorkbookFormulas } from "../src/excel/workbook-recalculation";

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

  it("updates OOXML cell values and formula caches through the DOM editor without rebuilding the package", () => {
    const xml = `<worksheet><sheetData><row r="1"><c r="A1" s="7"><f>SUM(B1)</f><v>1</v></c><c r="B1" s="8"><v>2</v></c></row></sheetData></worksheet>`;
    const updated = updateWorksheetCellXml(xml, "B1", 9, true);
    const cached = updateFormulaCacheXml(updated, "A1", 9, true);
    expect(cached).toContain('r="B1" s="8"><v>9</v></c>');
    expect(cached).toContain('r="A1" s="7"><f>SUM(B1)</f><v>9</v></c>');
    const inventory = inspectFormulaInventory({ "xl/worksheets/sheet1.xml": strToU8(cached) });
    expect(inventory.total).toBe(1);
    expect(inventory.deferredToExcel).toBe(1);
  });

  it("writes formula caches using the evaluated result type", () => {
    const xml = `<worksheet><sheetData><row r="1"><c r="A1" s="7"><f>TEXT(B1,"[h]:mm")</f><v>104</v></c><c r="B1"><v>16130</v></c></row></sheetData></worksheet>`;
    const stringCache = updateFormulaCacheXml(xml, "A1", "387120:00");
    expect(stringCache).toContain('r="A1" s="7" t="str"><f>TEXT(B1,"[h]:mm")</f><v>387120:00</v>');
    const emptyCache = updateFormulaCacheXml(xml, "A1", "");
    expect(emptyCache).toContain('r="A1" s="7" t="str"><f>TEXT(B1,"[h]:mm")</f><v></v>');
    const errorCache = updateFormulaCacheXml(xml, "A1", { kind: "error", code: "#VALUE!" });
    expect(errorCache).toContain('r="A1" s="7" t="e"><f>TEXT(B1,"[h]:mm")</f><v>#VALUE!</v>');
  });

  it("evaluates MINUTE, TEXT, and IF with Excel-compatible result types", () => {
    const engine = new StandardFormulaEngine();
    const context = new Map<string, unknown>([["B21", 104], ["B22", 103], ["B23", 16130]]);
    expect(engine.evaluate("IF(B21>=B22,\"\",\"-\")", context)).toMatchObject({ status: "evaluated", value: "" });
    expect(engine.evaluate("MINUTE(B21-B22)", context)).toMatchObject({ status: "evaluated", value: 0 });
    expect(engine.evaluate('TEXT(B23,"[h]:mm")', context)).toMatchObject({ status: "evaluated", value: "387120:00" });
  });

  it("keeps the ZIP editor input available for later service integration", () => {
    expect(zipSync(workbook()).length).toBeGreaterThan(0);
  });

  it("invalidates only formulas affected by changed inputs, including shared children", () => {
    const entries = {
      "xl/worksheets/input.xml": strToU8(`<worksheet><sheetData><row r="1"><c r="A1"><v>10</v></c><c r="B1"><v>20</v></c><c r="C1"><f t="shared" si="1" ref="C1:D1">A1</f><v>10</v></c><c r="D1"><f t="shared" si="1"/><v>10</v></c><c r="E1"><f>SUM(B1)</f><v>20</v></c><c r="F1"><f>SUM(C1)</f><v>10</v></c></row></sheetData></worksheet>`),
      "xl/worksheets/other.xml": strToU8(`<worksheet><sheetData><row r="1"><c r="A1"><v>5</v></c><c r="B1"><f>SUM(A1)</f><v>5</v></c></row></sheetData></worksheet>`),
    };
    invalidateImpactedFormulaCaches(entries, [
      { path: "xl/worksheets/input.xml", name: "入力", changed: new Set(["A1"]) },
      { path: "xl/worksheets/other.xml", name: "別", changed: new Set() },
    ]);
    const input = new TextDecoder().decode(entries["xl/worksheets/input.xml"]);
    expect(input).toContain('r="C1"><f t="shared" si="1" ref="C1:D1">A1</f><v></v></c>');
    // The child translates A1 to B1, so its cache remains valid when only A1 changes.
    expect(input).toContain('r="D1"><f t="shared" si="1"/><v>10</v></c>');
    expect(input).toContain('r="E1"><f>SUM(B1)</f><v>20</v></c>');
    expect(input).toContain('r="F1"><f>SUM(C1)</f><v></v></c>');
    expect(new TextDecoder().decode(entries["xl/worksheets/other.xml"])).toContain('<v>5</v>');
  });

  it("matches the extracted VBA time conversion and exact COUNTIF2 behavior", () => {
    expect(HMINT(0.5)).toBe(1200);
    expect(INTHM(930)).toBeCloseTo(9.5 / 24);
    expect(COUNTIF2(["*", "abc", "a*b"], "*")).toBe(1);
    expect(代休取得時間("D")).toBeCloseTo(7.75 / 24);
    expect(代休取得時間("X")).toBe(VBA_EMPTY);
    expect(遅刻早退時間({ start: 930, end: 1730, morningEnd: 900, afternoonStart: 1300 })).toBeCloseTo(0.5 / 24);
    expect(時間差(10.5 / 24, 8 / 24)).toBe(230);
    expect(時間差(8 / 24, 10.5 / 24)).toBe(-230);
    expect(時間差(10.5 / 24, 10.5 / 24)).toBe(VBA_EMPTY);
  });

  it("evaluates the supported standard subset without changing workbook XML", () => {
    const engine = new StandardFormulaEngine();
    const context = new Map<string, unknown>([["A1", 2], ["A2", 3], ["B1", "*"], ["コード表", ["A", "*", "B"]]]);
    expect(engine.evaluate("SUM(A1:A2)", context)).toMatchObject({ status: "evaluated", value: 5 });
    expect(engine.evaluate('COUNTIF(B1:B1,"*")', context)).toMatchObject({ status: "evaluated", value: 1 });
    expect(engine.evaluate("IF(A1<>0,A1+3,0)", context)).toMatchObject({ status: "evaluated", value: 5 });
    expect(engine.evaluate("DATE(2026,11,19)", context)).toMatchObject({ status: "evaluated" });
    expect(engine.evaluate('A1&"/"&A2', context)).toMatchObject({ status: "evaluated", value: "2/3" });
    expect(engine.evaluate('COUNTIF(コード表,"*")', context)).toMatchObject({ status: "evaluated", value: 1 });
    expect(engine.evaluate("勤務時間(A1:A2,ｺｰﾄﾞ表)", context).status).toBe("unsupported");
    const custom = new StandardFormulaEngine(new Map([["時間差", (left, right) => 時間差(left as number, right as number) === VBA_EMPTY ? null : 時間差(left as number, right as number)]]));
    expect(custom.evaluate("時間差(A1,A2)", context)).toMatchObject({ status: "evaluated", value: -2400 });
    expect(custom.evaluate('IF(D15="",HMINT(D74)*-1,時間差(D15,D74))', new Map([["D15", 0], ["D74", 0]])).status).toBe("evaluated");
    expect(custom.evaluate('IF(E15="",HMINT(E74)*-1,時間差(E15,E74))', new Map([["E15", 0.5416666666666666], ["E74", 0]])).value).toBe(1300);
  });

  it("evaluates the VBA Range-array adapter used by the input sheet", () => {
    const input = ["", 9 / 24, "", 18 / 24, 0, 0];
    const code = ["", 0, 0, 0, 0, 9 / 24, 12 / 24, 12 / 24, 13 / 24, 13 / 24, 18 / 24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(勤務時間FromRanges(input, code)).toBeCloseTo(8 / 24);
  });

  it("resolves shared formulas and reports separate recalculation metrics", () => {
    const entries = {
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="入力" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" si="1" ref="B1:C1">A1</f><v>1</v></c><c r="C1"><f t="shared" si="1"/><v>1</v></c></row></sheetData></worksheet>'),
    };
    const formulas = new DependencyResolver().resolve(entries);
    expect(formulas).toHaveLength(2);
    expect(formulas[1].formula).toBe("B1");
    expect(new DependencyResolver().impacted(formulas, new Map([["入力", new Set(["A1"])]])).map((item) => item.reference)).toEqual(["B1", "C1"]);
    expect(metricsFor([{ formula: "SUM(A1)", status: "evaluated", value: 1 }, { formula: "勤務時間(A1)", status: "unsupported" }], 1)).toEqual({ calculationTargets: 2, calculationSuccesses: 1, validationMatches: 1, unsupported: 1 });
    expect(new CalculationValidator().allEqual(new CalculationValidator().compare([{ formula: "SUM(A1)", expected: 1, actual: 1 }]))).toBe(true);
  });

  it("decodes XML entities when expanding shared formula parents", () => {
    const entries = {
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="入力" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" si="1" ref="B1:C1">IF(A1&lt;&gt;0,A1,0)</f><v>1</v></c><c r="C1"><f t="shared" si="1"/><v>1</v></c></row></sheetData></worksheet>'),
    };
    const report = recalculateWorkbookFormulas(entries);
    expect(report.evaluationSuccesses).toBe(2);
    expect(report.unsupportedCells).toEqual([]);
    expect(new TextDecoder().decode(entries["xl/worksheets/sheet1.xml"])).toContain('r="C1"><f t="shared" si="1"/><v>1</v></c>');
  });
});
