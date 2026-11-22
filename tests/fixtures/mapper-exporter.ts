import type { ContractSchema } from "../../src/autopilot/mapper-exporter-contract.js";
export const resourceType = "portal-banco-bradesco/components/sections/hero";
export const componentNode = { "sling:resourceType": resourceType, title: "Fixture hero", actions: [{ label: "Read", href: "/fixture" }] };
export const schema: ContractSchema = { type: "object", properties: {
  "sling:resourceType": { type: "string", enum: [resourceType] }, title: { type: "string" },
  actions: { type: "array", items: { type: "object", properties: { label: { type: "string" }, href: { type: "string" } }, required: ["label", "href"], additionalProperties: false } },
}, required: ["sling:resourceType", "title", "actions"], additionalProperties: false };
export function fixtureContract(file: string, digest: string) {
  return { sourceId: "hero", resourceType,
    definition: { file, digest }, mapper: { file: "src/mapper.ts", digest }, exporter: { file: "src/exporter.ts", digest },
    contentSchema: schema,
    modelSchema: { type: "object", properties: { ":type": { type: "string" }, title: { type: "string" } }, required: [":type", "title"], additionalProperties: false },
    propsSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
    variants: [{ id: "default", evidence: ["Synthetic default-variant declaration; not a live portal observation."] }],
    fixtures: [{ variantId: "default", content: componentNode, model: { ":type": resourceType, title: "Fixture hero" }, props: { title: "Fixture hero" }, evidence: ["Synthetic contract fixture; not live AEM/mapper execution."] }] };
}
