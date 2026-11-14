import { runUePatternReadOnly, uePatternConfig, type UePatternConfig } from "./local-ue-pattern.js";
export type UeValidationState = "executed_unverified" | "blocked" | "unavailable";
export interface UeValidationGate { status: "review_required"; validation: UeValidationState; cliSucceeded: boolean; humanApprovalRequired: true; }
type Validator = typeof runUePatternReadOnly;
/** A successful CLI exit does not imply that its textual findings passed any UE rule. */
export async function evaluateUeValidationGate(
  componentPath: string, config: UePatternConfig | null = uePatternConfig(), validator: Validator = runUePatternReadOnly,
): Promise<UeValidationGate> {
  if (!config) return { status: "review_required", validation: "unavailable", cliSucceeded: false, humanApprovalRequired: true };
  try {
    await validator(config, "validar", componentPath);
    return { status: "review_required", validation: "executed_unverified", cliSucceeded: true, humanApprovalRequired: true };
  } catch {
    return { status: "review_required", validation: "blocked", cliSucceeded: false, humanApprovalRequired: true };
  }
}
