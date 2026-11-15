import test from "node:test";
import assert from "node:assert/strict";
import { extractComponentQueries, runCatalogDiscovery } from "../src/integrations/maestro-catalog-runner.js";
test("extracts only recognized structured component names",()=>{
 const blocks=[{type:"text",text:JSON.stringify({components:[{componentType:"carousel"},{resourceType:"project/components/faq"},{name:"unknown-secret"}]})}];
 assert.deepEqual(extractComponentQueries(blocks),["carousel","faq"]);
});
test("does not invent component names from prose",async()=>{
 const blocks=[{type:"text",text:"A page with carousel and cards."}];
 assert.deepEqual(extractComponentQueries(blocks),[]);
 const result=await runCatalogDiscovery(undefined,blocks,()=>{});
 assert.equal(result.status,"needs_component_review");
 assert.equal(result.results.length,0);
});
