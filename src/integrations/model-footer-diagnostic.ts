import type { ModelRouterConfig } from "../ai/model-router-config.js";
import { classifyCodexAuxiliaryLine, parseMaestriSessionMetadata, parseRenderedModelFooter, stripModelFooterStyling } from "./model-discovery.js";

// Diagnostic only: no candidate here is promoted to session identity.
export function diagnoseModelFooter(agent: string, raw: string, config: ModelRouterConfig) {
  const lines = raw.trimEnd().split(/\r?\n/);
  const shape = (line: string) => {
    const plain = stripModelFooterStyling(line);
    const auxiliary = classifyCodexAuxiliaryLine(plain);
    return {
      classification: parseRenderedModelFooter(line) ? "model-line" : auxiliary,
      auxiliaryClassification: auxiliary,
      classifierInput: "original-minus-sgr",
      stylingRemoved: plain !== line,
      length: line.length,
      trimmedLength: plain.trim().length,
      // Diagnostic signals only. A substring can also occur in conversation;
      // none of these signals is used by the operational parser.
      signals: {
        shortcutHint: /\? for shortcuts/.test(plain),
        contextHint: /\b(?:100|[1-9]?\d)% context left\b/.test(plain),
        keyBindingHint: /\b(?:ctrl|shift|alt|cmd)[+-][a-z0-9]+\b/i.test(plain),
        warningMarker: /[⚠‼]/u.test(plain),
        columnGapCount: [...plain.trim().matchAll(/ {2,}/g)].length,
        separatorCount: [...plain.matchAll(/[·│|]/g)].length,
      },
      controls: [...line.matchAll(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g)]
        .map(m => ({ offset: m.index, code: `U+${m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}` })),
      sgr: line.match(/\x1b\[[0-9;]*m/g) ?? [],
      // Only a purely structural line can be disclosed verbatim.
      structuralLine: /^[\s\u2500-\u257f|+\-=]*$/.test(plain) ? plain : null,
      hasOtherEscape: plain.includes("\x1b"),
    };
  };
  // Only inspect the bounded tail, never emit model-shaped conversation history.
  const tailStart = Math.max(0, lines.length - 5);
  const candidates = lines.slice(tailStart).flatMap((line, offset) => {
    const index = tailStart + offset;
    if (!parseMaestriSessionMetadata(agent, line, config).modelId) return [];
    const plain = stripModelFooterStyling(line).trim();
    const prefix = plain.match(/^(GPT-[A-Za-z0-9.-]+|Claude\s+[A-Za-z0-9._-]+(?:\s+\d+(?:\.\d+)?)?)(?:\s+(default|none|minimal|low|medium|high|xhigh|max|ultra))?/i)!;
    return [{
      distanceFromEnd: lines.length - 1 - index,
      candidateLine: prefix[0] + (plain.length > prefix[0].length ? " [suffix redacted]" : ""),
      suffixLength: plain.length - prefix[0].length,
      separator: plain.slice(prefix[0].length).trimStart().startsWith("·") ? "·" : null,
      format: shape(line),
      followingLines: lines.slice(index + 1, index + 5).map(shape),
      followingLinesOmitted: Math.max(0, lines.length - index - 5),
      currentFooterVerified: false,
    }];
  }).slice(-3);
  const session = parseMaestriSessionMetadata(agent, raw, config);
  return {
    candidates,
    candidateSearch: "last-five-lines-only",
    queriedAgent: agent,
    agentAssociation: "command-target",
    sessionIdentityVerified: false,
    modelObserved: session.modelObserved,
    identityVerified: session.identityVerified,
    availabilityVerified: session.availabilityVerified,
    footerStructureRecognized: session.footerStructureRecognized,
    identityDiagnostic: "MAESTRI_SESSION_IDENTITY_NOT_VERIFIED",
    parserDiagnostic: session.diagnostic,
    unresolved: "Candidate position and check target do not authenticate an active session footer.",
  };
}
