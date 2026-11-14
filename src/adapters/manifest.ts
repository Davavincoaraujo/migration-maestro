export interface ComponentManifestEntry {
  resourceType: string;
  componentName: string;
  source: string;
}
export interface ComponentManifest {
  schemaVersion: 1;
  components: ComponentManifestEntry[];
}
/** Validate an exported, sanitized local registry without reading the portal repository. */
export function parseManifest(input: unknown): ComponentManifest {
  if (!input || typeof input !== "object") throw new Error("Manifest must be an object");
  const obj = input as Record<string, unknown>;
  if (obj.schemaVersion !== 1 || !Array.isArray(obj.components)) throw new Error("Unsupported manifest schema");
  if (obj.components.length > 10000) throw new Error("Manifest too large");
  const seen = new Set<string>();
  const components: ComponentManifestEntry[] = obj.components.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid component entry");
    const item = entry as Record<string, unknown>;
    for (const key of ["resourceType", "componentName", "source"]) {
      if (typeof item[key] !== "string" || !(item[key] as string).trim() || (item[key] as string).length > 500) {
        throw new Error(`Invalid ${key}`);
      }
    }
    const resourceType = item.resourceType as string;
    if (seen.has(resourceType)) throw new Error("Duplicate resourceType");
    seen.add(resourceType);
    return { resourceType, componentName: item.componentName as string, source: item.source as string };
  });
  return { schemaVersion: 1, components };
}
