export type UeReportStatus = "passed" | "passed_with_warnings" | "failed" | "unverified";
export interface UeReportSummary { validation: UeReportStatus; errors: number; warnings: number; infos: number; }
const header = /^(OK|FALHOU)\s+[^\r\n]+\s+—\s+(\d+)\s+erro\(s\),\s+(\d+)\s+aviso\(s\)\s*$/;
const finding = /^- \[(aviso|erro|info)\]\s+.+$/;
/** Fail closed if output format, header totals or finding counts differ. Never return source text. */
export function parseUeValidationReport(output: string): UeReportSummary {
  const unverified = (): UeReportSummary => ({ validation: "unverified", errors: 0, warnings: 0, infos: 0 });
  if (output.length > 64000) return unverified();
  const lines = output.trim().split(/\r?\n/);
  const match = header.exec(lines[0] ?? "");
  if (!match) return unverified();
  const errors = Number(match[2]), warnings = Number(match[3]);
  if (!Number.isSafeInteger(errors) || !Number.isSafeInteger(warnings)) return unverified();
  let seenErrors = 0, seenWarnings = 0, infos = 0;
  for (const line of lines.slice(1)) {
    const found = finding.exec(line);
    if (!found) return unverified();
    if (found[1] === "erro") seenErrors++;
    else if (found[1] === "aviso") seenWarnings++;
    else infos++;
  }
  if (seenErrors !== errors || seenWarnings !== warnings) return unverified();
  if ((match[1] === "OK") !== (errors === 0)) return unverified();
  return { validation: errors > 0 ? "failed" : warnings > 0 ? "passed_with_warnings" : "passed", errors, warnings, infos };
}
