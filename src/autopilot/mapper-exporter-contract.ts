/** Deliberately bounded schema dialect. Unsupported constraints fail closed. */
export type ContractSchema = {
  type: "object" | "array" | "union" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, ContractSchema>; required?: string[]; additionalProperties?: false;
  items?: ContractSchema; anyOf?: ContractSchema[]; enum?: (string | number | boolean | null)[];
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const unsafe = (key: string) => ["__proto__", "prototype", "constructor"].includes(key);
export function validateContractSchema(schema: unknown, depth = 0): asserts schema is ContractSchema {
  if (depth > 20 || !object(schema) || !["object", "array", "union", "string", "number", "integer", "boolean", "null"].includes(String(schema.type)) ||
      Object.keys(schema).some(k => !["type", "properties", "required", "additionalProperties", "items", "anyOf", "enum"].includes(k))) throw Error("UNSUPPORTED_CONTRACT_SCHEMA");
  if (schema.type === "array") {
    if (!schema.items || ["properties", "required", "additionalProperties", "anyOf"].some(k => Object.hasOwn(schema, k))) throw Error("INVALID_ARRAY_CONTRACT");
    validateContractSchema(schema.items, depth + 1);
  } else if (schema.type === "union") {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length < 2 || schema.anyOf.length > 10 || ["properties", "required", "additionalProperties", "items", "enum"].some(k => Object.hasOwn(schema, k))) throw Error("INVALID_UNION_CONTRACT");
    for (const variant of schema.anyOf) validateContractSchema(variant, depth + 1);
  } else if (schema.type !== "object" && ["items", "properties", "required", "additionalProperties"].some(k => Object.hasOwn(schema, k))) throw Error("UNSUPPORTED_CONTRACT_SCHEMA");
  const allowed = schema.type === "object" ? ["type", "properties", "required", "additionalProperties"] : schema.type === "array" ? ["type", "items"] : schema.type === "union" ? ["type", "anyOf"] : ["type", "enum"];
  if (Object.keys(schema).some(k => !allowed.includes(k))) throw Error("UNSUPPORTED_CONTRACT_SCHEMA");
  if (schema.type === "array") validateContractSchema(schema.items, depth + 1);
  if (schema.type === "object") {
    if (!object(schema.properties) || schema.additionalProperties !== false || !Array.isArray(schema.required) ||
        schema.required.some(k => typeof k !== "string" || !Object.hasOwn(schema.properties as object, k)) ||
        new Set(schema.required).size !== schema.required.length || Object.keys(schema.properties).some(unsafe) || schema.items !== undefined) throw Error("INVALID_OBJECT_CONTRACT");
    for (const child of Object.values(schema.properties)) validateContractSchema(child, depth + 1);
  } else if (schema.type === "array") {
    if (schema.items === undefined) throw Error("INVALID_ARRAY_CONTRACT");
    validateContractSchema(schema.items, depth + 1);
  }
  if (schema.type !== "object" && ["properties", "required", "additionalProperties"].some(k => Object.hasOwn(schema, k)) ||
      schema.type !== "array" && Object.hasOwn(schema, "items")) throw Error("INVALID_CONTRACT_SCHEMA");
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.some(v => v !== null && !["string", "number", "boolean"].includes(typeof v)))) throw Error("INVALID_CONTRACT_ENUM");
}
export function matchesContract(value: unknown, schema: ContractSchema, depth = 0): boolean {
  if (depth > 20) return false;
  if (schema.type === "union") return schema.anyOf!.some(variant => matchesContract(value, variant, depth + 1));
  if (schema.enum && !schema.enum.includes(value as never)) return false;
  switch (schema.type) {
    case "null": return value === null;
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isSafeInteger(value);
    case "array": return Array.isArray(value) && value.length <= 10000 && value.every(v => matchesContract(v, schema.items!, depth + 1));
    case "object": return object(value) && schema.required!.every(k => Object.hasOwn(value, k)) &&
      Object.entries(value).every(([k, v]) => !unsafe(k) && Object.hasOwn(schema.properties!, k) && matchesContract(v, schema.properties![k], depth + 1));
  }
}
export interface MapperExporterContract {
  sourceId: string; resourceType: string;
  definition: { file: string; digest: string };
  mapper: { file: string; digest: string };
  exporter: { file: string; digest: string };
  contentSchema: ContractSchema; modelSchema: ContractSchema; propsSchema: ContractSchema;
  /** Each observed/required variant must have at least one boundary fixture. */
  variants: { id: string; evidence: string[] }[];
  fixtures: { variantId: string; content: unknown; model: unknown; props: unknown; evidence: string[] }[];
}
/** Validates data boundaries only; never evaluates specialist-provided code. */
export function verifyMapperExporterContract(value: unknown): MapperExporterContract {
  if (!object(value) || Object.keys(value).some(k => !["sourceId", "resourceType", "definition", "mapper", "exporter", "contentSchema", "modelSchema", "propsSchema", "variants", "fixtures"].includes(k)) ||
      typeof value.sourceId !== "string" || !value.sourceId.trim() || value.sourceId.length > 120 ||
      typeof value.resourceType !== "string" || !value.resourceType.trim() || value.resourceType.length > 200) throw Error("INVALID_MAPPER_EXPORTER_CONTRACT");
  for (const name of ["definition", "mapper", "exporter"]) {
    const ref = value[name];
    if (!object(ref) || Object.keys(ref).some(k => !["file", "digest"].includes(k)) || typeof ref.file !== "string" || !ref.file.trim() || ref.file.length > 500 ||
        typeof ref.digest !== "string" || !/^[a-f0-9]{64}$/.test(ref.digest)) throw Error("CONTRACT_SOURCE_EVIDENCE_REQUIRED");
  }
  for (const name of ["contentSchema", "modelSchema", "propsSchema"]) {
    validateContractSchema(value[name]);
    if ((value[name] as ContractSchema).type !== "object") throw Error("OBJECT_BOUNDARY_SCHEMA_REQUIRED");
  }
  if (!Array.isArray(value.variants) || !value.variants.length || value.variants.length > 50 || value.variants.some(v => !object(v) ||
      typeof v.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(v.id) || !Array.isArray(v.evidence) || !v.evidence.length ||
      v.evidence.length > 20 || v.evidence.some(e => typeof e !== "string" || !e.trim() || e.length > 2000))) throw Error("CONTRACT_VARIANTS_REQUIRED");
  const variants = value.variants as { id: string; evidence: string[] }[];
  if (new Set(variants.map(v => v.id)).size !== variants.length) throw Error("DUPLICATE_CONTRACT_VARIANT");
  if (!Array.isArray(value.fixtures) || !value.fixtures.length || value.fixtures.length > 100) throw Error("CONTRACT_FIXTURES_REQUIRED");
  const contract = value as unknown as MapperExporterContract;
  const covered = new Set<string>();
  for (const f of contract.fixtures) {
    if (!object(f) || Object.keys(f).some(k => !["variantId", "content", "model", "props", "evidence"].includes(k)) ||
        typeof f.variantId !== "string" || !variants.some(v => v.id === f.variantId) ||
        !Array.isArray(f.evidence) || !f.evidence.length || f.evidence.length > 20 || f.evidence.some(e => typeof e !== "string" || !e.trim() || e.length > 2000) ||
        !matchesContract(f.content, contract.contentSchema) || !matchesContract(f.model, contract.modelSchema) || !matchesContract(f.props, contract.propsSchema)) throw Error("MAPPER_EXPORTER_FIXTURE_MISMATCH");
    covered.add(f.variantId);
    if (!object(f.model) || f.model[":type"] !== contract.resourceType) throw Error("EXPORTER_RESOURCE_TYPE_MISMATCH");
  }
  if (variants.some(v => !covered.has(v.id))) throw Error("CONTRACT_VARIANT_FIXTURE_MISSING");
  return contract;
}
