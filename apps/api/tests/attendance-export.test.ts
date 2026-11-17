import { describe, expect, it } from "vitest";
import { createAttendanceWorkbook } from "../src/attendance/export";

describe("attendance workbook export", () => {
  it("creates the selected Excel-compatible format with common fields and submit date", () => {
    const workbook = new TextDecoder().decode(createAttendanceWorkbook({
      format: "abcs_regular",
      month: "2026-11",
      generatedAt: "2026-11-17T06:00:00.000Z",
      profile: { display_name: "相澤友佑", employee_code: "553", company_name: "ABC" },
      entries: [{ work_date: "2026-11-01", start_time: "09:00", end_time: "17:30", break_minutes: 60, project_name: "案件A", note: "" }],
      leaveRequests: [],
      expenses: [],
      report: null,
    }));

    expect(workbook).toContain("ABCS正社員（普通）勤務表");
    expect(workbook).toContain("提出日");
    expect(workbook).toContain("2026-11-17");
    expect(workbook).toContain("勤務表");
    expect(workbook).toContain("案件A");
  });
});
