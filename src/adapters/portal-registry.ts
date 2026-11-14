import type { ComponentManifest } from "./manifest.js";
export interface PortalDefinition {
  group: string;
  name: string;
  version: string;
  modelId: string;
  definitionImport: string;
  componentImport: string;
  mapperImport?: string;
}
export interface PortalRegistryManifest {
  schemaVersion: 1;
  source: "iibr-fed-portalbradesco";
  components: Array<PortalDefinition & { qualifiedKey: string }>;
}
/** Read-only conversion. No filesystem, network, or production AEM access. */
export function createPortalManifest(definitions: PortalDefinition[]): PortalRegistryManifest {
  const seen = new Set<string>();
  const components = definitions.map(def => {
    for (const key of ["group", "name", "version", "modelId", "definitionImport", "componentImport"] as const) {
      if (typeof def[key] !== "string" || !def[key].trim()) throw new Error(`Missing ${key}`);
    }
    const qualifiedKey = `${def.group}/${def.name}@${def.version}`;
    if (seen.has(qualifiedKey)) throw new Error(`Duplicate qualified key: ${qualifiedKey}`);
    seen.add(qualifiedKey);
    return { ...def, qualifiedKey };
  });
  return { schemaVersion: 1, source: "iibr-fed-portalbradesco", components };
}
export function toGenericManifest(manifest: PortalRegistryManifest): ComponentManifest {
  return {
    schemaVersion: 1,
    components: manifest.components.map(c => ({
      resourceType: c.modelId,
      componentName: c.qualifiedKey,
      source: c.definitionImport,
    })),
  };
}
