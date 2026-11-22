import { resolve } from "node:path";

/** Operator-supplied scope, never inferred from credentials or --autopilot. */
export interface ExecutionAuthorization {
  version: 1;
  jobId: string;
  environment: "non-production";
  authorOrigin: string;
  project: string;
  pageRoot: string;
  damRoot: string;
  portalEdits: boolean;
  aemCreate: boolean;
  approvedBy: string;
}
export function assertExecutionAuthorized(value: ExecutionAuthorization | undefined, scope: {
  jobId: string; project: string; pageRoot: string; damRoot: string; authorUrl?: string;
}, operation: "portalEdits" | "aemCreate") {
  let origin: string | undefined;
  try { origin = new URL(scope.authorUrl ?? "").origin; } catch { /* Fail closed below. */ }
  if (!value || value.version !== 1 || value.jobId !== scope.jobId || value.environment !== "non-production" ||
      typeof value.project !== "string" || resolve(value.project) !== resolve(scope.project) ||
      value.pageRoot !== scope.pageRoot || value.damRoot !== scope.damRoot ||
      !origin || value.authorOrigin !== origin || !/^http:\/\/(?:localhost|127\.0\.0\.1):4502$/.test(origin) ||
      value[operation] !== true || typeof value.approvedBy !== "string" || !value.approvedBy.trim() || value.approvedBy.length > 200) throw Error("EXECUTION_AUTHORIZATION_REQUIRED_" + operation.toUpperCase());
}
