import test from "node:test";
import assert from "node:assert/strict";
import { runMaestro } from "../src/maestro.js";
const pages = [{ path: "/demo", title: "Demo", body: "Olá" }, { path: "/demo/2", title: "Outra", body: "Texto" }];
test("manual mode processes one page pending approval", async () => { const result = await runMaestro(pages); assert.equal(result.length, 1); assert.equal(result[0].approved, false); assert.equal(result[0].findings.length, 0); });
test("autopilot processes batch without auto-approval", async () => { const result = await runMaestro(pages, { autopilot: true }); assert.equal(result.length, 2); assert.ok(result.every(r => !r.approved)); });
test("invalid page is rejected", async () => { await assert.rejects(() => runMaestro([{ path: "bad", title: "x", body: "x" }])); });
