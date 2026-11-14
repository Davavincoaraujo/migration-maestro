import { runUePatternReadOnly, uePatternConfig, type UePatternConfig } from "./local-ue-pattern.js";
import { parseUeValidationReport, type UeReportStatus } from "./ue-report-parser.js";
export type UeValidationState = UeReportStatus | "blocked" | "unavailable";
export interface UeValidationGate {
  status: "review_required"; validation: UeValidationState; cliSucceeded: boolean;
  humanApprovalRequired: true; errors: number | null; warnings: number | null; infos: number | null;
}
type Validator = typeof runUePatternReadOnly;
function unavailable(validation: "blocked" | "unavailable"): UeValidationGate {
  return { status: "review_required", validation, cliSucceeded: false, humanApprovalRequired: true, errors: null, warnings: null, infos: null };
}
/** No raw local findings leave this boundary. CLI success is not an architectural approval. */
export async function evaluateUeValidationGate(
  componentPath: string, config: UePatternConfig | null = uePatternConfig(), validator: Validator = runUePatternReadOnly,
): Promise<UeValidationGate> {
  if (!config) return unavailable("unavailable");
  try {
    const result = await validator(config, "validar", componentPath);
    const parsed = parseUeValidationReport(result.output);
    return { status: "review_required", validation: parsed.validation, cliSucceeded: true, humanApprovalRequired: true,
      errors: parsed.validation === "unverified" ? null : parsed.errors,
      warnings: parsed.validation === "unverified" ? null : parsed.warnings,
      infos: parsed.validation === "unverified" ? null : parsed.infos };
  } catch { return unavailable("blocked"); }
}
