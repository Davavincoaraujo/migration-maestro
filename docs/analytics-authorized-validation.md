# Primeiro ciclo real: executor autorizado → Analytics → checkpoint pausado

Este procedimento usa exclusivamente o demo sintético e um job novo: `20261116000000000005`. Os IDs históricos `20261115000000000001` a `20261115000000000004` não são usados. Execute no shell original do Migration Orchestrator, que já possui `MAESTRI_TERMINAL_ID` correto. Não substitua essa variável, reinicie sessões ou envie prompts manuais de recuperação.

Execute cada bloco separadamente e pare se uma verificação falhar. Os comandos abaixo são instruções para a futura validação real; os testes automatizados usam apenas transportes simulados e diretórios temporários.

## Contrato

Novos pedidos mantêm o envelope `DispatchRequest.version:1` e declaram `resultContractVersion:2`, vinculado pelo digest do pedido e repetido no task receipt. O resultado exige:

- `version:2`, `jobId`, `taskId` e `stage`, conferidos contra o pedido persistido e sua proveniência;
- `status:"completed"`, resumo não vazio (até 2.000 caracteres) e 1–20 evidências não vazias (até 2.000 caracteres cada);
- `artifacts`: 1–20 entradas únicas `{file,digest}`, com caminhos relativos ao job e SHA-256 em 64 caracteres hexadecimais minúsculos.

Cada arquivo deve existir, ser arquivo regular, ter até 5.000.000 bytes e permanecer dentro do diretório real autorizado do job. Caminhos absolutos, `.`/`..` e symlinks que escapem do job são rejeitados. Arquivo ausente é erro de contrato, não sinal para continuar aguardando um resultado já publicado. O arquivo de resultado tem limite de 64.000 bytes.

O prompt manda Analytics criar `ANALYZE.evidence.json` com achados e limitações, calcular o hash dos bytes exatos e incluí-lo no manifesto. Deve escrever os artefatos primeiro e publicar `ANALYZE.result.json` por rename atômico por último. Não é necessário um callback ou `maestri ask` de volta ao Maestro. O pedido persistido contém o UUID e o caminho exatos; não escreva o resultado em nome do agente.

O controller verifica o manifesto antes de concluir a etapa e grava `outputs.analyze.resultContractVersion:2`, `resultDigest`, `artifacts` com hashes verificados e o vínculo `dispatch` no checkpoint. Artefatos verificados pelo workflow são unidos ao manifesto sem descartar seus hashes; digests conflitantes bloqueiam a conclusão. Na retomada, resultado, proveniência e arquivos são novamente verificados.

Pedidos antigos sem `resultContractVersion` continuam com seu contrato original. Outputs antigos não recebem uma declaração retroativa de validação v2. Reutilizar um checkpoint histórico concluído não reescreve seu arquivo. Não remova campos de um pedido novo para tentar tratá-lo como histórico: pedido, task receipt e digest devem concordar.

## 1. Descoberta no shell original

```sh
cd /Users/macos/Developer/migration-maestro
test -n "$MAESTRI_TERMINAL_ID"
source .local-maestro/integration-env.sh
"${MAESTRI_CLI:-maestri}" list
npm run model-router:inspect
```

Confirme Analytics, Hermes e UE-Pattern conectados e um modelo ativo reconhecido para Analytics. O roteador pode selecionar uma alternativa compatível; a verificação do pedido abaixo exige exatamente `Analytics` antes de autorizar este teste. Não basta a existência de um modelo no catálogo da CLI. Os especialistas precisam conseguir gravar no diretório do job pelo filesystem compartilhado.

O arquivo de ambiente existente configura PATH e diretórios locais; não define `MAESTRI_TERMINAL_ID`. A pausa dispensa qualquer consulta ao catálogo local do Analyst: não há preparação de MAP_COMPONENTS neste ciclo. Não use `autopilot:intake`, que entra no workflow de migração local, nem `autopilot:central --help`, que não é uma opção implementada.

## 2. Confirmar isolamento antes da primeira criação

Execute este bloco somente na criação inicial, não na reconciliação de um job existente.

