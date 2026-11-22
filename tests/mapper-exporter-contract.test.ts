import test from "node:test";
import assert from "node:assert/strict";
import { matchesContract, validateContractSchema, verifyMapperExporterContract, type ContractSchema } from "../src/autopilot/mapper-exporter-contract.js";

import { resourceType, componentNode, schema, fixtureContract } from "./fixtures/mapper-exporter.js";
test("mapper/exporter fixture validates nested arrays, required fields and exact model type", () => {
  const contract = fixtureContract("src/definition.ts", "a".repeat(64));
  verifyMapperExporterContract(contract);
  assert.equal(matchesContract(componentNode, schema), true);
  for (const value of [{ ...componentNode, unknown: true }, { ...componentNode, title: 2 }, { ...componentNode, actions: [{ label: "missing href" }] }, { title: "missing fields" }]) assert.equal(matchesContract(value, schema), false);
  contract.fixtures[0].model[":type"] = "invented/type";
  assert.throws(() => verifyMapperExporterContract(contract), /EXPORTER_RESOURCE_TYPE_MISMATCH/);
});
test("contract dialect fails closed for unsupported constraints and malformed schemas", () => {
  for (const value of [{ type: "string", pattern: ".*" }, { type: "array" }, { type: "object", properties: {}, required: [], additionalProperties: true },
    { type: "object", properties: {}, required: ["missing"], additionalProperties: false }, { type: "string", items: {} }, { type: "array", items: { type: "unknown" } },
    JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}},"required":[],"additionalProperties":false}')]) assert.throws(() => validateContractSchema(value));
});
test("contract requires source digests and evidenced fixtures for every boundary", () => {
  for (const alter of [
    (v: any) => { delete v.mapper; }, (v: any) => { v.exporter.digest = "fake"; },
    (v: any) => { v.fixtures = []; }, (v: any) => { v.fixtures[0].evidence = []; },
    (v: any) => { v.fixtures[0].props.title = false; },
  ]) {
    const value = fixtureContract("src/definition.ts", "a".repeat(64)); alter(value);
    assert.throws(() => verifyMapperExporterContract(value));
  }
});

test("each declared mapper/exporter variant needs evidence and a matching boundary fixture", () => {
  const contract = fixtureContract("src/definition.ts", "a".repeat(64));
  contract.variants.push({ id: "mobile", evidence: ["Observed source/definition mobile variant."] });
  assert.throws(() => verifyMapperExporterContract(contract), /CONTRACT_VARIANT_FIXTURE_MISSING/);
  contract.fixtures.push({ ...contract.fixtures[0], variantId: "mobile", evidence: ["Mobile output fixture evidence."] });
  assert.equal(verifyMapperExporterContract(contract).fixtures.length, 2);
  contract.fixtures[1].variantId = "unknown";
  assert.throws(() => verifyMapperExporterContract(contract), /MAPPER_EXPORTER_FIXTURE_MISMATCH/);
});

test("contract boundary rejects duplicate variants and unexpected contract fields", () => {
  const duplicate = fixtureContract("src/definition.ts", "a".repeat(64));
  duplicate.variants.push({ ...duplicate.variants[0] });
  assert.throws(() => verifyMapperExporterContract(duplicate), /DUPLICATE_CONTRACT_VARIANT/);
  const extra = { ...fixtureContract("src/definition.ts", "a".repeat(64)), executable: "must-not-be-accepted" };
  assert.throws(() => verifyMapperExporterContract(extra), /INVALID_MAPPER_EXPORTER_CONTRACT/);
});

test("bounded union schemas describe real nullable mapper fields without accepting unknown shapes", () => {
  const union: ContractSchema = { type: "union", anyOf: [
    { type: "null" },
    { type: "object", properties: { href: { type: "string" } }, required: ["href"], additionalProperties: false },
  ] };
  validateContractSchema(union);
  assert.equal(matchesContract(null, union), true);
  assert.equal(matchesContract({ href: "/x" }, union), true);
  assert.equal(matchesContract({ href: "/x", extra: true }, union), false);
  assert.equal(matchesContract(42, union), false);
  assert.throws(() => validateContractSchema({ type: "union", anyOf: [{ type: "string" }] }), /INVALID_UNION_CONTRACT/);
});
