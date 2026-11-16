import { describe, expect, it } from "vitest";

document.body.innerHTML = '<div id="root"></div>';
window.history.pushState({}, "", "/login");
await import("./main");

describe("web scaffold", () => {
  it("renders the login screen when the URL is /login", () => {
    expect(document.body.textContent).toContain("TIMESHEET PORTAL");
    expect(document.body.textContent).toContain("ログイン");
    expect(document.querySelector("form.login-form")).not.toBeNull();
    expect(document.querySelector("input#email")).not.toBeNull();
  });
});
