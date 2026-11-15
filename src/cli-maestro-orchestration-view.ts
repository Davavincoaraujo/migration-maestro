import { startOrchestrationView } from "./maestro-orchestration-view.js";
const query=process.argv.slice(2).join(" ").trim() || "hero";
try {
  await startOrchestrationView(query);
  console.log("Migration Maestro: http://127.0.0.1:4188/");
  console.log("Abra no navegador. Atualize para acompanhar os agentes. Ctrl+C para encerrar.");
  console.log("Maestri.app: integração nativa não configurada.");
} catch { console.error("ORCHESTRATION_VIEW_UNAVAILABLE"); process.exitCode=1; }
