import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchDigest, persistDispatchRequest, executePendingDispatch, type DispatchRequest } from '../src/autopilot/dispatch-executor.js';

// Synthetic persisted routes: neither JSON nor executor identity authenticates a session.
for (const mode of ['same-session', 'switched-session', 'wrong-terminal', 'ambiguous-response', 'timeout']) {
  test(`session-required dispatch blocks ${mode} before claim and remains idempotent`, async () => {
    const base=await mkdtemp(join(tmpdir(),'dispatch-binding-'));
    const id='a'.repeat(20),root=join(base,id);
    try {
      await mkdir(root);
      const selected={operationalEvidence:{sessionAttestation:{status:'verified',binding:{terminalId:'terminal-1',sessionId:'session-1'}}}};
      const request:DispatchRequest={version:1,jobId:id,taskId:'11111111-1111-1111-1111-111111111111',stage:'PLAN',agentId:'Hermes',routeDigest:dispatchDigest(selected),prompt:'synthetic only'};
      const requestDigest=await persistDispatchRequest(root,request);
      await writeFile(join(root,'PLAN.route.json'),JSON.stringify({selected}));
      await writeFile(join(root,'PLAN.task.json'),JSON.stringify({...request,requestDigest}));
      const snapshot=async()=>Promise.all((await readdir(root)).sort().map(async name=>[name,await readFile(join(root,name),'utf8')]));
      const before=await snapshot();let sends=0;
      const executor={identity:{executorId:'synthetic',terminalId:mode==='wrong-terminal'?'other':'terminal-1',sessionId:mode==='switched-session'?'session-2':'session-1'},async execute(){sends++;if(mode==='timeout')throw Error('TIMEOUT');return 'Hermes says authenticated';}};
      for(let i=0;i<2;i++) await assert.rejects(executePendingDispatch(root,'PLAN',executor),/MAESTRI_SESSION_BOUND_DISPATCH_UNSUPPORTED/);
      assert.equal(sends,0);assert.deepEqual(await snapshot(),before);
    }finally{await rm(base,{recursive:true,force:true});}
  });
}
