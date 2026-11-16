import { describe, expect, it } from "vitest";
import "./main";

describe("web scaffold", () => {
  it("renders the product introduction", () => {
    expect(document.body.textContent).toContain("TIMESHEET PORTAL");
    expect(document.body.textContent).toContain("勤務表を、確実に提出する。");
    expect(document.querySelector("a[href='/login']")?.textContent).toContain("ログイン画面へ");
  });
});
