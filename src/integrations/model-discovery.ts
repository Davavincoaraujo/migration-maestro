import { spawn } from "node:child_process";
import type { AdaptiveModelCandidate, AdaptiveProfile, Provider } from "../ai/model-router.js";
import { configuredModelProfile, readModelRouterConfig, type ModelRouterConfig } from "../ai/model-router-config.js";

export interface DiscoveredModel {
  provider: Provider;
  id: string;
  displayName: string;
  profile: AdaptiveProfile | "UNKNOWN";
  supportedEffort: string[];
  availability: "cli-catalog" | "cli-alias";
  source: AdaptiveModelCandidate["source"];
  price: null;
  usageMetrics: null;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("MODEL_CATALOG_NOT_JSON");
  const value: unknown = JSON.parse(raw.slice(start));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MODEL_CATALOG_NOT_OBJECT");
  return value as Record<string, unknown>;
}

/** Accepts only the small public runtime-catalog fields; prompt text is discarded in memory. */
export function parseCodexModelCatalog(raw: string, config: ModelRouterConfig): DiscoveredModel[] {
  const root = parseJsonObject(raw);
  if (!Array.isArray(root.models) || root.models.length > 1000) throw new Error("INVALID_CODEX_MODEL_CATALOG");
  const result: DiscoveredModel[] = [];
  for (const value of root.models) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const model = value as Record<string, unknown>;
    if (model.visibility !== "list" || typeof model.slug !== "string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(model.slug) ||
      typeof model.display_name !== "string" || model.display_name.length > 120) continue;
    const effort = Array.isArray(model.supported_reasoning_levels)
      ? model.supported_reasoning_levels.flatMap(item => item && typeof item === "object" && "effort" in item && typeof item.effort === "string" && /^[a-z-]{1,24}$/.test(item.effort) ? [item.effort] : [])
      : [];
    result.push({ provider: "codex", id: model.slug, displayName: model.display_name,
      profile: configuredModelProfile("codex", model.slug, config), supportedEffort: [...new Set(effort)],
      availability: "cli-catalog", source: "codex-cli-catalog", price: null, usageMetrics: null });
  }
  return result;
}

/** Claude Code help names aliases it accepts; this does not prove account entitlement. */
export function parseClaudeModelAliases(help: string, config: ModelRouterConfig): DiscoveredModel[] {
  const aliases = new Set<string>();
  const match = help.match(/--model[\s\S]{0,500}?alias for the latest model[\s\S]{0,160}?\(([^)]+)\)/i);
  if (match) for (const alias of match[1].matchAll(/\b([a-z][a-z0-9-]{1,24})\b/gi)) {
    const id = alias[1].toLowerCase();
    if (["sonnet", "opus", "haiku", "fable", "mythos"].includes(id)) aliases.add(id);
  }
  return [...aliases].map(id => ({ provider: "claude-code", id, displayName: `Claude Code alias: ${id}`,
    profile: configuredModelProfile("claude-code", id, config), supportedEffort: [], availability: "cli-alias" as const,
    source: "claude-code-help" as const, price: null, usageMetrics: null }));
}

/** Shared preprocessing: remove SGR styling only, never redact or normalize text. */
export function stripModelFooterStyling(raw: string): string {
  return raw.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Closed auxiliary UI grammar, not a classifier for model lines or conversation.
 * Unknown means unproven; neither line length nor partial UI hints permit skipping it.
 * Classification never returns terminal text or paths.
 */
export function classifyCodexAuxiliaryLine(line: string): "shortcuts" | "context-left" | "border" | "blank" | "unknown" | "unsafe-control" {
  if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(line)) return "unsafe-control";
  const value = line.trim();
  if (!value) return "blank";
  if (value === "? for shortcuts") return "shortcuts";
  if (/^(?:100|[1-9]?\d)% context left$/.test(value)) return "context-left";
  // Borders are diagnostic evidence only, never permission to skip a line.
  if (/^[\u2500-\u257f|+\-=]+$/.test(value)) return "border";
  return "unknown";
}

export function parseRenderedModelFooter(screen: string) {
  const plain = stripModelFooterStyling(screen);
  // Only LF/CRLF and SGR styling are supported, not terminal cursor emulation.
  if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(plain.replaceAll("\r\n", "\n"))) return null;
  const lines = plain.trimEnd().split(/\r?\n/);
  let index = lines.length - 1;
  const auxiliary = classifyCodexAuxiliaryLine(lines[index] ?? "");
  // Bounded tail only: never search history, nor skip arbitrary text/borders.
  if (auxiliary === "shortcuts" || auxiliary === "context-left") index--;
  const line = lines[index]?.trim() ?? "";
  const match = line.match(/^(GPT-[A-Za-z0-9.-]+|Claude\s+[A-Za-z0-9._-]+(?:\s+\d+(?:\.\d+)?)?)(?:\s+(?:default|none|minimal|low|medium|high|xhigh|max|ultra)(?:\s+·\s+\S.*)?|\s+·\s+\S.*)$/i);
  if (!match || (index !== lines.length - 1 && (!/^GPT-/i.test(match[1]) || !line.includes(" · ")))) return null;
  return { visibleModel: match[1].replace(/\s+/g, " "), distanceFromEnd: lines.length - 1 - index };
}

