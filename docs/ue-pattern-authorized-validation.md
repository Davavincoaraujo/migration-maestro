# UE-Pattern → Hermes: primeiro aceite sintético

O job `20261116000000000005` já tem ANALYZE v2 aceito e está pausado após essa etapa. Não recrie o job, não reenvie ANALYZE e não altere os trabalhos históricos congelados. Esta implementação foi testada com transportes simulados; nenhum despacho real de MAP_COMPONENTS foi realizado por ela.

O contrato é opt-in pelo argumento `--synthetic-mapping-v1`. O envelope de despacho permanece version 1 e o resultado permanece version 2. O pedido de MAP_COMPONENTS acrescenta `mappingContractVersion:1`, coberto pelo digest do pedido. Pedidos antigos continuam usando seus contratos originais; não há atualização retroativa.

O artefato obrigatório `MAP_COMPONENTS.mapping.json` contém version 1, jobId, taskId, stage MAP_COMPONENTS, analyzeResultDigest (SHA-256 dos bytes exatos do resultado Analytics), scope synthetic-only e corporateReuseVerified false. `mapping` exige source hero, component semantic-hero, heading e cta exatos do fixture, href #garden e targetId garden. Exige também arrays não vazios semantics, responsiveRequirements, gaps e limitations. O manifesto do resultado deve incluir esse arquivo e MAP_COMPONENTS.evidence.json, ambos com hashes exatos. Isso valida o contrato estrutural e sua vinculação, sem comprovar semanticamente todas as afirmações do especialista.

Neste modo o catálogo contém somente uma descrição sintética produzida pelo coordenador; nenhum Analyst, portal ou AEM é acessado. Não há afirmação de reutilização corporativa. A integração com contratos reais de mapper/exporter continua sendo trabalho posterior.

## Comandos para a primeira validação real

Execute no shell original autorizado do Migration Orchestrator. Cada bloco é sequencial; pare se uma verificação falhar. Nunca remova locks ou tentativas para repetir envios.

```sh
cd /Users/macos/Developer/migration-maestro
export PATH="/Users/macos/.nvm/versions/node/v22.23.2/bin:$PATH"
node --version
test -n "$MAESTRI_TERMINAL_ID"
source .local-maestro/integration-env.sh
"${MAESTRI_CLI:-maestri}" list
npm run model-router:inspect
```

Prepare somente o pedido seguinte, retomando o mesmo checkpoint:

```sh
npm run autopilot:central -- 20261116000000000005 --defer-dispatch --synthetic-mapping-v1 --pause-after-map-components
```

Na primeira preparação, exit 1 com `Checkpointed stage failed: map-components` é esperado; o evento específico deve ser AUTHORIZED_EXECUTOR_REQUIRED. Nenhum ask é feito nesse modo. Inspecione o pedido antes do único envio:

```sh
node --import tsx --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dispatchDigest, verifyDispatch} from './src/autopilot/dispatch-executor.ts';
import {artifactDigest, validateResult} from './src/autopilot/central-controller.ts';
const root='.local-maestro/central-demo/20261116000000000005';
const read=async n=>JSON.parse(await readFile(`${root}/${n}`,'utf8'));
const c=await read('20261116000000000005.checkpoint.json');
assert.deepEqual(c.completed,['analyze']);
const a=c.outputs.analyze, at=await read('ANALYZE.task.json');
const ar=await verifyDispatch(root,'ANALYZE',at);
const bytes=await readFile(`${root}/ANALYZE.result.json`,'utf8');
assert.deepEqual(validateResult(bytes,'ANALYZE',at.taskId,ar),a.result);
assert.equal(createHash('sha256').update(bytes).digest('hex'),a.resultDigest);
for(const f of a.artifacts) assert.equal(await artifactDigest(root,f.file),f.digest);
const r=await read('MAP_COMPONENTS.dispatch.json'), t=await read('MAP_COMPONENTS.task.json'), route=await read('MAP_COMPONENTS.route.json');
assert.equal(r.jobId,c.jobId); assert.equal(r.agentId,'UE-Pattern');
assert.equal(r.resultContractVersion,2); assert.equal(r.mappingContractVersion,1);
assert.equal(t.taskId,r.taskId); assert.equal(t.requestDigest,dispatchDigest(r));
assert.equal(t.routeDigest,r.routeDigest); assert.equal(dispatchDigest(route.selected??route.route),r.routeDigest);
await assert.rejects(access(`${root}/MAP_COMPONENTS.dispatch-attempt.json`),{code:'ENOENT'});
await assert.rejects(access(`${root}/PLAN.task.json`),{code:'ENOENT'});
console.log(r.prompt);
NODE
```

Se o roteador selecionou outro agente, pare; não edite a rota para forçar UE-Pattern. Depois de revisar o prompt, envie uma única vez:

```sh
npm run autopilot:dispatch -- .local-maestro/central-demo/20261116000000000005 MAP_COMPONENTS
```

Timeout não autoriza reenvio. A tentativa exclusiva impede duplicação. Reconcilie usando somente:

```sh
npm run autopilot:central -- 20261116000000000005 --defer-dispatch --synthetic-mapping-v1 --pause-after-map-components
```

Quando o resultado estiver disponível, a CLI deve retornar completed `["analyze","map-components"]`, state running, paused true e pauseAfter MAP_COMPONENTS. Pode repetir somente essa reconciliação; o manifesto, resultado, proveniência e contrato são novamente verificados. A flag de pausa deve ser repetida; omiti-la permite avançar. Verifique a fronteira:

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
const root='.local-maestro/central-demo/20261116000000000005';
const c=JSON.parse(await readFile(`${root}/20261116000000000005.checkpoint.json`,'utf8'));
const s=JSON.parse(await readFile(`${root}/status.json`,'utf8'));
assert.deepEqual(c.completed,['analyze','map-components']); assert.equal(c.state,'running');
assert.equal(s.status,'paused'); assert.equal(s.pauseAfter,'MAP_COMPONENTS');
assert.ok(c.outputs['map-components'].artifacts.some(a=>a.file==='MAP_COMPONENTS.mapping.json'));
for(const suffix of ['task.json','route.json','dispatch.json','dispatch-attempt.json']) await assert.rejects(access(`${root}/PLAN.${suffix}`),{code:'ENOENT'});
console.log('MAP_COMPONENTS aceito; Hermes ainda não preparado nem despachado.');
NODE
```

Não execute PLAN neste primeiro aceite. Um failure.json anterior pode permanecer após recuperação; checkpoint, reconciliação e status atual devem ser lidos em conjunto. A pausa é operacional, não REVIEW, aprovação humana ou autorização de publicação.
