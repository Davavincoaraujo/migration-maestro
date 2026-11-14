import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchAnalystCatalogLocal } from "./integrations/local-analyst-catalog.js";
import { buildMatchingPlan } from "./integrations/component-matching-engine.js";
import { assessCompatibility, validateRequirements } from "./integrations/component-compatibility.js";
import { evaluateUeValidationGate } from "./integrations/ue-validation-gate.js";
import { buildAutopilotAdvisoryPlan } from "./integrations/autopilot-advisory-plan.js";
import { readBindingManifest, verifyBoundComponent } from "./integrations/component-binding-resolver.js";
import { uePatternConfig } from "./integrations/local-ue-pattern.js";
const [query, requirementsFile, bindingsFile, ...extra] = process.argv.slice(2);
if (!query || query.length > 120 || /[\x00-\x1f]/.test(query) || !requirementsFile || !bindingsFile || extra.length) {
  process.stderr.write("Uso: npm run autopilot:resolve -- banner ./requirements.local.json ./local-input/bindings.json\n");
  process.exitCode = 1;
} else {
  try {
    const info = await stat(resolve(requirementsFile));
    if (!info.isFile() || info.size > 16000) throw new Error("INVALID_REQUIREMENTS_FILE");
    const requirements = validateRequirements(JSON.parse(await readFile(resolve(requirementsFile), "utf8")));
    const bindings = await readBindingManifest(bindingsFile);
    const config = uePatternConfig();
    const catalog = await fetchAnalystCatalogLocal(process.env.MAESTRO_ANALYTICS_DIR, { tool: "search_component_catalog", query, limit: 5 });
    const candidates = buildMatchingPlan(catalog.content).candidates.slice(0, 3);
    const plans = [];
    for (const candidate of candidates) {
      const binding = bindings.bindings.find(b => b.catalogId === candidate.id);
      const resolved = Boolean(config && binding && await verifyBoundComponent(config, binding.componentPath));
      const gate = resolved && binding ? await evaluateUeValidationGate(binding.componentPath, config) : null;
      let compatibility;
      try {
        const evidence = await fetchAnalystCatalogLocal(process.env.MAESTRO_ANALYTICS_DIR, { tool: "inspect_component", idOrName: candidate.id });
        compatibility = assessCompatibility(requirements, evidence.content);
      } catch {
        const required = requirements.capabilities.length + requirements.variants.length + requirements.fieldTypes.length;
        compatibility = { decision: "insufficient_evidence" as const, status: "review_required" as const, required, matched: 0, missing: required, unsupportedEvidence: true };
      }
      const plan = gate ? buildAutopilotAdvisoryPlan(compatibility, gate) : null;
      plans.push({
        binding: !binding ? "missing" : resolved ? "explicit_local_verified" : "invalid_local_path",
        validation: gate?.validation ?? "unavailable",
        decision: !resolved || !gate || !plan ? "investigate" : plan.decision,
        required: compatibility.required, matched: compatibility.matched, missing: compatibility.missing,
        ueErrors: gate?.errors ?? null, ueWarnings: gate?.warnings ?? null, ueInfos: gate?.infos ?? null,
        status: "review_required", humanApprovalRequired: true, codeExecutionAuthorized: false,
        nextAction: !resolved ? "resolve_binding" : plan?.nextAction ?? "investigate_evidence",
      });
    }
    process.stdout.write(JSON.stringify({
      status: "review_required", assessed: plans.length, bindingSource: "explicit_local_manifest",
      humanApprovalRequired: true, codeExecutionAuthorized: false, plans,
    }, null, 2) + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    process.stderr.write("Falha na resolução: " + (/^(ANALYST_|INVALID_|EMPTY_)[A-Z_]+$/.test(message) ? message : "AUTOPILOT_RESOLVE_FAILED") + "\n");
    process.exitCode = 1;
  }
}
