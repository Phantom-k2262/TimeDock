/**
 * VBA-compatible implementations used by the ABCS workbook.
 *
 * These functions deliberately operate on plain values and never mutate an
 * OOXML package.  The formulas in the workbook remain the source of truth;
 * this adapter is only used when a formula is explicitly proven equivalent.
 */

export type VbaEmpty = { readonly kind: "empty" };
export type VbaError = { readonly kind: "error"; readonly code: string };
export type VbaValue = number | string | boolean | Date | VbaEmpty | VbaError | null | undefined;

export const VBA_EMPTY: VbaEmpty = { kind: "empty" };

function isError(value: VbaValue): value is VbaError {
  return Boolean(value && typeof value === "object" && "kind" in value && value.kind === "error");
}

function excelSerial(value: VbaValue): number {
  if (isError(value)) throw new Error(value.code);
  if (value === null || value === undefined || value === VBA_EMPTY) return 0;
  if (value instanceof Date) return (value.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error("#VALUE!");
  return number;
}

function timeSerial(hours: number, minutes: number): number {
  // VBA TimeSerial normalizes overflow in both components.  The workbook
  // uses non-negative HHMM values, but keeping normalization here also covers
  // midnight crossings without inventing a special case.
  return (hours * 60 + minutes) / 1440;
}

function hhmToMinutes(value: VbaValue): number {
  const number = excelSerial(value);
  if (!Number.isFinite(number)) throw new Error("#VALUE!");
  const hours = Math.trunc(number / 100);
  const minutes = Math.trunc(number - hours * 100);
  return hours * 60 + minutes;
}

/** VBA HMINT: converts an Excel date/time to HHMM integer notation. */
export function HMINT(value: VbaValue): number | VbaError {
  try {
    const serial = excelSerial(value);
    return (Math.trunc(serial) * 24 + Math.floor((serial - Math.trunc(serial)) * 24)) * 100 + Math.floor((((serial - Math.trunc(serial)) * 24) % 1) * 60 + 1e-9);
  } catch (error) {
    return { kind: "error", code: error instanceof Error ? error.message : "#VALUE!" };
  }
}

/** VBA INTHM: converts HHMM integer notation to an Excel time serial. */
export function INTHM(value: VbaValue): number | VbaError {
  try {
    const number = excelSerial(value);
    const hours = Math.trunc(number / 100);
    const minutes = Math.trunc(number - hours * 100);
    return timeSerial(hours, minutes);
  } catch (error) {
    return { kind: "error", code: error instanceof Error ? error.message : "#VALUE!" };
  }
}

/** VBA COUNTIF2: exact equality, including a literal "*" criterion. */
export function COUNTIF2(values: readonly VbaValue[], criterion: VbaValue): number | VbaError {
  try {
    const expected = String(criterion ?? "");
    return values.reduce<number>((count, value) => count + (String(value ?? "") === expected ? 1 : 0), 0);
  } catch (error) {
    return { kind: "error", code: error instanceof Error ? error.message : "#VALUE!" };
  }
}

/**
 * VBA 時間差.  The source in the workbook is:
 *
 *   CDbl(Application.Text(Abs(a-b), "[h]mm")) * sign
 *
 * Excel's `[h]mm` formatting is an elapsed-time display, so Application.Text
 * returns an HHMM number (not an Excel date serial) rounded to minute
 * precision. A zero result is VBA Empty, not numeric zero.
 */
export function 時間差(left: VbaValue, right: VbaValue): number | VbaEmpty | VbaError {
  try {
    const a = excelSerial(left);
    const b = excelSerial(right);
    const sign = a > b ? 1 : -1;
    const minutes = Math.round(Math.abs(a - b) * 1440);
    if (minutes === 0) return VBA_EMPTY;
    return (Math.trunc(minutes / 60) * 100 + (minutes % 60)) * sign;
  } catch (error) {
    return { kind: "error", code: error instanceof Error ? error.message : "#VALUE!" };
  }
}

export type VbaCodeEntry = {
  code: string;
  earlyStart?: number;
  earlyEnd?: number;
  earlyNightStart?: number;
  earlyNightEnd?: number;
  morningStart?: number;
  morningEnd?: number;
  lunchStart?: number;
  lunchEnd?: number;
  afternoonStart?: number;
  afternoonEnd?: number;
  eveningBreakStart?: number;
  eveningBreakEnd?: number;
  nightStart?: number;
  nightEnd?: number;
  nightBreakStart?: number;
  nightBreakEnd?: number;
  deepNightStart?: number;
  deepNightEnd?: number;
  deepNightBreakStart?: number;
  deepNightBreakEnd?: number;
};

export type VbaWorkInput = {
  flag?: string | null;
  start?: number | null;
  end?: number | null;
  ordinaryBreak?: number | null;
  nightBreak?: number | null;
};

function serialInterval(start: number | undefined, end: number | undefined): number {
  if (start === undefined || end === undefined) return 0;
  return Math.max(0, end - start);
}

function serialTime(minutes: number): number | VbaEmpty {
  if (minutes <= 0) return VBA_EMPTY;
  return Math.round(minutes) / 1440;
}

function rangeNumber(values: readonly VbaValue[], index: number): number {
  const value = values[index - 1];
  return value === null || value === undefined || value === VBA_EMPTY || value === "" ? 0 : excelSerial(value);
}

function rangeText(values: readonly VbaValue[], index: number): string {
  const value = values[index - 1];
  return value === null || value === undefined || value === VBA_EMPTY ? "" : String(value);
}

function timeTable(values: readonly VbaValue[]) {
  // The VBA input is a one-column Range.  Its 1-based positions are the
  // constants ix早出勤務開始 ... ix深夜休憩終了 in the extracted module.
  return {
    code: rangeText(values, 1),
    earlyStart: rangeNumber(values, 2), earlyEnd: rangeNumber(values, 3),
    earlyNightStart: rangeNumber(values, 4), earlyNightEnd: rangeNumber(values, 5),
    morningStart: rangeNumber(values, 6), morningEnd: rangeNumber(values, 7),
    lunchStart: rangeNumber(values, 8), lunchEnd: rangeNumber(values, 9),
    afternoonStart: rangeNumber(values, 10), afternoonEnd: rangeNumber(values, 11),
    eveningBreakStart: rangeNumber(values, 12), eveningBreakEnd: rangeNumber(values, 13),
    nightStart: rangeNumber(values, 14), nightEnd: rangeNumber(values, 15),
    nightBreakStart: rangeNumber(values, 16), nightBreakEnd: rangeNumber(values, 17),
    deepNightStart: rangeNumber(values, 18), deepNightEnd: rangeNumber(values, 19),
    deepNightBreakStart: rangeNumber(values, 20), deepNightBreakEnd: rangeNumber(values, 21),
  } satisfies VbaCodeEntry;
}

function vbaInput(values: readonly VbaValue[]) {
  return {
    flag: rangeText(values, 1),
    start: rangeNumber(values, 2),
    end: rangeNumber(values, 4),
    ordinaryBreak: rangeNumber(values, 5),
    nightBreak: rangeNumber(values, 6),
  } satisfies VbaWorkInput;
}

function timeTableFromRanges(inputValues: readonly VbaValue[], codeValues: readonly VbaValue[]) {
  const input = vbaInput(inputValues);
  const code = timeTable(codeValues);
  const start = input.start ?? 0;
  const end = input.end ?? 0;
  if (end <= start) return { code, input, values: Array(11).fill(0) as number[] };
  const overlap = (from: number, to: number) => serialInterval(Math.max(from, start), Math.min(to, end));
  return {
    code,
    input,
    values: [
      end - start,
      overlap(code.earlyStart ?? 0, code.earlyEnd ?? 0),
      overlap(code.earlyNightStart ?? 0, code.earlyNightEnd ?? 0),
      overlap(code.morningStart ?? 0, code.morningEnd ?? 0),
      overlap(code.lunchStart ?? 0, code.lunchEnd ?? 0),
      overlap(code.afternoonStart ?? 0, code.afternoonEnd ?? 0),
      overlap(code.eveningBreakStart ?? 0, code.eveningBreakEnd ?? 0),
      overlap(code.nightStart ?? 0, code.nightEnd ?? 0),
      overlap(code.nightBreakStart ?? 0, code.nightBreakEnd ?? 0),
      overlap(code.deepNightStart ?? 0, code.deepNightEnd ?? 0),
      overlap(code.deepNightBreakStart ?? 0, code.deepNightBreakEnd ?? 0),
    ],
  };
}

/** Exact Range-array adapter for the extracted VBA 勤務時間 function. */
export function 勤務時間FromRanges(inputValues: readonly VbaValue[], codeValues: readonly VbaValue[]): number | VbaEmpty | VbaError {
  try {
    const input = vbaInput(inputValues);
    const calculated = timeTableFromRanges(inputValues, codeValues);
    const values = calculated.values;
    const ordinary = rangeNumber(inputValues, 5);
    const night = rangeNumber(inputValues, 6);
    let minutes = (values[0] * 1440) - (ordinary * 1440) - (night * 1440);
    if (input.flag === "") minutes -= (values[4] + values[6] + values[8] + values[10]) * 1440;
    else if (["H", "DH", "KH", "TH", "THN"].includes(input.flag ?? "")) minutes -= values[4] * 1440;
    else if (!["*", "F"].includes(input.flag ?? "")) return VBA_EMPTY;
    return serialTime(minutes);
  } catch (error) {
    return { kind: "error", code: error instanceof Error ? error.message : "#VALUE!" };
  }
}

/** Exact Range-array adapter for the extracted VBA 残業時間 function. */
export function 残業時間FromRanges(inputValues: readonly VbaValue[], codeValues: readonly VbaValue[], type: string): number | VbaEmpty | VbaError {
  try {
    const { input, code, values } = timeTableFromRanges(inputValues, codeValues);
    const ordinary = rangeNumber(inputValues, 5) * 1440;
    const night = rangeNumber(inputValues, 6) * 1440;
    const flag = input.flag ?? "";
    let minutes = 0;
    if (type === "深夜") {
      minutes = (values[9] + values[2] - rangeNumber(inputValues, 6)) * 1440;
    } else if (flag === "F") {
      minutes = values[0] * 1440 > 465 ? values[0] * 1440 - 465 - ordinary - night : 0;
    } else if (["", "H", "DH", "KH", "TH", "THN"].includes(flag)) {
      minutes = (values[7] + values[1]) * 1440 - ordinary - night;
    } else if (flag === "*") {
      minutes = values[0] * 1440 - ordinary - night;
    }
    return serialTime(minutes);
  } catch (error) {
    return { kind: "error", code: error instanceof Error ? error.message : "#VALUE!" };
  }
}

/** Exact Range-array adapter for the extracted VBA 代休取得時間 function. */
export function 代休取得時間FromRanges(inputValues: readonly VbaValue[]): number | VbaEmpty | VbaError {
  try {
    return 代休取得時間(rangeText(inputValues, 1));
  } catch (error) {
    return { kind: "error", code: error instanceof Error ? error.message : "#VALUE!" };
  }
}

/** Exact Range-array adapter for the extracted VBA 遅刻早退時間 function. */
export function 遅刻早退時間FromRanges(inputValues: readonly VbaValue[], codeValues: readonly VbaValue[]): number | VbaEmpty | VbaError {
  try {
    const input = vbaInput(inputValues);
    if ((input.flag ?? "") !== "") return VBA_EMPTY;
    const code = timeTable(codeValues);
    const start = input.start ?? 0;
    const end = input.end ?? 0;
    let minutes = 0;
    if ((code.morningStart ?? 0) < start) {
      if (start > (code.afternoonStart ?? 0)) minutes += ((code.afternoonStart ?? 0) - (code.morningStart ?? 0) + (code.morningEnd ?? 0) - (code.morningStart ?? 0)) * 1440;
      else if (start > (code.morningEnd ?? 0)) minutes += ((code.morningEnd ?? 0) - (code.morningStart ?? 0)) * 1440;
      else minutes += (start - (code.morningStart ?? 0)) * 1440;
    }
    if ((code.afternoonEnd ?? 0) > end) {
      if (end < (code.morningEnd ?? 0)) minutes += ((code.afternoonEnd ?? 0) - (code.afternoonStart ?? 0) + (code.morningEnd ?? 0) - end) * 1440;
      else if (end < (code.afternoonStart ?? 0)) minutes += ((code.afternoonEnd ?? 0) - (code.afternoonStart ?? 0)) * 1440;
      else minutes += ((code.afternoonEnd ?? 0) - end) * 1440;
    }
    return serialTime(minutes);
  } catch (error) {
    return { kind: "error", code: error instanceof Error ? error.message : "#VALUE!" };
  }
}

function interval(start: number | undefined, end: number | undefined): number {
  if (start === undefined || end === undefined) return 0;
  const from = hhmToMinutes(start);
  const to = hhmToMinutes(end);
  return Math.max(0, to >= from ? to - from : to + 1440 - from);
}

function timeResult(minutes: number): number | VbaEmpty {
  return minutes <= 0 ? VBA_EMPTY : timeSerial(Math.floor(minutes / 60), minutes % 60);
}

function findCode(table: readonly VbaCodeEntry[], flag: string): VbaCodeEntry | undefined {
  return table.find((entry) => entry.code === flag) ?? table.find((entry) => entry.code === "");
}

/** Port of the VBA 勤務時間 function. */
export function 勤務時間(input: VbaWorkInput, table: readonly VbaCodeEntry[]): number | VbaEmpty {
  if (input.start == null || input.end == null) return VBA_EMPTY;
  const code = findCode(table, input.flag ?? "");
  if (!code) return VBA_EMPTY;
  const inOffice = interval(input.start, input.end);
  const ordinary = hhmToMinutes(input.ordinaryBreak ?? 0);
  const night = hhmToMinutes(input.nightBreak ?? 0);
  const flag = input.flag ?? "";
  let result = inOffice - ordinary - night;
  if (flag === "") {
    result -= interval(code.lunchStart, code.lunchEnd) + interval(code.eveningBreakStart, code.eveningBreakEnd) + interval(code.nightBreakStart, code.nightBreakEnd) + interval(code.deepNightBreakStart, code.deepNightBreakEnd);
  } else if (["H", "DH", "KH", "TH", "THN"].includes(flag)) {
    result -= interval(code.lunchStart, code.lunchEnd);
  } else if (!["*", "F"].includes(flag)) {
    return VBA_EMPTY;
  }
  return timeResult(result);
}

/** Port of the VBA 残業時間 function. */
export function 残業時間(input: VbaWorkInput, table: readonly VbaCodeEntry[], type: "普通" | "深夜"): number | VbaEmpty {
  if (input.start == null || input.end == null) return VBA_EMPTY;
  const code = findCode(table, input.flag ?? "");
  if (!code) return VBA_EMPTY;
  const ordinary = hhmToMinutes(input.ordinaryBreak ?? 0);
  const night = hhmToMinutes(input.nightBreak ?? 0);
  const flag = input.flag ?? "";
  let result = 0;
  if (type === "深夜") {
    result = interval(code.deepNightStart, code.deepNightEnd) + interval(code.earlyNightStart, code.earlyNightEnd) - night;
  } else if (flag === "F") {
    result = Math.max(0, interval(input.start, input.end) - ordinary - night - 465);
  } else if (["", "H", "DH", "KH", "TH", "THN"].includes(flag)) {
    result = interval(code.nightStart, code.nightEnd) + interval(code.earlyStart, code.earlyEnd) - ordinary - night;
  } else if (flag === "*") {
    result = interval(input.start, input.end) - ordinary - night - 465;
  }
  return timeResult(result);
}

export function 代休取得時間(flag: string | null | undefined): number | VbaEmpty {
  if (flag === "D") return timeSerial(7, 45);
  if (flag === "DH") return timeSerial(3, 45);
  return VBA_EMPTY;
}

export type LateEarlyInput = {
  start?: number | null;
  end?: number | null;
  morningEnd?: number;
  afternoonStart?: number;
  lunchStart?: number;
  lunchEnd?: number;
};

/** Port of the 2025 VBA遅刻早退時間 branch (lunch excluded). */
export function 遅刻早退時間(input: LateEarlyInput): number | VbaEmpty {
  if (input.start == null || input.end == null) return VBA_EMPTY;
  const start = hhmToMinutes(input.start);
  const end = hhmToMinutes(input.end);
  const morningEnd = input.morningEnd == null ? null : hhmToMinutes(input.morningEnd);
  const afternoonStart = input.afternoonStart == null ? null : hhmToMinutes(input.afternoonStart);
  let result = 0;
  if (morningEnd !== null && start > 0) result += Math.max(0, start - morningEnd);
  if (afternoonStart !== null && end > 0) result += Math.max(0, afternoonStart - end);
  return timeResult(result);
}

export const VbaFunctionAdapter = {
  HMINT,
  INTHM,
  COUNTIF2,
  時間差,
  勤務時間,
  勤務時間FromRanges,
  残業時間,
  残業時間FromRanges,
  代休取得時間,
  代休取得時間FromRanges,
  遅刻早退時間,
  遅刻早退時間FromRanges,
};
