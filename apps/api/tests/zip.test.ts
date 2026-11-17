import { describe, expect, it } from "vitest";
import { createStoredZip } from "../src/files/zip";

describe("stored zip archive", () => {
  it("creates a readable archive with the requested folder paths", () => {
    const archive = createStoredZip([
      { name: "山田 太郎/勤務表ファイル/2026-11.xlsx", data: new TextEncoder().encode("timesheet") },
      { name: "山田 太郎/経費・領収証/receipt.pdf", data: new TextEncoder().encode("receipt") },
    ]);
    const text = new TextDecoder().decode(archive);
    expect(new DataView(archive.buffer).getUint32(0, true)).toBe(0x04034b50);
    expect(text).toContain("2026-11.xlsx");
    expect(text).toContain("receipt.pdf");
    expect(new DataView(archive.buffer).getUint32(archive.length - 22, true)).toBe(0x06054b50);
  });

  it("supports an empty archive", () => {
    const archive = createStoredZip([]);
    expect(new DataView(archive.buffer).getUint32(0, true)).toBe(0x06054b50);
  });
});
