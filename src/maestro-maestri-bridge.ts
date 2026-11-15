/** Explicit Maestri CLI bridge. Run from a Maestri terminal with MAESTRI_SOCKET. */
import { spawn } from "node:child_process";
import { validatePageUrl } from "./integrations/url-analysis-orchestrator.js";
import { runAgentPlanning } from "./maestro-agent-planning.js";
import { createDispatchPreview } from "./maestro-agent-dispatch.js";

type BridgeResult = {
  mode: "maestri-local";
  url: string;
  planning: "completed";
  dispatched: string[];
  executionAuthorized: false;
  publishingAuthorized: false;
};
const targets = [
  { name: "Analytics", task: "inventory" },
  { name: "UE-Pattern", task: "mapping" },
  { name: "Hermes", task: "implementation" }
] as const;
export function requireMaestriSocket(socket: string | undefined): string {
  if (!socket || !socket.trim() || socket.includes("\0")) throw Error("MAESTRI_SOCKET_REQUIRED");
  return socket;
}
export async function askMaestri(name: string, prompt: string, timeoutMs = 30000): Promise<string> {
  requireMaestriSocket(process.env.MAESTRI_SOCKET);
  if (!targets.some(t => t.name === name) || prompt.length > 1200) throw Error("MAESTRI_TARGET_INVALID");
  return await new Promise((resolve, reject) => {
    const child = spawn("maestri", ["ask", name, "--raw", prompt], {
      shell: false, env: process.env, stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(Error("MAESTRI_TIMEOUT")); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); if (stdout.length > 8192) child.kill(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); if (stderr.length > 2048) child.kill(); });
    child.on("error", () => { clearTimeout(timer); reject(Error("MAESTRI_CLI_UNAVAILABLE")); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0 || stdout.length > 8192) reject(Error("MAESTRI_AGENT_UNAVAILABLE"));
      else resolve(stdout.trim());
    });
  });
}
/** Sends only generic, non-sensitive task instructions to existing Maestri nodes. */
export async function runMaestriBridge(urlInput: string): Promise<BridgeResult> {
  requireMaestriSocket(process.env.MAESTRI_SOCKET);
  const url = validatePageUrl(urlInput);
  const query = "hero"; // Generic connectivity probe; not evidence about the supplied URL.
  const planning = await runAgentPlanning(query);
  if (!planning.plan) throw Error("MAESTRO_PLANNING_UNAVAILABLE");
  const dispatch = createDispatchPreview(planning.plan);
  const dispatched: string[] = [];
  for (const target of targets) {
    const assignment = dispatch.assignments.find(t => t.taskId === target.task)!;
    const prompt = [
      "Migration Maestro: tarefa de planejamento local.",
      "Etapa: " + assignment.taskId + ".",
      "Nao execute comandos, nao altere arquivos, nao publique nem acesse dados privados.",
      "Apenas responda com uma confirmacao textual curta da tarefa atribuida.",
      "O plano ainda exige aprovacao humana."
    ].join("\n");
    await askMaestri(target.name, prompt);
    dispatched.push(target.name);
  }
  return {
    mode: "maestri-local", url, planning: "completed", dispatched,
    executionAuthorized: false, publishingAuthorized: false
  };
}
