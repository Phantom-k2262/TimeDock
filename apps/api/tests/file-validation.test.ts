import { describe, expect, it } from "vitest";
import { validateUpload } from "../src/files/validation";

describe("template upload validation", () => {
  it("accepts macro-enabled Excel templates", async () => {
    const result = await validateUpload(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "template.xlsm"), 1024, true);
    expect(result).toBeNull();
  });
});