```sh
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
assert.ok(process.env.MAESTRI_TERMINAL_ID, "Use o shell original autorizado");
await assert.rejects(access(".local-maestro/central-demo/20261116000000000005"), { code: "ENOENT" });
await assert.rejects(access(".local-maestro/central-demo/controller.lock"), { code: "ENOENT" });
console.log("Job novo e controller sem lock; pronto para preparar.");
NODE
```

Se o diretório já existir, não o apague nem reutilize como job novo: inspecione e siga a reconciliação desse mesmo job. Se houver lock, verifique processos e tarefas em andamento; não remova o lock automaticamente.

## 3. Criar o job e preparar o pedido, sem envio

```sh
npm run autopilot:central -- 20261116000000000005 --defer-dispatch --pause-after-analyze
```

É esperado exit code 1 com `Checkpointed stage failed: analyze`: esse erro geral aparece em `failure.json`, enquanto a causa específica `AUTHORIZED_EXECUTOR_REQUIRED` fica em `events.jsonl`. O checkpoint ainda não contém ANALYZE concluído. Confira os registros e leia o prompt exato:

```sh
node --import tsx --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dispatchDigest } from "./src/autopilot/dispatch-executor.ts";
const root = ".local-maestro/central-demo/20261116000000000005";
const read = async name => JSON.parse(await readFile(`${root}/${name}`, "utf8"));
const request = await read("ANALYZE.dispatch.json");
const task = await read("ANALYZE.task.json");
const route = await read("ANALYZE.route.json");
assert.equal((await read("failure.json")).error, "Checkpointed stage failed: analyze");
assert.match(await readFile(`${root}/events.jsonl`, "utf8"), /AUTHORIZED_EXECUTOR_REQUIRED/);
assert.equal(request.version, 1);
assert.equal(request.resultContractVersion, 2);
assert.equal(request.jobId, "20261116000000000005");
assert.equal(request.stage, "ANALYZE");
assert.equal(request.agentId, "Analytics");
assert.equal(task.version, 2);
assert.equal(task.resultContractVersion, 2);
assert.equal(task.taskId, request.taskId);
assert.equal(task.stage, request.stage);
assert.equal(task.agentId, request.agentId);
assert.equal(task.requestDigest, dispatchDigest(request));
assert.equal(task.routeDigest, request.routeDigest);
assert.equal(dispatchDigest(route.selected ?? route.route), request.routeDigest);
assert.deepEqual((await read("20261116000000000005.checkpoint.json")).completed, []);
await assert.rejects(access(`${root}/ANALYZE.dispatch-attempt.json`), { code: "ENOENT" });
await assert.rejects(access(`${root}/ANALYZE.result.json`), { code: "ENOENT" });
await assert.rejects(access(`${root}/MAP_COMPONENTS.task.json`), { code: "ENOENT" });
console.log(JSON.stringify(request, null, 2));
NODE
```

Não edite o pedido, a rota ou o task receipt após essa inspeção. Se Analytics não foi selecionado ou outro assert falhou, pare e investigue; não improvise um segundo envio.

## 4. Executar uma única vez pelo shell autorizado

```sh
npm run autopilot:dispatch -- .local-maestro/central-demo/20261116000000000005 ANALYZE
```

O executor cria `ANALYZE.dispatch-attempt.json` com exclusividade antes de chamar a CLI oficial. Registra a identidade `official-maestri-cli` e o `MAESTRI_TERMINAL_ID` herdado. `command-returned` e `unknown` não comprovam conclusão ou autoria: `deliveryVerified` permanece `false`.

Se houver timeout ou interrupção, **não repita esse comando**, não apague a tentativa e não crie outro taskId/job como recuperação. Uma tentativa existente impede novo envio mesmo que o processo tenha morrido antes de gravar `ANALYZE.dispatch-receipt.json`.

## 5. Reconciliar o mesmo pedido e pausar após o checkpoint

```sh
npm run autopilot:central -- 20261116000000000005 --defer-dispatch --pause-after-analyze
```

O controller usa o mesmo taskId, lê o resultado persistido e consulta `maestri check` quando necessário; não chama `ask`. Um resultado tardio é aceito mesmo após o orçamento de polling se esgotar. Se ainda estiver trabalhando, acompanhe sem reenviar:

```sh
"${MAESTRI_CLI:-maestri}" check Analytics
```

Repita somente o comando de reconciliação deste passo quando o resultado estiver disponível. Erros específicos ficam em `events.jsonl`; `failure.json` é o diagnóstico da última falha e pode continuar presente após recuperação, portanto não o use isoladamente como estado atual.

