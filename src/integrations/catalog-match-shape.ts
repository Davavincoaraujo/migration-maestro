/** Local-only structural introspection for MCP catalog matches. Never returns values. */
export interface MatchShape { matchesType: "array" | "object" | "missing" | "other"; count: number | null; candidateFields: { name: string; type: string }[]; }
export function summarizeMatchShape(content: unknown[]): MatchShape {
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: unknown; text?: unknown };
    if (item.type !== "text" || typeof item.text !== "string" || item.text.length > 250000) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(item.text); } catch { continue; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    if (!Object.prototype.hasOwnProperty.call(parsed, "matches")) continue;
    const matches = (parsed as { matches: unknown }).matches;
    if (Array.isArray(matches)) {
      const first = matches.find(x => x && typeof x === "object" && !Array.isArray(x));
      const candidateFields: { name: string; type: string }[] = [];
      if (first) {
        const allowed = ["id", "name", "componentId", "componentName", "resourceType", "score", "confidence", "reason", "capabilities", "features", "description", "category", "path"];
        for (const name of allowed) {
          if (!Object.prototype.hasOwnProperty.call(first, name)) continue;
          const value = (first as Record<string, unknown>)[name];
          candidateFields.push({ name, type: Array.isArray(value) ? "array" : value === null ? "null" : typeof value });
        }
      }
      return { matchesType: "array", count: matches.length, candidateFields };
    }
    return { matchesType: matches && typeof matches === "object" ? "object" : matches === undefined ? "missing" : "other", count: null, candidateFields: [] };
  }
  return { matchesType: "missing", count: null, candidateFields: [] };
}
