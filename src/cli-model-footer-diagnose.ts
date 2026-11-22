import { spawnSync } from "node:child_process";
import { readModelRouterConfig } from "./ai/model-router-config.js";
import { parseConnectedAgentNames } from "./integrations/maestri-model-router.js";
import { diagnoseModelFooter } from "./integrations/model-footer-diagnostic.js";

// Read-only list/check, raw responses remain in memory and are never logged.
const executable = process.env.MAESTRI_CLI || "maestri";
const run = (args: string[]) => {
  const result = spawnSync(executable, args, {
    shell: false, stdio: ["ignore", "pipe", "pipe"], timeout: 30000, maxBuffer: 128000,
  });
  return {
    ok: result.status === 0 && !result.error,
    exitCode: result.status,
    permissionDenied: /Operation not permitted|EPERM/.test(String(result.stderr)),
    raw: result.stdout?.toString("utf8") ?? "",
  };
};
const config = await readModelRouterConfig();
const listing = run(["list"]);
const names = listing.ok ? parseConnectedAgentNames(listing.raw) : [];
const agents = process.argv.slice(2);
const reports = (agents.length ? agents : ["Hermes", "Analytics", "UE-Pattern"]).map(agent => {
  const listedExactly = names.includes(agent);
  if (!listedExactly) return { agent, listedExactly, diagnostic: "AGENT_BINDING_NOT_VERIFIED" };
  const capture = run(["check", agent]);
  return {
    agent, listedExactly, command: ["check", agent], capturedAt: new Date().toISOString(),
    exitCode: capture.exitCode, permissionDenied: capture.permissionDenied,
    binding: "CLI target only; session identity is not attested",
    ...(capture.ok ? diagnoseModelFooter(agent, capture.raw, config) : { diagnostic: "CHECK_FAILED" }),
  };
});
console.log(JSON.stringify({ list: { ok: listing.ok, exitCode: listing.exitCode, permissionDenied: listing.permissionDenied }, reports }, null, 2));
if (!listing.ok || reports.some(report => !report.listedExactly || "diagnostic" in report)) process.exitCode = 1;
