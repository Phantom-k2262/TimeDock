export interface DailyAttendanceInput {
  startTime: string | null | undefined;
  endTime: string | null | undefined;
  ordinaryBreakMinutes?: number | null;
  nightBreakMinutes?: number | null;
}

export interface DailyAttendanceResult {
  ordinaryBreakMinutes: number;
  nightBreakMinutes: number;
  totalBreakMinutes: number;
  workedMinutes: number | null;
}

import type { BusinessCalculationEngine } from "./types";

function minutes(value: string | null | undefined) {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

export function calculateDailyAttendance(input: DailyAttendanceInput): DailyAttendanceResult {
  const ordinaryBreakMinutes = Math.max(0, Math.trunc(Number(input.ordinaryBreakMinutes ?? 0)) || 0);
  const nightBreakMinutes = Math.max(0, Math.trunc(Number(input.nightBreakMinutes ?? 0)) || 0);
  const start = minutes(input.startTime);
  const end = minutes(input.endTime);
  const span = start === null || end === null ? null : (end >= start ? end - start : end + 24 * 60 - start);
  return { ordinaryBreakMinutes, nightBreakMinutes, totalBreakMinutes: ordinaryBreakMinutes + nightBreakMinutes, workedMinutes: span === null ? null : Math.max(0, span - ordinaryBreakMinutes - nightBreakMinutes) };
}

export class AttendanceCalculationEngine implements BusinessCalculationEngine<DailyAttendanceInput, DailyAttendanceResult> {
  calculate(input: DailyAttendanceInput) { return calculateDailyAttendance(input); }
}
