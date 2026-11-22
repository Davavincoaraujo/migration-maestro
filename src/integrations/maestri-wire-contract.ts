/** Offline, minimal metadata projection of the documented ChatSnapshot envelope.
 * Source: https://www.themaestri.app/en/docs/wire#terminal-chat (2026-11-17).
 * This is NOT a network adapter, full transcript validator, or authentication check.
 * No entries, attachments, names or unknown fields leave this projection.
 */
export interface WireChatMetadata {
  terminalId: string;
  conversationId: string;
  enabled: boolean;
  status: string;
  unreadCount: number;
  canClear: boolean;
}

/** The documented prompt route targets a terminal, not an expected provider session.
 * Separate reads cannot close that race or authenticate the result's author.
 * Keep this independent from session attestation and human authorization.
 * No supported session-bound dispatch adapter is currently implemented.
 */
export function requireMaestriSessionBoundDispatch(): never {
  throw Error("MAESTRI_SESSION_BOUND_DISPATCH_UNSUPPORTED");
}

const uuid = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

export function projectWireChatMetadata(value: unknown): WireChatMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.terminalId !== "string" || !uuid.test(input.terminalId) ||
      typeof input.conversationId !== "string" || !uuid.test(input.conversationId) ||
      typeof input.enabled !== "boolean" || typeof input.status !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9-]{0,63}$/.test(input.status) || !Array.isArray(input.entries) ||
      typeof input.unreadCount !== "number" || !Number.isSafeInteger(input.unreadCount) || input.unreadCount < 0 ||
      typeof input.canClear !== "boolean") return null;
  // Status strings are open enums. Unknown values remain observations, never access evidence.
  return { terminalId: input.terminalId, conversationId: input.conversationId,
    enabled: input.enabled, status: input.status, unreadCount: input.unreadCount, canClear: input.canClear };
}

/** Shape validity and a matching target cannot prove transport authenticity or provider identity. */
export function inspectWireChatContract(value: unknown, expectedTerminalId: string) {
  const metadata = projectWireChatMetadata(value);
  return {
    metadata,
    terminalTargetMatches: metadata !== null && metadata.terminalId === expectedTerminalId,
    modelObserved: false as const,
    identityVerified: false as const,
    availabilityVerified: false as const,
    availability: "unknown" as const,
    diagnostic: metadata ? "WIRE_MODEL_CONTRACT_NOT_EXPOSED" : "WIRE_CHAT_METADATA_INVALID",
  };
}
