import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { bootstrapNativeConfig, loadNativeConfig } from '../src/agent-runtime/native/config.js';
import { validateNativeConfig } from '../src/agent-runtime/native/service.js';
import { loadClaudeSdk } from '../src/agent-runtime/native/claude.js';

async function fixture(t: any) {
  const root=await mkdtemp(join(tmpdir(),'bootstrap-'));
  t.after(()=>rm(root,{recursive:true,force:true}));return root;
}
test('first init creates missing parents and valid private config without sessions or installation',async t=>{
  const root=await fixture(t),path=join(root,'missing','nested','runtime.json');
  assert.equal((await bootstrapNativeConfig(path)).created,true);
  const config=await loadNativeConfig(path);validateNativeConfig(config);
  assert.deepEqual(config.providers,[]);
  assert.deepEqual(await readdir(join(root,'missing','nested')),['runtime.json']);
  assert.equal((await stat(path)).mode&0o777,0o600);
  const before=await readFile(path);
  assert.equal((await bootstrapNativeConfig(path)).created,false);
  assert.deepEqual(await readFile(path),before);
});
test('configured init is idempotent and preserves config, key and adapters; changes fail closed',async t=>{
  const root=await fixture(t),path=join(root,'runtime.json');
  await bootstrapNativeConfig(path);
  const config=await loadNativeConfig(path);
  config.providers=[{id:'claude',provider:'claude-code',sdkRoot:join(root,'claude-sdk'),roles:[{agentId:'Analytics',modelId:'operator-selected-model'}]}];
  await writeFile(path,JSON.stringify(config));
  await bootstrapNativeConfig(path);
  const files=[path,join(config.stateDirectory,'signing-key.pem'),join(config.stateDirectory,'team-adapters.json')];
  const before=await Promise.all(files.map(p=>readFile(p)));
  await bootstrapNativeConfig(path);
  assert.deepEqual(await Promise.all(files.map(p=>readFile(p))),before);
  config.workspaceId='changed';await writeFile(path,JSON.stringify(config));
  await assert.rejects(bootstrapNativeConfig(path),/INSTALLATION_CHANGED_REVIEW_REQUIRED/);
  assert.deepEqual(await readFile(files[1]),before[1]);
  assert.deepEqual(await readFile(files[2]),before[2]);
});
test('invalid existing configuration is preserved',async t=>{
  const root=await fixture(t),path=join(root,'runtime.json');
  for(const raw of ['{','{}','{"version":1,"providers":[null]}']){
    await writeFile(path,raw);
    await assert.rejects(bootstrapNativeConfig(path),/NATIVE_CONFIG_INVALID/);
    assert.equal(await readFile(path,'utf8'),raw);
  }
});
test('serve and prepare explain missing and incomplete configurations without starting providers',async t=>{
  const root=await fixture(t),path=join(root,'runtime.json');
  for(const expected of ['NATIVE_CONFIG_MISSING','NATIVE_CONFIG_INCOMPLETE']){
    for(const command of ['serve','prepare']){
      assert.throws(()=>execFileSync(process.execPath,['--import','tsx','src/cli-native-runtime.ts',command,'--config',path],{stdio:'pipe'}),(e:any)=>{
        assert.match(e.stderr.toString(),new RegExp(expected));return true;
      });
    }
    await bootstrapNativeConfig(path);
  }
});
test('Claude SDK resolves from an npm install prefix without querying or creating sessions',async t=>{
  const root=await fixture(t),prefix=join(root,'claude-sdk'),pkg=join(prefix,'node_modules','@anthropic-ai','claude-agent-sdk');
  await mkdir(pkg,{recursive:true});
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@anthropic-ai/claude-agent-sdk',type:'module',exports:'./index.js'}));
  await writeFile(join(pkg,'index.js'),"export function query(){throw Error('must not query')} export async function listSessions(){return []}");
  const sdk=await loadClaudeSdk(prefix);
  assert.equal(typeof sdk.query,'function');assert.equal(typeof sdk.listSessions,'function');
});
