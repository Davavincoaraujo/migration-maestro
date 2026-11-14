import test from "node:test";
import assert from "node:assert/strict";
import { parseUeValidationReport } from "../src/integrations/ue-report-parser.js";
import { evaluateUeValidationGate } from "../src/integrations/ue-validation-gate.js";
import type { UePatternConfig } from "../src/integrations/local-ue-pattern.js";
const config: UePatternConfig = { cliDirectory: "/synthetic/ue", projectDirectory: "/synthetic/components" };
const report = `OK principal/banner-service@v1 — 0 erro(s), 4 aviso(s)
- [aviso] definition/dl-fields · definition.ts — missing
- [aviso] definition/abas · definition.ts — missing
- [aviso] mapper/satisfies · mapper.ts — missing
- [aviso] tsx/editor-props · banner.tsx — missing
- [info] css/tokens · Banner.module.css — internal secret`;
test("parses actual report format and counts without exposing findings", async () => {
 const parsed = parseUeValidationReport(report);
 assert.deepEqual(parsed, { validation: "passed_with_warnings", errors: 0, warnings: 4, infos: 1 });
 const gate = await evaluateUeValidationGate("principal/sections/banner-service/v1", config, async () => ({ command: "validar", output: report }));
 assert.equal(gate.validation, "passed_with_warnings");
 assert.equal(gate.humanApprovalRequired, true);
 assert.equal(JSON.stringify(gate).includes("internal secret"), false);
});
test("clean report passes but remains review required", async () => {
 const gate = await evaluateUeValidationGate("x/y/v1", config, async () => ({ command: "validar", output: "OK x/y@v1 — 0 erro(s), 0 aviso(s)" }));
 assert.equal(gate.validation, "passed");
 assert.equal(gate.status, "review_required");
});
test("error findings fail", () => {
 assert.equal(parseUeValidationReport("FALHOU x/y@v1 — 1 erro(s), 0 aviso(s)\n- [erro] test · x — issue").validation, "failed");
});
test("mismatched totals or unexpected output fail closed", () => {
 assert.equal(parseUeValidationReport("OK x/y@v1 — 0 erro(s), 4 aviso(s)").validation, "unverified");
 assert.equal(parseUeValidationReport("SENSITIVE CORPORATE FINDINGS").validation, "unverified");
 assert.equal(parseUeValidationReport("OK x/y@v1 — 1 erro(s), 0 aviso(s)\n- [erro] x").validation, "unverified");
});
test("failed command and missing config do not leak details", async () => {
 const failed = await evaluateUeValidationGate("x/y/v1", config, async () => { throw new Error("PRIVATE FILE PATH"); });
 assert.equal(failed.validation, "blocked");
 assert.equal(failed.errors, null);
 assert.equal(JSON.stringify(failed).includes("PRIVATE"), false);
 assert.equal((await evaluateUeValidationGate("x/y/v1", null)).validation, "unavailable");
});
