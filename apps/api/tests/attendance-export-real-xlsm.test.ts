import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createAttendanceWorkbookFromTemplate } from "../src/attendance/export";
import { recalculateWorkbookFormulas } from "../src/excel/workbook-recalculation";
import { updateFormulaCacheXml } from "../src/excel/workbook";

const fixture = process.env.ABCS_XLSM_FIXTURE ?? "D:/repos/TimeDock/.book/ABCS正社員（普通）勤務表2月(相澤友佑).xlsm";
const hasFixture = existsSync(fixture);
const hasExplicitFixture = Boolean(process.env.ABCS_XLSM_FIXTURE);

function sheetNames(entries: Record<string, Uint8Array>) {
  const workbook = strFromU8(entries["xl/workbook.xml"] ?? new Uint8Array());
  const rels = strFromU8(entries["xl/_rels/workbook.xml.rels"] ?? new Uint8Array());
  const ids = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b[^>]*\bId=["']([^"']+)["'][^>]*\bTarget=["']([^"']+)["']/g)) ids.set(match[1], `xl/${match[2].replace(/^\/+/, "").replace(/^xl\//, "")}`);
  return new Map([...workbook.matchAll(/<sheet\b[^>]*\bname=["']([^"']+)["'][^>]*\br:id=["']([^"']+)["']/g)].map((match) => [ids.get(match[2]) ?? "", match[1]]));
}

function cellRecords(xml: string) {
  return [...xml.matchAll(/<c\b([^>]*?\br=["']([^"']+)["'][^>]*?)\/>|<c\b([^>]*?\br=["']([^"']+)["'][^>]*?)>([\s\S]*?)<\/c\s*>/g)].map((match) => ({
    reference: match[2] ?? match[4],
    attributes: match[1] ?? match[3],
    content: match[5] ?? "",
    formula: (match[5] ?? "").match(/<f\b([^>]*)>([\s\S]*?)<\/f\s*>/)?.[2]?.trim() ?? ((match[5] ?? "").match(/<f\b([^>]*)\s*\/>/) ? "<shared-child>" : undefined),
    cache: (match[5] ?? "").match(/<v\b[^>]*>([\s\S]*?)<\/v\s*>/)?.[1] ?? null,
  }));
}