Ao concluir, a CLI retorna `paused:true`, `pauseAfter:"ANALYZE"`, `completed:["analyze"]` e `state:"running"`. A pausa é operacional: não significa REVIEW nem aprovação humana. `status.json` registra `status:"paused"`. O checkpoint completo mantém sua identidade de pipeline, sem truncar etapas ou marcar REVIEW prematuramente. A flag deve ser repetida nas retomadas; omiti-la permite continuar o workflow. Um job que já completou etapas posteriores rejeita essa pausa em vez de retroceder.

## 6. Verificar o aceite

```sh
node --import tsx --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verifyDispatch } from "./src/autopilot/dispatch-executor.ts";
import { artifactDigest, validateResult } from "./src/autopilot/central-controller.ts";
const root = ".local-maestro/central-demo/20261116000000000005";
const read = async name => JSON.parse(await readFile(`${root}/${name}`, "utf8"));
const checkpoint = await read("20261116000000000005.checkpoint.json");
const task = await read("ANALYZE.task.json");
const attempt = await read("ANALYZE.dispatch-attempt.json");
const request = await verifyDispatch(root, "ANALYZE", task);
assert.ok(request);
assert.equal(request.jobId, "20261116000000000005");
assert.equal(request.agentId, "Analytics");
assert.equal(request.resultContractVersion, 2);
const raw = await readFile(`${root}/ANALYZE.result.json`, "utf8");
const result = validateResult(raw, "ANALYZE", request.taskId, request);
const output = checkpoint.outputs.analyze;
assert.equal(checkpoint.jobId, request.jobId);
assert.equal(checkpoint.state, "running");
assert.deepEqual(checkpoint.completed, ["analyze"]);
assert.equal(output.resultContractVersion, 2);
assert.deepEqual(output.result, result);
assert.equal(output.resultDigest, createHash("sha256").update(raw).digest("hex"));
assert.equal(output.dispatch.taskId, request.taskId);
assert.equal(output.dispatch.agentId, "Analytics");
assert.equal(output.dispatch.requestDigest, task.requestDigest);
assert.equal(output.dispatch.routeDigest, task.routeDigest);
assert.ok(output.artifacts.length > 0);
assert.deepEqual(output.artifacts, result.artifacts);
for (const artifact of output.artifacts) {
  assert.equal(await artifactDigest(root, artifact.file), artifact.digest);
}
assert.equal(attempt.identity.executorId, "official-maestri-cli");
assert.ok(process.env.MAESTRI_TERMINAL_ID);
assert.equal(attempt.identity.terminalId, process.env.MAESTRI_TERMINAL_ID);
const reconciliation = await read("ANALYZE.reconciliation.json");
assert.equal(reconciliation.action, "result-collected");
assert.equal(reconciliation.resultContractVersion, 2);
assert.equal(reconciliation.resultDigest, output.resultDigest);
assert.deepEqual(reconciliation.artifacts, output.artifacts);
const status = await read("status.json");
assert.equal(status.stage, "ANALYZE");
assert.equal(status.status, "paused");
assert.equal(status.pauseAfter, "ANALYZE");
for (const suffix of ["task.json", "route.json", "dispatch.json", "dispatch-attempt.json"]) {
  await assert.rejects(access(`${root}/MAP_COMPONENTS.${suffix}`), { code: "ENOENT" });
}
console.log(JSON.stringify({ accepted: true, jobId: checkpoint.jobId, taskId: request.taskId,
  completed: checkpoint.completed, status: status.status, artifacts: output.artifacts }, null, 2));
NODE
```

Esse aceite comprova identidade vinculada, manifesto verificado, resultado persistido e checkpoint ANALYZE concluído antes de qualquer preparação/despacho de MAP_COMPONENTS. Não comprova por assinatura a identidade do autor nem a veracidade de todas as afirmações do agente; os hashes verificam a consistência dos arquivos locais.

Para confirmar retomada sem duplicação, repita o comando do passo 5 e o verificador do passo 6. O checkpoint pausado é reutilizado sem regravar seu arquivo e o taskId permanece igual; a tentativa original continua impedindo novo envio. Não use um segundo `autopilot:dispatch` como teste de aceitação real.
