export type CpuUsage = { user: number; system: number };

type RuntimeWithMetrics = {
  cpuUsage?: (previous?: CpuUsage) => CpuUsage;
  memoryUsage?: () => { heapUsed: number };
};

function runtimeMetrics(value: unknown) {
  return value as RuntimeWithMetrics | undefined;
}

export function readCpuUsage(runtime: unknown, previous?: CpuUsage) {
  try {
    const usage = runtimeMetrics(runtime)?.cpuUsage?.(previous);
    return usage && Number.isFinite(usage.user) && Number.isFinite(usage.system) ? usage : undefined;
  } catch {
    return undefined;
  }
}

export function readHeapUsed(runtime: unknown) {
  try {
    const heapUsed = runtimeMetrics(runtime)?.memoryUsage?.().heapUsed;
    return heapUsed !== undefined && Number.isFinite(heapUsed) ? heapUsed : undefined;
  } catch {
    return undefined;
  }
}
