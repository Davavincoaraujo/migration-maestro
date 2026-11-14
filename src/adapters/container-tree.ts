export interface AuthoredField {
  name: string;
  type: string;
  model?: string;
  fields?: AuthoredField[];
  [key: string]: unknown;
}
export interface AuthoredSubItem {
  id: string;
  title: string;
  containerField: string;
  fields: AuthoredField[];
}
export interface AuthoredDefinition {
  modelId: string;
  fields: AuthoredField[];
  subItems?: AuthoredSubItem[];
}
export interface ContainerNode {
  name: string;
  modelId: string;
  parentModelId: string;
  children: ContainerNode[];
}
/**
 * Reconstructs a nested container hierarchy from evaluated comContainers output.
 * This is metadata inspection, not JCR serialization.
 */
export function extractContainerTree(definition: AuthoredDefinition): ContainerNode[] {
  const subItems = definition.subItems ?? [];
  const models = new Set([definition.modelId, ...subItems.map(item => item.id)]);
  const candidates: Array<{ name: string; modelId: string; parentModelId: string }> = [];
  const scan = (fields: AuthoredField[], parentModelId: string): void => {
    for (const field of fields) {
      if (field.type === "multifield" && field.model) {
        if (!models.has(field.model)) throw new Error(`Unknown container model: ${field.model}`);
        candidates.push({ name: field.name, modelId: field.model, parentModelId });
      }
    }
  };
  scan(definition.fields, definition.modelId);
  for (const subItem of subItems) scan(subItem.fields, subItem.id);
  const seen = new Set<string>();
  const build = (parentModelId: string, ancestry: Set<string>): ContainerNode[] =>
    candidates.filter(c => c.parentModelId === parentModelId).map(c => {
      const key = `${c.parentModelId}/${c.name}`;
      if (seen.has(key)) throw new Error(`Duplicate container: ${key}`);
      seen.add(key);
      if (ancestry.has(c.modelId)) throw new Error(`Container cycle at ${c.modelId}`);
      return { name: c.name, modelId: c.modelId, parentModelId, children: build(c.modelId, new Set([...ancestry, c.modelId])) };
    });
  const tree = build(definition.modelId, new Set([definition.modelId]));
  if (seen.size !== candidates.length) throw new Error("Unreachable container or cyclic hierarchy");
  return tree;
}
