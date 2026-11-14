/** Advisory matching only. Never treats catalog scores as permission to reuse or publish. */
export interface ComponentCandidate { id: string; name: string; score: number; }
export interface MatchingCandidate extends ComponentCandidate { recommendation: "inspect"; }
export interface MatchingPlan { status: "review_required"; candidates: MatchingCandidate[]; rejectedRecords: number; }
export function extractCatalogCandidates(content: unknown[]): { candidates: ComponentCandidate[]; rejectedRecords: number } {
  const candidates: ComponentCandidate[] = [];
  let rejectedRecords = 0;
  for (const block of content.slice(0, 20)) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: unknown; text?: unknown };
    if (item.type !== "text" || typeof item.text !== "string" || item.text.length > 250000) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(item.text); } catch { continue; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const matches = (parsed as { matches?: unknown }).matches;
    if (!Array.isArray(matches)) continue;
    for (const match of matches.slice(0, 100)) {
      if (!match || typeof match !== "object" || Array.isArray(match)) { rejectedRecords++; continue; }
      const m = match as Record<string, unknown>;
      if (typeof m.id !== "string" || !m.id.trim() || m.id.length > 200 ||
          typeof m.name !== "string" || !m.name.trim() || m.name.length > 200 ||
          typeof m.score !== "number" || !Number.isFinite(m.score)) { rejectedRecords++; continue; }
      candidates.push({ id: m.id, name: m.name, score: m.score });
    }
  }
  return { candidates, rejectedRecords };
}
export function buildMatchingPlan(content: unknown[]): MatchingPlan {
  const { candidates, rejectedRecords } = extractCatalogCandidates(content);
  const deduped = new Map<string, ComponentCandidate>();
  for (const candidate of candidates) {
    const previous = deduped.get(candidate.id);
    if (!previous || candidate.score > previous.score) deduped.set(candidate.id, candidate);
  }
  return {
    status: "review_required",
    candidates: [...deduped.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .map(candidate => ({ ...candidate, recommendation: "inspect" as const })),
    rejectedRecords,
  };
}
export function summarizeMatchingPlan(plan: MatchingPlan): { status: "review_required"; candidates: number; rejectedRecords: number; scoreRange: { min: number; max: number } | null; nextAction: "inspect_candidates" } {
  const scores = plan.candidates.map(c => c.score);
  return { status: plan.status, candidates: scores.length, rejectedRecords: plan.rejectedRecords,
    scoreRange: scores.length ? { min: Math.min(...scores), max: Math.max(...scores) } : null,
    nextAction: "inspect_candidates" };
}
