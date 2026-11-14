/** Safe structural summary: no values, paths, descriptions, or catalog entries. */
export interface CatalogShape { blocks: number; jsonBlocks: number; parsedArrays: number; parsedObjects: number; topLevelKeys: string[]; }
export function summarizeCatalogShape(content: unknown[]): CatalogShape {
  let jsonBlocks = 0, parsedArrays = 0, parsedObjects = 0;
  const keys = new Set<string>();
  for (const block of content.slice(0, 50)) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: unknown; text?: unknown };
    if (item.type !== "text" || typeof item.text !== "string" || item.text.length > 250000) continue;
    try {
      const parsed: unknown = JSON.parse(item.text);
      jsonBlocks++;
      if (Array.isArray(parsed)) parsedArrays++;
      else if (parsed && typeof parsed === "object") {
        parsedObjects++;
        // Key names may be user-defined: only disclose recognized structural keys.
        for (const key of ["results", "components", "items", "candidates", "matches", "data", "total", "count", "query", "error"]) {
          if (Object.prototype.hasOwnProperty.call(parsed, key)) keys.add(key);
        }
      }
    } catch { /* Non-JSON MCP text is not displayed. */ }
  }
  return { blocks: content.length, jsonBlocks, parsedArrays, parsedObjects, topLevelKeys: [...keys] };
}
