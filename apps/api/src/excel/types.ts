import type { AttendanceExportFormat } from "@timesheet/shared";

export type WorkbookEntries = Record<string, Uint8Array>;
export type CellValue = string | number | boolean | Date | null;

export interface WorkbookEditor {
  load(source: ArrayBuffer | Uint8Array): Promise<void>;
  setCellValue(sheet: string, cell: string, value: CellValue): Promise<void>;
  export(): Promise<Uint8Array>;
}

export interface TemplateRepository {
  get(format: AttendanceExportFormat): Promise<{ id: string; name: string; data: Uint8Array } | null>;
}

export interface WorkbookInspection {
  sheets: Array<{ name: string; path: string; state: string }>;
  definedNames: string[];
  formulaCount: number;
  customFormulaCount: number;
  hasVbaProject: boolean;
  hasCalcChain: boolean;
}

export interface WorkbookInspector {
  inspect(entries: WorkbookEntries): WorkbookInspection;
}

export interface TemplateMappingResolver {
  resolve(logicalName: string): string | null;
}

export interface VbaAnalysis {
  present: boolean;
  sourceAvailable: boolean;
  reason: string;
}

export interface VbaAnalyzer {
  analyze(entries: WorkbookEntries): VbaAnalysis;
}

export interface BusinessCalculationEngine<TInput, TResult> {
  calculate(input: TInput): TResult;
}

export type FormulaEvaluationStatus = "evaluated" | "deferred-to-excel" | "unsupported";

export interface FormulaEvaluationResult {
  formula: string;
  status: FormulaEvaluationStatus;
  reason?: string;
  value?: string | number | boolean | null;
}

export interface IntegrityIssue {
  path: string;
  kind: "missing" | "added" | "changed";
  detail: string;
}

export interface IntegrityReport {
  ok: boolean;
  issues: IntegrityIssue[];
  preserved: string[];
  allowedChanges: string[];
}

export interface WorkbookIntegrityValidator {
  validate(before: WorkbookEntries, after: WorkbookEntries, allowedPaths: string[]): IntegrityReport;
}

export interface WorkbookExportService<TInput> {
  export(template: Uint8Array, input: TInput): Promise<Uint8Array>;
}

export interface ExcelApplicationService<TInput> {
  inspect(template: Uint8Array): WorkbookInspection;
  export(template: Uint8Array, input: TInput): Promise<Uint8Array>;
}
