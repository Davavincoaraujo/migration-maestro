import { discoverMaestriAgents } from "./adapters/maestri/discovery.js";

const result = await discoverMaestriAgents();
if (result.appInstalled) {
  console.log("Maestri.app detectado: " + result.appPath);
  console.log("Descoberta de agentes: não configurada (INTEGRATION_NOT_CONFIGURED).");
  console.log("Nenhuma CLI, API ou acesso a arquivos privados do Maestri foi presumido.");
} else {
  console.error("Maestri.app não detectado (" + result.reason + ").");
  process.exitCode = 1;
}
