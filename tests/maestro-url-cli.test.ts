import test from 'node:test';import assert from 'node:assert/strict';import {runMaestroUrl} from '../src/cli-maestro-url.js';
test('maestro migrate takes exactly one URL and passes it to discovery',async()=>{
 const result=await runMaestroUrl(['migrate','https://example.test/page'],{prepare:async url=>({jobId:'a'.repeat(20),url,state:'prepared-blocked'}) as any});
 assert.equal(result.url,'https://example.test/page');assert.equal(result.execution,'read-only discovery; agent tasks planned only');
 for(const args of [[],['status'],['migrate'],['migrate','x','--autopilot']])await assert.rejects(runMaestroUrl(args),/USAGE/);
});
