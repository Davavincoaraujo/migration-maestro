import type { LocalMetadata } from "./local-metadata.js";
import type { ContainerNode } from "./container-tree.js";

export interface MetadataCatalog {
  schemaVersion: 1;
  components: Array<{ componentId: string; containers: ContainerNode[] }>;
  summary: { components: number; collections: number; maximumDepth: number };
}
const validId = (s: unknown): s is string => typeof s === "string" && /^model-[a-f0-9]{16}$/.test(s);
function validateNodes(input: unknown, parent: string, depth: number, counter: { count: number; max: number }): ContainerNode[] {
  if (!Array.isArray(input) || depth > 16 || input.length > 1000) throw new Error("Invalid container tree");
  return input.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid container");
    const node = raw as Record<string, unknown>;
    if (typeof node.name !== "string" || !/^collection-[1-9][0-9]*$/.test(node.name) ||
      !validId(node.modelId) || node.parentModelId !== parent) throw new Error("Invalid container relationship");
    counter.count++;
    if (counter.count > 10000) throw new Error("Too many containers");
    counter.max = Math.max(counter.max, depth);
    return {
      name: node.name,
      modelId: node.modelId,
      parentModelId: parent,
      children: validateNodes(node.children, node.modelId, depth + 1, counter),
    };
  });
}
export function parseLocalMetadata(input: unknown): LocalMetadata {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid metadata");
  const obj = input as Record<string, unknown>;
  if (obj.schemaVersion !== 1 || !validId(obj.componentId)) throw new Error("Unsupported metadata schema");
  if (!Array.isArray(obj.warnings) || obj.warnings.some(w => typeof w !== "string")) throw new Error("Invalid warnings");
  const counter = { count: 0, max: 0 };
  const containers = validateNodes(obj.containers, obj.componentId, 1, counter);
  return { schemaVersion: 1, componentId: obj.componentId, containers, warnings: [] };
}
export function buildMetadataCatalog(inputs: unknown[]): MetadataCatalog {
  if (inputs.length > 10000) throw new Error("Too many components");
  const seen = new Set<string>();
  const counter = { count: 0, max: 0 };
  const components = inputs.map(input => {
    const parsed = parseLocalMetadata(input);
    if (seen.has(parsed.componentId)) throw new Error("Duplicate component identifier: " + parsed.componentId);
    seen.add(parsed.componentId);
    const walk = (nodes: ContainerNode[], depth: number): void => {
      for (const node of nodes) { counter.count++; counter.max = Math.max(counter.max, depth); walk(node.children, depth + 1); }
    };
    walk(parsed.containers, 1);
    return { componentId: parsed.componentId, containers: parsed.containers };
  }).sort((a, b) => a.componentId.localeCompare(b.componentId));
  return { schemaVersion: 1, components, summary: { components: components.length, collections: counter.count, maximumDepth: counter.max } };
}
