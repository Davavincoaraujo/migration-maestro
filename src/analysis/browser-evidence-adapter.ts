import type { LegacyEvidence } from "./legacy-evidence.js";
import { analyzeLegacyEvidence } from "./legacy-evidence.js";

/** A browser implementation is injected by the approved execution environment. */
export interface BrowserEvidenceDriver {
  collect(url: string, pageId: string, signal: AbortSignal): Promise<LegacyEvidence>;
}
export interface BrowserEvidenceOptions {
  allowedOrigins: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
}
export async function collectAuthorizedEvidence(
  url: string,
  pageId: string,
  driver: BrowserEvidenceDriver,
  options: BrowserEvidenceOptions,
): Promise<ReturnType<typeof analyzeLegacyEvidence>> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(pageId) ||
      !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 120000 ||
      !Array.isArray(options.allowedOrigins) || options.allowedOrigins.length < 1 || options.allowedOrigins.length > 20) {
    throw new Error("Invalid browser evidence configuration");
  }
  let target: URL;
  try { target = new URL(url); } catch { throw new Error("Invalid source URL"); }
  if (target.protocol !== "https:" || target.username || target.password || target.hash) throw new Error("Source URL not allowed");
  const allowed = options.allowedOrigins.some(origin => {
    try {
      const parsed = new URL(origin);
      return parsed.protocol === "https:" && parsed.origin === origin && parsed.origin === target.origin;
    } catch { return false; }
  });
  if (!allowed) throw new Error("Source origin not authorized");
  if (options.signal?.aborted) throw new Error("Evidence collection cancelled");
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const evidence = await driver.collect(target.href, pageId, controller.signal);
    if (controller.signal.aborted) throw new Error("Evidence collection cancelled or timed out");
    if (evidence.pageId !== pageId) throw new Error("Evidence page mismatch");
    return analyzeLegacyEvidence(evidence);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
