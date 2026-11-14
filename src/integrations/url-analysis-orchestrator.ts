import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** Whitelist-only classification: never reveal Analyst payloads, paths, credentials or page content. */
export function classifyAnalystToolError(content: unknown): string {
 const blocks = Array.isArray(content) ? content : [];
 const text = blocks.slice(0, 8).map((block: unknown) => {
  if (!block || typeof block !== "object") return "";
  const item = block as { type?: unknown; text?: unknown };
  return item.type === "text" && typeof item.text === "string" ? item.text.slice(0, 3000) : "";
 }).join(" ").toLowerCase();
 if (/executable doesn't exist|browser executable.*(not found|missing)|please run.*playwright install|browser.*not installed/.test(text)) return "ANALYST_BROWSER_BINARY_MISSING";
 if (/browser.*(failed to launch|launch failed)|failed to launch.*browser|target page, context or browser has been closed/.test(text)) return "ANALYST_BROWSER_LAUNCH_FAILED";
 if (/playwright|chromium|browser executable|browser.*install/.test(text)) return "ANALYST_BROWSER_RELATED_ERROR";
 if (/timeout|timed out|tempo esgotado/.test(text)) return "ANALYST_TARGET_TIMEOUT";
 if (/403|401|forbidden|unauthorized|access denied|acesso negado/.test(text)) return "ANALYST_TARGET_ACCESS_DENIED";
 if (/404|not found|não encontrad/.test(text)) return "ANALYST_TARGET_NOT_FOUND";
 if (/certificate|cert_|tls|ssl/.test(text)) return "ANALYST_TARGET_TLS_ERROR";
 if (/enotfound|dns|eai_again/.test(text)) return "ANALYST_TARGET_DNS_ERROR";
 if (/econnrefused|econnreset|net::err_|network error/.test(text)) return "ANALYST_TARGET_NETWORK_ERROR";
 if (/invalid.*(url|argument|parameter)|validation|zoderror|invalid_type|expected.*received|missing.*required/.test(text)) return "ANALYST_TOOL_INPUT_REJECTED";
 if (/missing.*(env|config|token|key)|not configured|configuration/.test(text)) return "ANALYST_CONFIGURATION_MISSING";
 return "ANALYST_TOOL_RETURNED_ERROR";
}

export interface UrlAnalysis { stage: "analyzed" | "needs_configuration"; tool: string | null; content: unknown[]; reason?: string; }
export function validatePageUrl(input: string): string {
 let url: URL;
 try { url = new URL(input); } catch { throw new Error("INVALID_PAGE_URL"); }
 if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash || input.length > 2048) throw new Error("INVALID_PAGE_URL");
 const host = url.hostname.toLowerCase();
 if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
 /^(127|0|10|192\.168)\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
 host === "::1" || host.startsWith("[") || /^169\.254\./.test(host)) throw new Error("PRIVATE_URL_DENIED");
 return url.href;
}
export function selectUrlAnalysisTool(tools: { name: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } }[]) {
 const preferred = ["inspect_legacy_source", "collect_page_evidence"];
 for (const name of preferred) {
  const tool = tools.find(t => t.name === name);
  if (!tool) continue;
  const props = tool.inputSchema?.properties ?? {};
  const required = tool.inputSchema?.required ?? [];
  const key = ["url", "pageUrl", "page_url", "targetUrl", "target_url"].find(k => Object.hasOwn(props, k));
  if (key && required.every(k => k === key)) return { name, key };
 }
 return null;
}
/** One MCP session; no unapproved side-effect tools, no raw data sent to GitHub. */
export async function analyzeUrlViaMcp(directory: string | undefined, url: string, onProgress?: (event: string) => void): Promise<UrlAnalysis> {
 const validatedUrl = validatePageUrl(url);
 onProgress?.("Validando configuração do Analyst");
 if (!directory) throw new Error("ANALYST_DIRECTORY_NOT_CONFIGURED");
 const root = await realpath(directory);
 const entry = await realpath(join(root, "mcp/dist/src/server.js"));
 if (!entry.startsWith(root + "/")) throw new Error("ANALYST_ENTRY_OUTSIDE_PROJECT");
 onProgress?.("Inicializando servidor MCP");
 const child = spawn(process.execPath, [entry], { cwd: root, shell: false, stdio: ["pipe", "pipe", "ignore"] });
 return await new Promise((resolve, reject) => {
  let finished = false;
  let selection: ReturnType<typeof selectUrlAnalysisTool> = null;
  const timer = setTimeout(() => done(new Error("ANALYST_TIMEOUT")), 120000);
  const reader = createInterface({ input: child.stdout });
  function done(error?: Error, result?: UrlAnalysis) {
   if (finished) return;
   finished = true; clearTimeout(timer); reader.close(); child.kill();
   if (error) reject(error); else resolve(result!);
  }
  function send(id: number, method: string, params: object) {
   if (!child.stdin.destroyed) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  }
  child.on("error", () => done(new Error("ANALYST_START_FAILED")));
  child.on("close", () => done(new Error("ANALYST_EXITED")));
  reader.on("line", line => {
   if (line.length > 1000000) return done(new Error("ANALYST_RESPONSE_TOO_LARGE"));
   try {
    const msg = JSON.parse(line) as { id?: number; error?: unknown; result?: { tools?: { name: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } }[]; content?: unknown[]; isError?: boolean } };
    if (msg.id === 1) {
     if (msg.error) return done(new Error("ANALYST_HANDSHAKE_FAILED"));
     child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
     onProgress?.("Descobrindo ferramentas disponíveis");
     send(2, "tools/list", {});
    } else if (msg.id === 2) {
     if (msg.error || !Array.isArray(msg.result?.tools)) return done(new Error("ANALYST_TOOL_DISCOVERY_FAILED"));
     selection = selectUrlAnalysisTool(msg.result.tools);
     if (!selection) return done(undefined, { stage: "needs_configuration", tool: null, content: [], reason: "URL_TOOL_SCHEMA_UNSUPPORTED" });
     onProgress?.("Executando " + selection.name);
     send(3, "tools/call", { name: selection.name, arguments: { [selection.key]: validatedUrl } });
    } else if (msg.id === 3) {
     if (msg.error) return done(new Error("ANALYST_RPC_CALL_ERROR"));
     if (msg.result?.isError) return done(new Error(classifyAnalystToolError(msg.result?.content)));
     if (!Array.isArray(msg.result?.content)) return done(new Error("ANALYST_INVALID_RESULT"));
     onProgress?.("Evidências recebidas; aguardando revisão");
     done(undefined, { stage: "analyzed", tool: selection!.name, content: msg.result.content });
    }
   } catch { /* Ignore non-JSON diagnostics. */ }
  });
  send(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "migration-maestro", version: "0.1.0" } });
 });
}
