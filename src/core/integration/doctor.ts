import { discoverMaestriAgents } from "../../adapters/maestri/discovery.js";
import { probeHermesCli } from "../../adapters/hermes/cli.js";

export interface IntegrationReport {
  maestri: { installed: boolean; agentsConnected: false; reason: string };
  hermes: { cliAvailable: boolean; executionConfigured: false; reason: string };
  readyForAutonomousExecution: false;
}

/** Read-only checks only. No prompts, private app data, credentials or agent execution. */
export async function inspectLocalIntegrations(): Promise<IntegrationReport> {
  const [maestri, hermesCli] = await Promise.all([
    discoverMaestriAgents(),
    probeHermesCli({ executable: "hermes", args: ["--version"], timeoutMs: 5000 })
  ]);
  return {
    maestri: {
      installed: maestri.appInstalled,
      agentsConnected: false,
      reason: maestri.appInstalled ? "INTEGRATION_NOT_CONFIGURED" : maestri.reason ?? "APP_NOT_FOUND"
    },
    hermes: {
      cliAvailable: hermesCli,
      executionConfigured: false,
      reason: hermesCli ? "EXECUTION_PROTOCOL_NOT_CONFIGURED" : "CLI_NOT_VERIFIED"
    },
    readyForAutonomousExecution: false
  };
}