function column(number: number) {
  let result = "";
  for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

function cellReport(xml: string, references: string[]) {
  const cells = new Map(cellRecords(xml).map((cell) => [cell.reference, cell]));
  return references.map((reference) => {
    const cell = cells.get(reference);
    return {
      reference,
      formula: cell?.formula ?? null,
      cache: cell?.cache,
      type: cell?.attributes.match(/\bt=["']([^"']+)["']/)?.[1] ?? "numeric",
      style: cell?.attributes.match(/\bs=["']([^"']+)["']/)?.[1] ?? null,
    };
  });
}

function assertOoxmlPackageConsistent(entries: Record<string, Uint8Array>) {
  const paths = new Set(Object.keys(entries));
  const resolvePackageTarget = (baseDirectory: string, target: string) => {
    const segments = [...(target.startsWith("/") ? [] : baseDirectory.split("/")), ...target.replace(/^\/+/, "").split("/")];
    const resolved: string[] = [];
    for (const segment of segments) {
      if (!segment || segment === ".") continue;
      if (segment === "..") resolved.pop(); else resolved.push(segment);
    }
    return resolved.join("/");
  };
  const contentTypes = strFromU8(entries["[Content_Types].xml"] ?? new Uint8Array());
  for (const match of contentTypes.matchAll(/<Override\b[^>]*\bPartName=["'](\/[^"']+)["']/g)) {
    expect(paths.has(match[1].replace(/^\//, ""))).toBe(true);
  }
  const workbookRels = strFromU8(entries["xl/_rels/workbook.xml.rels"] ?? new Uint8Array());
  for (const match of workbookRels.matchAll(/<Relationship\b[^>]*\bTarget=["']([^"']+)["'][^>]*>/g)) {
    if (match[1].startsWith("http") || match[1].startsWith("mailto:")) continue;
    const target = resolvePackageTarget("xl", match[1]);
    expect(paths.has(target), `missing workbook relationship target ${match[1]}`).toBe(true);
  }
  for (const [path, bytes] of Object.entries(entries)) {
    if (!/^xl\/worksheets\/.*\.xml$/.test(path)) continue;
    const xml = strFromU8(bytes);
    // SpreadsheetML requires each cell reference to occur once. This catches
    // the exact corruption Excel reported for sheet3/sheet4, which a generic
    // XML parser accepts.
    const seen = new Set<string>();
    for (const cell of cellRecords(xml)) {
      expect(seen.has(cell.reference), `duplicate cell ${cell.reference}`).toBe(false);
      seen.add(cell.reference);
    }
    const parents = new Map<string, { reference: string; ref?: string }>();
    for (const match of xml.matchAll(/<c\b[^>]*\br=["']([^"']+)["'][^>]*>([\s\S]*?)<\/c>/g)) {
      const formula = match[2].match(/<f\b([^>]*)>([\s\S]*?)<\/f\s*>/);
      const id = formula?.[1].match(/\bsi=["'](\d+)["']/)?.[1];
      if (id && formula?.[2] !== undefined) parents.set(id, { reference: match[1], ref: formula[1].match(/\bref=["']([^"']+)["']/)?.[1] });
      const child = match[2].match(/<f\b([^>]*)\s*\/>/);
      const childId = child?.[1].match(/\bsi=["'](\d+)["']/)?.[1];
      if (childId) {
        const parent = parents.get(childId);
        expect(parent).toBeDefined();
      }
    }
  }
}

describe("real ABCS XLSM export integration", () => {
  it.skipIf(!hasFixture)("keeps the real November L52 TEXT result as a string cache", () => {
    const template = new Uint8Array(readFileSync(fixture));
    const before = unzipSync(template);
    const names = sheetNames(before);
    const submissionPath = [...names.entries()].find(([, name]) => name === "勤務表（会社提出用）")?.[0];
    expect(submissionPath).toBeTruthy();
    const original = strFromU8(before[submissionPath!] ?? new Uint8Array());
    const output = updateFormulaCacheXml(original, "L52", "387120:00");
    expect(output).toContain('r="L52"');
    expect(output).toContain('t="str"');
    expect(output).toContain("<v>387120:00</v>");
    expect(output).toContain('TEXT(\'勤務表（入力用）\'!B23,"[h]:mm")');
  });

  it.skipIf(!hasFixture || !hasExplicitFixture)("writes the real November submission TEXT and MINUTE caches with their evaluated types", () => {
    const template = new Uint8Array(readFileSync(fixture));
    const before = unzipSync(template);
    const names = sheetNames(before);
    const inputPath = [...names.entries()].find(([, name]) => name === "勤務表（入力用）")?.[0];
    const submissionPath = [...names.entries()].find(([, name]) => name === "勤務表（会社提出用）")?.[0];
    expect(inputPath).toBeTruthy();
    expect(submissionPath).toBeTruthy();
    const inputBefore = strFromU8(before[inputPath!] ?? new Uint8Array());
    const submissionBefore = strFromU8(before[submissionPath!] ?? new Uint8Array());
    expect(cellReport(inputBefore, ["B23"])[0].cache).toBe("16130");
    expect(cellReport(submissionBefore, ["L52", "M48", "P48"])).toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: "L52", cache: "387120:00" }),
      expect.objectContaining({ reference: "M48", cache: "104" }),
      expect.objectContaining({ reference: "P48", cache: "104" }),
    ]));
    const output = createAttendanceWorkbookFromTemplate(template, {
      format: "abcs_regular",
      month: "2026-11",
      generatedAt: "2026-11-30T00:00:00.000Z",
      profile: { display_name: "fixture", employee_code: "fixture" },
      entries: [], leaveRequests: [], expenses: [], report: null, displayName: "fixture",
    });
    const after = unzipSync(output);
    const submissionAfter = cellReport(strFromU8(after[submissionPath!] ?? new Uint8Array()), ["L52", "M48", "P48"]);
    // The export input is intentionally empty here, so the reset phase changes
    // B23 to zero.  The important regression is that TEXT still produces a
    // string cache (`0:00`) rather than a numeric cache.
    expect(submissionAfter.find((cell) => cell.reference === "L52")).toMatchObject({ type: "str", cache: "0:00" });
    expect(submissionAfter.find((cell) => cell.reference === "M48")).toMatchObject({ type: "str", cache: "" });
    expect(submissionAfter.find((cell) => cell.reference === "P48")).toMatchObject({ cache: "0" });
  });

  it.skipIf(!hasFixture)("enumerates 時間差 and all input-sheet row 24 cells, then runs the export path", () => {
    const template = new Uint8Array(readFileSync(fixture));
    const before = unzipSync(template);
    const names = sheetNames(before);
    const report = recalculateWorkbookFormulas(before);
    const inputPath = [...names.entries()].find(([, name]) => name === "勤務表（入力用）")?.[0];
    const originalRow24 = inputPath ? cellRecords(strFromU8(unzipSync(template)[inputPath] ?? new Uint8Array())).filter((cell) => /^([A-Z]+)24$/.test(cell.reference) && cell.formula) : [];
    const recalculatedRow24 = inputPath ? cellRecords(strFromU8(before[inputPath] ?? new Uint8Array())).filter((cell) => /^([A-Z]+)24$/.test(cell.reference) && cell.formula) : [];
    const timeDifferenceCells = report.evaluatedCellDetails.filter((cell) => cell.sheet === "勤務表（入力用）" && cell.reference.match(/^[A-Z]+24$/) && cell.formula.includes("時間差")).map((cell) => cell.reference);
    const timeDifferenceFailures = report.unsupportedCells.filter((cell) => cell.sheet === "勤務表（入力用）" && cell.reference.match(/^[A-Z]+24$/) && cell.formula.includes("時間差"));
    const row24 = originalRow24;
    const row24Report = row24.map((cell) => {
      const key = `勤務表（入力用）!${cell.reference}`;
      const failure = report.unsupportedCells.find((item) => item.sheet === "勤務表（入力用）" && item.reference === cell.reference);
      const after = recalculatedRow24.find((item) => item.reference === cell.reference);
      const detail = report.evaluatedCellDetails.find((item) => item.sheet === "勤務表（入力用）" && item.reference === cell.reference);
      return { reference: cell.reference, formula: detail?.formula ?? cell.formula, cacheBefore: cell.cache, cacheAfter: after?.cache ?? null, status: report.evaluatedCells.includes(key) ? "evaluated" : failure ? "unsupported" : "not-seen", reason: failure?.reason ?? null };
    });
    console.log(JSON.stringify({
      fixture,
      timeDifference: { evaluated: timeDifferenceCells, evaluatedCount: timeDifferenceCells.length, failed: timeDifferenceFailures },
      row24: row24Report,
      metrics: { total: report.totalFormulas, targets: report.calculationTargets, successes: report.evaluationSuccesses, failures: report.evaluationFailures, unsupported: report.unsupported, emptyBefore: report.emptyCachesBefore, emptyAfter: report.emptyCachesAfter },
    }, null, 2));
    expect(timeDifferenceCells).toHaveLength(31);
    expect(timeDifferenceFailures).toHaveLength(0);
    const expectedFormulaCount = Object.entries(before)
      .filter(([path]) => /^xl\/worksheets\/.*\.xml$/.test(path))
      .reduce((sum, [, bytes]) => sum + (strFromU8(bytes).match(/<f\b/g)?.length ?? 0), 0);
    expect(report.totalFormulas).toBe(expectedFormulaCount);
    expect(report.evaluationSuccesses).toBe(expectedFormulaCount - report.evaluationFailures);
    expect(report.evaluationFailures).toBe(51);
    expect(report.unsupportedCells.filter((cell) => cell.reason === "unsupported-standard-function:HLOOKUP")).toHaveLength(20);
    expect(report.unsupportedCells.filter((cell) => cell.reason === "unsupported-expression" && cell.formula.startsWith("#REF!"))).toHaveLength(31);
    expect(row24Report).toHaveLength(31);
    expect(row24Report.every((cell) => cell.status === "evaluated")).toBe(true);

    let recalculationLog = "";
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => { recalculationLog += args.map(String).join(" "); };
    try {
      const output = createAttendanceWorkbookFromTemplate(template, {
        format: "abcs_regular",
        month: "2026-11",
        generatedAt: "2026-11-30T00:00:00.000Z",
        profile: { display_name: "fixture", employee_code: "fixture" },
        entries: [],
        leaveRequests: [],
        expenses: [],
        report: null,
        displayName: "fixture",
      });
      expect(output.byteLength).toBeGreaterThan(0);

      const after = unzipSync(output);
      assertOoxmlPackageConsistent(after);
      expect(after["xl/calcChain.xml"]).toBeUndefined();
      expect(strFromU8(after["xl/_rels/workbook.xml.rels"] ?? new Uint8Array())).not.toContain("/relationships/calcChain");
      expect(strFromU8(after["[Content_Types].xml"] ?? new Uint8Array())).not.toContain("/xl/calcChain.xml");
      // Package parts that are not part of the recalculation contract must be
      // preserved byte-for-byte, especially VBA and the template's styles.
      expect(Buffer.from(after["xl/vbaProject.bin"] ?? new Uint8Array()).equals(Buffer.from(before["xl/vbaProject.bin"] ?? new Uint8Array()))).toBe(true);
      expect(after["xl/styles.xml"]).toBeDefined();
      expect(Buffer.from(after["xl/sharedStrings.xml"] ?? new Uint8Array()).equals(Buffer.from(before["xl/sharedStrings.xml"] ?? new Uint8Array()))).toBe(true);
      const afterNames = sheetNames(after);
      const afterInputPath = [...afterNames.entries()].find(([, name]) => name === "勤務表（入力用）")?.[0];
      const afterSubmissionPath = [...afterNames.entries()].find(([, name]) => name === "勤務表（会社提出用）")?.[0];
      expect(afterInputPath).toBeTruthy();
      expect(afterSubmissionPath).toBeTruthy();
      const inputDates = cellReport(strFromU8(after[afterInputPath!] ?? new Uint8Array()), [...Array(31)].map((_, index) => `${column(index + 4)}7`));
      const inputWeekdays = cellReport(strFromU8(after[afterInputPath!] ?? new Uint8Array()), [...Array(31)].map((_, index) => `${column(index + 4)}8`));
      const submissionDates = cellReport(strFromU8(after[afterSubmissionPath!] ?? new Uint8Array()), [...Array(31)].map((_, index) => `A${index + 16}`));
      const submissionWeekdays = cellReport(strFromU8(after[afterSubmissionPath!] ?? new Uint8Array()), [...Array(31)].map((_, index) => `B${index + 16}`));
      const submissionFlags = cellReport(strFromU8(after[afterSubmissionPath!] ?? new Uint8Array()), [...Array(31)].map((_, index) => `C${index + 16}`));
      console.log(JSON.stringify({ inputDates, inputWeekdays, submissionDates, submissionWeekdays, submissionFlags }, null, 2));
      for (let index = 0; index < 30; index += 1) {
        const expectedSerial = String(46327 + index);
        expect(inputDates[index].cache).toBe(expectedSerial);
        expect(inputDates[index].type).toBe("numeric");
        expect(inputWeekdays[index].cache).toBe(expectedSerial);
        expect(inputWeekdays[index].type).toBe("numeric");
        expect(submissionDates[index].cache).toBe(expectedSerial);
        expect(submissionDates[index].type).toBe("numeric");
        expect(submissionWeekdays[index].cache).toBe(expectedSerial);
        expect(submissionWeekdays[index].type).toBe("numeric");
        expect(inputDates[index].formula).not.toBeNull();
        expect(inputWeekdays[index].formula).not.toBeNull();
        expect(submissionDates[index].formula).not.toBeNull();
        expect(submissionWeekdays[index].formula).not.toBeNull();
        expect(inputDates[index].style).not.toBeNull();
        expect(inputWeekdays[index].style).not.toBeNull();
        expect(submissionDates[index].style).not.toBeNull();
        expect(submissionWeekdays[index].style).not.toBeNull();
      }
      expect(inputDates[30].cache).toBe("");
      expect(inputWeekdays[30].cache).toBe("");
      expect(submissionDates[30].cache).toBe("");
      expect(submissionWeekdays[30].cache).toBe("");
      expect(submissionFlags[30].cache).toBe("");
      expect(cellReport(strFromU8(after[afterSubmissionPath!] ?? new Uint8Array()), ["D46", "E46", "F46", "G46"]).every((cell) => cell.cache === "")).toBe(true);
    } finally {
      console.info = originalInfo;
    }
    console.log(JSON.stringify({ exportRecalculationMetrics: recalculationLog.match(/excel_recalculation_metrics\s+(\{.*\})/)?.[1] ?? null, exportMetrics: recalculationLog.match(/excel_export_metrics\s+(\{.*\})/)?.[1] ?? null }));
    expect(recalculationLog).toContain("excel_recalculation_metrics");
  });

  it.skipIf(!hasFixture)("clears stale caches for empty company-submission references", () => {
    const template = new Uint8Array(readFileSync(fixture));
    const before = unzipSync(template);
    const submissionPath = sheetNames(before);
    const path = [...submissionPath.entries()].find(([, name]) => name === "勤務表（会社提出用）")?.[0];
    expect(path).toBeTruthy();
    const source = strFromU8(before[path!]);
    const stale = source.replace(/(<c\b[^>]*\br="(?:D46|E46|F46|G46)"[^>]*>)([\s\S]*?)(<\/c>)/g, (_cell, open, content, close) => {
      const next = content.replace(/<v\b[^>]*(?:\/>|>[\s\S]*?<\/v\s*>)/, "<v>104</v>");
      return `${open}${next}${close}`;
    });
    before[path!] = new TextEncoder().encode(stale);
    const mutatedTemplate = Object.fromEntries(Object.entries(before).map(([name, bytes]) => [name, bytes]));
    const output = createAttendanceWorkbookFromTemplate(new Uint8Array(zipSync(mutatedTemplate)), {
      format: "abcs_regular",
      month: "2026-11",
      generatedAt: "2026-11-30T00:00:00.000Z",
      profile: { display_name: "fixture", employee_code: "fixture" },
      entries: [], leaveRequests: [], expenses: [], report: null, displayName: "fixture",
    });
    const after = unzipSync(output);
    const xml = strFromU8(after[path!]);
    for (const reference of ["D46", "E46", "F46", "G46"]) {
      const cell = xml.match(new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>[\\s\\S]*?<\\/c\\s*>`))?.[0] ?? "";
      expect(cell).toContain('t="str"');
      expect(cell).toContain("<v></v>");
      expect(cell).not.toContain("104");
    }
  });

  it.skipIf(!hasFixture || !hasExplicitFixture)("regresses real November populated daily caches and protected cells", () => {
    const template = new Uint8Array(readFileSync(fixture));
    const before = unzipSync(template);
    const names = sheetNames(before);
    const inputPath = [...names.entries()].find(([, name]) => name === "勤務表（入力用）")?.[0];
    const submissionPath = [...names.entries()].find(([, name]) => name === "勤務表（会社提出用）")?.[0];
    expect(inputPath).toBeTruthy();
    expect(submissionPath).toBeTruthy();
    const inputBefore = strFromU8(before[inputPath!] ?? new Uint8Array());
    const submissionBefore = strFromU8(before[submissionPath!] ?? new Uint8Array());
    const cellXml = (xml: string, reference: string) => xml.match(new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*?/>`))?.[0]
      ?? xml.match(new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>[\\s\\S]*?<\\/c\\s*>`))?.[0]
      ?? "";
    const protectedBefore = new Map([
      ...["AF5", "AG5", "AH5"].map((reference) => [reference, cellXml(inputBefore, reference)] as const),
      ["R47", cellXml(submissionBefore, "R47")],
    ]);
    const populatedDays = [1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 22, 24, 30];
    const entries = populatedDays.map((day) => ({
      work_date: `2026-11-${String(day).padStart(2, "0")}`,
      start_time: "09:00",
      end_time: "18:00",
      ordinary_break_minutes: 60,
      night_break_minutes: 0,
      project_name: "Phase11.3 fixture",
      note: "fixture",
    }));
    const output = createAttendanceWorkbookFromTemplate(template, {
      format: "abcs_regular",
      month: "2026-11",
      generatedAt: "2026-11-30T00:00:00.000Z",
      profile: { display_name: "fixture", employee_code: "fixture" },
      entries, leaveRequests: [], expenses: [], report: null, displayName: "fixture",
    });
    const after = unzipSync(output);
    const inputAfter = strFromU8(after[inputPath!] ?? new Uint8Array());
    const submissionAfter = strFromU8(after[submissionPath!] ?? new Uint8Array());
    const inputReport = cellReport(inputAfter, ["F15", "F24", "G15", "G24", "J15", "J24", "L15", "L24", "R15", "R24", "S15", "S24", "X15", "X24", "AA15", "AA24", "AE15", "AE24", "AG15", "AG24", "B18", "B19", "B20", "B21", "B22", "B23"]);
    const submissionReport = cellReport(submissionAfter, ["H16", "H18", "I18", "L18", "H48", "M48", "P48", "D52", "E52", "K52", "L52"]);
    console.log(JSON.stringify({ inputReport, submissionReport }, null, 2));
    mkdirSync("outputs/phase-11-3-validation", { recursive: true });
    writeFileSync("outputs/phase-11-3-validation/generated-november-2026-test-data-v2.xlsm", Buffer.from(output));
    for (const reference of ["F15", "J15", "R15", "X15", "AE15", "F24", "J24", "R24", "X24", "AE24"]) {
      expect(inputReport.find((cell) => cell.reference === reference)?.cache).not.toBe("730");
      expect(inputReport.find((cell) => cell.reference === reference)?.cache).toBe("0");
    }
    for (const reference of ["G15", "L15", "S15", "AA15", "AG15"]) {
      expect(inputReport.find((cell) => cell.reference === reference)?.cache).not.toBe("0");
    }
    expect(inputReport.find((cell) => cell.reference === "B18")?.cache).not.toBe("97");
    expect(inputReport.find((cell) => cell.reference === "B23")?.cache).toBe("0");
    expect(submissionReport.find((cell) => cell.reference === "H48")?.type).toBe("numeric");
    for (const reference of ["H18", "I18", "L18"]) {
      expect(submissionReport.find((cell) => cell.reference === reference)).toMatchObject({ type: "str", cache: "" });
    }
    expect(submissionReport.find((cell) => cell.reference === "M48")?.type).toBe("str");
    expect(submissionReport.find((cell) => cell.reference === "M48")?.cache).toBe("");
    expect(submissionReport.find((cell) => cell.reference === "D52")?.cache).toBe("20");
    expect(submissionReport.find((cell) => cell.reference === "L52")?.type).toBe("str");
    for (const [reference, original] of protectedBefore) {
      expect(cellXml(reference === "R47" ? submissionAfter : inputAfter, reference)).toBe(original);
    }
  });
});