export interface MaestriSessionMetadata {
  agentId: string;
  provider: Provider;
  modelId: string | null;
  profile: AdaptiveProfile | "UNKNOWN";
  usagePressure: "near-limit" | "none-reported";
  availability: "available" | "rate-limited" | "unknown";
  source: "maestri-session";
  agentAssociation: "command-target";
  /** Observation is diagnostic text, not an authenticated session binding. */
  modelObserved: boolean;
  identityVerified: false;
  availabilityVerified: false;
  sessionIdentityVerified: false;
  currentFooterVerified: false;
  footerStructureRecognized: boolean;
  identityDiagnostic: "MAESTRI_SESSION_IDENTITY_NOT_VERIFIED";
  diagnostic: "MAESTRI_SESSION_MODEL_NOT_EXPOSED" | "MAESTRI_SESSION_PROFILE_NOT_CONFIGURED" | "MAESTRI_SESSION_CHECK_FAILED" | "MAESTRI_SESSION_AVAILABILITY_NOT_VERIFIED" | null;
}

/** Diagnostic model observation from the final rendered footer.
 * `check` exposes text, not an authenticated session/model/entitlement record.
 * A selected model alone cannot prove availability; fail closed until an official
 * per-session availability source can be verified. Do not infer it from a catalog.
 */
export function parseMaestriSessionMetadata(agentId: string, screen: string, config: ModelRouterConfig): MaestriSessionMetadata {
  const footer = parseRenderedModelFooter(screen);
  const visibleModel = footer?.visibleModel ?? null;
  const provider: Provider = visibleModel ? (/^gpt-/i.test(visibleModel) ? "codex" : /^claude\s/i.test(visibleModel) ? "claude-code" : "unknown") : "unknown";
  const slug = visibleModel?.toLowerCase().replace(/^claude\s+/, "claude-").replaceAll(" ", "-") ?? null;
  const nearLimit = /less than\s+\d+% of your|approaching rate limits|near(?:ing)? (?:the )?(?:usage|rate) limit/i.test(screen);
  return { agentId, provider, modelId: slug, profile: slug ? configuredModelProfile(provider, slug, config) : "UNKNOWN",
    usagePressure: nearLimit ? "near-limit" : "none-reported", availability: "unknown",
    source: "maestri-session", agentAssociation: "command-target", sessionIdentityVerified: false,
    modelObserved: footer !== null, identityVerified: false, availabilityVerified: false,
    currentFooterVerified: false, footerStructureRecognized: footer !== null,
    identityDiagnostic: "MAESTRI_SESSION_IDENTITY_NOT_VERIFIED", diagnostic: !slug ? "MAESTRI_SESSION_MODEL_NOT_EXPOSED"
      : configuredModelProfile(provider, slug, config) === "UNKNOWN" ? "MAESTRI_SESSION_PROFILE_NOT_CONFIGURED"
      : "MAESTRI_SESSION_AVAILABILITY_NOT_VERIFIED" };
}

export function maestriSessionCandidate(session: MaestriSessionMetadata, capabilities: readonly string[]): AdaptiveModelCandidate {
  return { id: session.agentId, provider: session.provider, modelId: session.modelId ?? "unknown", profile: session.profile,
    capabilities: [...capabilities], availability: session.availability === "rate-limited" ? "unavailable" : session.availability,
    source: "maestri-session" };
}

function run(command: string, args: string[], timeoutMs = 12000, outputLimit = 8_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "ignore"] });
    let output = "", size = 0, settled = false;
    const finish = (error?: string) => { if (settled) return; settled = true; clearTimeout(timer); if (error) { child.kill(); reject(new Error(error)); } else resolve(output); };
    const timer = setTimeout(() => finish("MODEL_DISCOVERY_TIMEOUT"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > outputLimit) finish("MODEL_DISCOVERY_OUTPUT_LIMIT"); else output += chunk.toString(); });
    child.on("error", () => finish("MODEL_CLI_UNAVAILABLE"));
    child.on("close", code => finish(code === 0 ? undefined : "MODEL_DISCOVERY_FAILED"));
  });
}

/** Installed CLIs are inspected read-only. Account access and configured Maestri sessions remain separate checks. */
export async function discoverInstalledModels(options: { codex?: string; claude?: string } = {}): Promise<{
  codex: { state: "discovered" | "unavailable"; models: DiscoveredModel[] };
  claude: { state: "discovered" | "unavailable"; models: DiscoveredModel[] };
}> {
  const config = await readModelRouterConfig();
  const [codex, claude] = await Promise.all([
    run(options.codex ?? "codex", ["debug", "models"]).then(raw => ({ state: "discovered" as const, models: parseCodexModelCatalog(raw, config) })).catch(() => ({ state: "unavailable" as const, models: [] as DiscoveredModel[] })),
    run(options.claude ?? "claude", ["--help"]).then(raw => ({ state: "discovered" as const, models: parseClaudeModelAliases(raw, config) })).catch(() => ({ state: "unavailable" as const, models: [] as DiscoveredModel[] })),
  ]);
  return { codex, claude };
}
