export function requestId(c: any) {
  return (c.get("requestId") as string | undefined) ?? "unknown";
}

export function logRequestStage(c: any, stage: string) {
  console.info("request_stage", JSON.stringify({ requestId: requestId(c), method: c.req.method, path: c.req.path, stage }));
}

function redact(value: string) {
  return value
    .replace(/(cookie|authorization|x-api-key|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]");
}

export function logRequestError(c: any, error: Error, id: string) {
  console.error("request_error", JSON.stringify({
    requestId: id,
    method: c.req.method,
    path: c.req.path,
    errorName: error.name,
    errorMessage: redact(error.message),
    stack: redact(error.stack ?? ""),
  }));
}
