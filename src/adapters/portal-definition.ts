import type { PortalDefinition } from "./portal-registry.js";
export interface DialogField { name?: string; type?: string; label?: string; [key: string]: unknown; }
export interface PortalSubItem { id: string; title: string; containerField: string; fields: DialogField[]; }
export interface PortalComponentDefinition extends PortalDefinition {
  title: string;
  fields: DialogField[];
  subItems: PortalSubItem[];
}
export interface ContentProposal {
  qualifiedKey: string;
  modelId: string;
  properties: Record<string, unknown>;
  children: Array<{ modelId: string; containerField: string; properties: Record<string, unknown> }>;
  warnings: string[];
}
/**
 * Maps known source properties only. This is a proposal, not AEM JCR serialization.
 * Helper-generated fields must be resolved before strict field validation is possible.
 */
export function proposeContent(definition: PortalComponentDefinition, input: {
  properties?: Record<string, unknown>;
  children?: Record<string, Array<Record<string, unknown>>>;
}): ContentProposal {
  const warnings: string[] = [];
  const properties = { ...(input.properties ?? {}) };
  const children: ContentProposal["children"] = [];
  const allowed = new Set(definition.subItems.map(item => item.containerField));
  for (const [containerField, items] of Object.entries(input.children ?? {})) {
    if (!allowed.has(containerField)) {
      warnings.push(`Unknown container: ${containerField}`);
      continue;
    }
    if (!Array.isArray(items)) { warnings.push(`Invalid children for ${containerField}`); continue; }
    const sub = definition.subItems.find(item => item.containerField === containerField)!;
    for (const props of items) {
      if (!props || typeof props !== "object" || Array.isArray(props)) {
        warnings.push(`Invalid child in ${containerField}`);
        continue;
      }
      children.push({ modelId: sub.id, containerField, properties: { ...props } });
    }
  }
  return {
    qualifiedKey: `${definition.group}/${definition.name}@${definition.version}`,
    modelId: definition.modelId,
    properties,
    children,
    warnings,
  };
}
