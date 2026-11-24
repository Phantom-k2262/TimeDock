import { existsSync, readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { attendanceFilename, createAttendanceWorkbookFromTemplate } from "../src/attendance/export";

const fixture = "D:/yusuke/ダウンロード/【チーム名】作業実績表（SP派遣用）MM月_(氏名).xlsm";

function cell(xml: string, reference: string) {
  const match = xml.match(new RegExp(`<c\\b[^>]*\\br=["']${reference}["'][^>]*>([\\s\\S]*?)</c\\s*>`));
  return { attributes: match?.[0]?.match(/^<c\b([^>]*)>/)?.[1] ?? "", formula: match?.[1]?.match(/<f\b[^>]*>([\s\S]*?)<\/f\s*>/)?.[1] ?? "", cache: match?.[1]?.match(/<v\b[^>]*>([\s\S]*?)<\/v\s*>/)?.[1] ?? "" };
}

function rawCell(xml: string, reference: string) {
  return xml.match(new RegExp(`<c\\b[^>]*\\br=["']${reference}["'][^>]*/>`))?.[0] ?? "";
}

describe("SP派遣用作業実績表 export", () => {
  it.skipIf(!existsSync(fixture))("keeps formulas while applying profile and work data", () => {
    const output = createAttendanceWorkbookFromTemplate(new Uint8Array(readFileSync(fixture)), {
      format: "aaaa_sp",
      month: "2026-11",
      generatedAt: "2026-11-25T00:00:00.000Z",
      displayName: "管理者",
      profile: {
        company_name: "ABCシステム株式会社",
        project_name: "北國銀行コアバンキング",
        dispatch_work_content: "システム開発",
        dispatch_destination_office_name: "金沢事業所",
        dispatch_destination_postal_code: "9200000",
        dispatch_destination_address: "石川県金沢市",
        work_location_org_unit: "開発部",
        work_location_postal_code: "9200001",
        work_location_address: "石川県金沢市広岡",
        work_pattern: "通常勤務",
        statutory_holiday: "日",
      },
      entries: [{ work_date: "2026-11-02", start_time: "09:00", end_time: "18:00", ordinary_break_minutes: 60, night_break_minutes: 0, note: "確認" }],
      leaveRequests: [], expenses: [], report: null, monthlyInput: null,
    });
    const entries = unzipSync(output);
    const xml = strFromU8(entries["xl/worksheets/sheet1.xml"]);
    expect(cell(xml, "A2").formula).toContain("E6");
    expect(cell(xml, "A15").cache).toBe("46327");
    expect(rawCell(xml, "D15")).toMatch(/<c\b[^>]*\br="D15"[^>]*\/>/);
    expect(rawCell(xml, "D15")).not.toContain('t="inlineStr"');
    expect(rawCell(xml, "F15")).toMatch(/<c\b[^>]*\br="F15"[^>]*\/>/);
    expect(rawCell(xml, "H15")).toMatch(/<c\b[^>]*\br="H15"[^>]*\/>/);
    expect(cell(xml, "J15").cache).toBe("0");
    expect(cell(xml, "T15").cache).toBe("0");
    expect(cell(xml, "D16").cache).toBe("900");
    expect(cell(xml, "F16").cache).toBe("1800");
    expect(cell(xml, "H16").cache).toBe("100");
    expect(cell(xml, "E10").cache).toBe("9200000");
    expect(cell(xml, "E10").attributes).not.toContain('t="inlineStr"');
    expect(cell(xml, "E12").cache).toBe("9200001");
    expect(cell(xml, "E12").attributes).not.toContain('t="inlineStr"');
    expect(cell(xml, "T16").formula).toContain("INT(F16/100)*60+MOD(F16,100)");
    expect(cell(xml, "U16").formula).toContain("IF(ISBLANK(D16),0");
    expect(cell(xml, "V16").formula).toContain("INT(H16/60)*100+MOD(H16,60)");
    expect(cell(xml, "W16").formula).toContain("IF(U16&gt;480,480,U16)");
    expect(cell(xml, "T16").cache).toBe("540");
    expect(cell(xml, "U16").cache).toBe("480");
    expect(cell(xml, "V16").cache).toBe("100");
    expect(cell(xml, "W16").cache).toBe("480");
    expect(cell(xml, "X16").cache).toBe("0");
    expect(cell(xml, "Y16").cache).toBe("0");
    expect(cell(xml, "U46").cache).toBe("480");
    expect(cell(xml, "X46").cache).toBe("0");
    expect(cell(xml, "Y46").cache).toBe("0");
    expect(cell(xml, "J16").cache).toBe("800");
    expect(cell(xml, "J46").cache).toBe("800");
    expect(attendanceFilename("aaaa_sp", "2026-11", "管理者", "template.xlsm", "北國銀行コアバンキング"))
      .toBe("【北國銀行コアバンキング】作業実績表（SP派遣用）11月_(管理者).xlsm");
  });
});
