import type { MatchingCandidate } from "./component-matching-engine.js";
import type { BindingManifest } from "./component-binding-resolver.js";
/** Prioritize explicitly linked candidates, preserving original ranking within each group. */
export function prioritizeBoundCandidates(candidates: MatchingCandidate[], manifest: BindingManifest, limit = 3): MatchingCandidate[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_CANDIDATE_LIMIT");
  const linked = new Set(manifest.bindings.map(binding => binding.catalogId));
  return [...candidates.filter(candidate => linked.has(candidate.id)),
    ...candidates.filter(candidate => !linked.has(candidate.id))].slice(0, limit);
}
