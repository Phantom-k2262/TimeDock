const allowedExtensions = new Set([".xlsx", ".xlsm", ".xls", ".docx", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".txt", ".csv", ".zip"]);
const blockedExtensions = new Set([".html", ".htm", ".svg", ".js", ".mjs", ".exe", ".dll", ".bat", ".cmd", ".ps1", ".sh", ".iso", ".dmg", ".lnk"]);

export function safeFileName(name: string) {
  const normalized = name.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
  return normalized.slice(-180) || "upload";
}

export async function validateUpload(file: File, maxBytes: number, requireXlsx = false) {
  if (!file.name || file.size <= 0) return "ファイルを選択してください";
  if (file.size > maxBytes) return "ファイルサイズが上限を超えています";
  const name = safeFileName(file.name);
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  if (blockedExtensions.has(extension) || (requireXlsx && ![".xlsx", ".xlsm"].includes(extension)) || (!requireXlsx && !allowedExtensions.has(extension))) return "許可されていないファイル形式です";
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const startsWith = (...bytes: number[]) => bytes.every((byte, index) => header[index] === byte);
  if (extension === ".pdf" && !new TextDecoder().decode(header).startsWith("%PDF-")) return "ファイル内容を確認できません";
  if ([".png"].includes(extension) && !startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "ファイル内容を確認できません";
  if ([".jpg", ".jpeg"].includes(extension) && !startsWith(0xff, 0xd8, 0xff)) return "ファイル内容を確認できません";
  if (extension === ".gif" && !["GIF87a", "GIF89a"].includes(new TextDecoder().decode(header.slice(0, 6)))) return "ファイル内容を確認できません";
  if ([".xlsx", ".xlsm", ".xls", ".docx", ".zip"].includes(extension) && !startsWith(0x50, 0x4b)) return "ファイル内容を確認できません";
  return null;
}
