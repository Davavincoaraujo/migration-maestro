import { createHash } from "node:crypto";
import { extractContainerTree, type AuthoredDefinition, type ContainerNode } from "./container-tree.js";

export interface LocalMetadata {
  schemaVersion: 1;
  componentId: string;
  containers: ContainerNode[];
  warnings: string[];
}
const id = (value: string): string => "model-" + createHash("sha256").update(value).digest("hex").slice(0, 16);

/**
 * Produces an anonymized structural overview from evaluated definitions.
 * Does not export titles, labels, field values, paths, credentials or JCR data.
 * The structural overview is useful for planning, not for generating AEM payloads.
 */
export function exportLocalMetadata(definition: AuthoredDefinition): LocalMetadata {
  const tree = extractContainerTree(definition);
  const convert = (nodes: ContainerNode[]): ContainerNode[] => nodes.map((node, index) => ({
    name: "collection-" + (index + 1),
    modelId: id(node.modelId),
    parentModelId: id(node.parentModelId),
    children: convert(node.children),
  }));
  return {
    schemaVersion: 1,
    componentId: id(definition.modelId),
    containers: convert(tree),
    warnings: ["Identifiers and collection names are anonymized. Keep the original mapping in the local portal only."],
  };
}
