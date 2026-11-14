import { exportLocalMetadata, type LocalMetadata } from "./local-metadata.js";
import { buildMetadataCatalog, type MetadataCatalog } from "./metadata-catalog.js";
import type { AuthoredDefinition } from "./container-tree.js";

export interface RegistryEntry {
  definition?: unknown;
  load?: unknown;
  loadMapper?: unknown;
}
export interface RegistryDiscoveryResult {
  catalog: MetadataCatalog;
  inspected: number;
  accepted: number;
  rejected: number;
  errors: Array<{ index: number; reason: string }>;
}
function isDefinition(value: unknown): value is AuthoredDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.modelId === "string" && obj.modelId.length > 0 &&
    Array.isArray(obj.fields) && (obj.subItems === undefined || Array.isArray(obj.subItems));
}
/**
 * Inspects an already-evaluated registry. Does not call load/loadMapper,
 * execute component code, access the filesystem, or expose registry keys.
 * Must be invoked inside the approved environment where the registry exists.
 */
export function discoverRegistry(
  registry: ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>,
): RegistryDiscoveryResult {
  const entries = registry instanceof Map ? [...registry.values()] : Object.values(registry);
  if (entries.length > 10000) throw new Error("Registry too large");
  const metadata: LocalMetadata[] = [];
  const errors: RegistryDiscoveryResult["errors"] = [];
  entries.forEach((entry, index) => {
    try {
      const candidate = entry && typeof entry === "object" && "definition" in entry
        ? (entry as RegistryEntry).definition : entry;
      if (!isDefinition(candidate)) throw new Error("Entry does not contain an evaluated definition");
      metadata.push(exportLocalMetadata(candidate));
    } catch (error) {
      // Deliberately omit raw errors: they can contain proprietary model identifiers.
      errors.push({ index, reason: error instanceof Error && /evaluated definition/.test(error.message)
        ? "missing-definition" : "invalid-definition" });
    }
  });
  // Duplicate identifiers are rejected by the catalog validator.
  return {
    catalog: buildMetadataCatalog(metadata),
    inspected: entries.length,
    accepted: metadata.length,
    rejected: errors.length,
    errors,
  };
}
