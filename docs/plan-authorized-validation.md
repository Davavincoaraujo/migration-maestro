# PLAN v1 e pausa controlada

Procedimento futuro, não executado nesta implementação. Preservar o job
`20261116000000000005`, seus resultados, checkpoints e recibos. Usar Node 22.23.2
no shell original do coordenador, sem alterar `MAESTRI_TERMINAL_ID`.

## Contrato

Novos pedidos PLAN do demo com mapping v1 validado recebem
`planContractVersion:1` e `mappingDigest` no envelope version 1, cobertos pelo
digest do pedido. Resultados continuam version 2. Pedidos persistidos e
checkpoints históricos conservam seus contratos originais; não são atualizados.
O novo contrato é específico ao demo sintético, não ao manifesto AEM corporativo.

Artefatos obrigatórios e exclusivos: `PLAN.plan.json` e `PLAN.evidence.json`,
ambos no manifesto do resultado com SHA-256 dos bytes exatos. O plano tem:

- `version:1`, `jobId`, `taskId`, `stage:PLAN`.
- `scope:synthetic-only`, `corporateReuseVerified:false`,
  `implementationAuthorized:false`.
- `mappingFile:MAP_COMPONENTS.mapping.json`, `mappingDigest` SHA-256.
- `analyzeResultDigest` igual ao vínculo validado do mapping.
- `requirements`: cópia dos campos `mapping` do handoff.
- `semantics`, `responsiveRequirements`: cópias exatas dos arrays do handoff.
- `knownLimitations`: cópia exata de `limitations`.
- `reusedComponents:[]`, `componentsToImplement:["semantic-hero"]`,
  `plannedFiles:["index.html"]`, `dependencies:[]` ou dependências documentadas,
  `risks` não vazio, `blockers:[]` ou bloqueios explícitos.
- `decisions`: uma entrada por `gaps` e `limitations`, com
  `{kind:"gap"|"limitation",index:<índice base zero>,source:<texto exato>,
  decision:<abordagem concreta>,acceptanceCriteria:[...],testIds:[...]}`.
- `implementationPlan:{file:"index.html",steps:[...]}` e `acceptanceCriteria`.
- `proposedTests:[{id:<slug único>,method:"static"|"browser-manual",
  procedure:<verificação>,expected:<resultado>,status:"proposed"}]`.

Índices duplicados/ausentes/inválidos, referências de testes inexistentes,
identidades/hashes divergentes, arrays obrigatórios vazios e alegação de testes
executados são rejeitados. A validação é estrutural: não comprova a veracidade
semântica de todas as afirmações em linguagem natural. `blockers` precisa ser
revisto pelo operador; a pausa não é autorização de implementação.

## Pré-condições

1. Maestri IPC autorizado e sessões existentes conectadas.
2. `model-router:inspect` identifica sessão ADVANCED com planning/coding, sem
   limite explícito. Catálogo de modelos não comprova elegibilidade.
3. Checkpoint conserva completed `["analyze","map-components"]`; status pausado.
4. Mapping v1, resultados, hashes e proveniência conferem; nenhum recibo PLAN
   existente pode ser substituído ou descartado para obter outro despacho.
5. Nenhum controller concorrente; lock obsoleto exige reconciliação humana.

## Comandos dependentes da autorização operacional

Inspecionar sem despacho:

```sh
npm run maestro:status -- 20261116000000000005
npm run model-router:inspect
```

Autorizar separadamente a preparação de PLAN:

```sh
npm run autopilot:central -- 20261116000000000005 \
  --defer-dispatch --synthetic-mapping-v1 --pause-after-plan
```

A preparação para em `AUTHORIZED_EXECUTOR_REQUIRED` (envolvido no erro de etapa
PLAN), sem enviar prompts. Inspecionar `PLAN.route.json`, `PLAN.task.json` e
`PLAN.dispatch.json`, inclusive hashes, instruções e agente elegível.

Somente com autorização explícita de despacho:

```sh
npm run autopilot:dispatch -- .local-maestro/central-demo/20261116000000000005 PLAN
```

Reconciliar repetindo o comando de preparação com **as mesmas flags**. Nunca
repetir despacho ambíguo: os recibos existentes são a fronteira de envio único.

## Critérios de aceite

- completed `["analyze","map-components","plan"]`, state `running`.
- status `paused`, pauseAfter `PLAN`; CLI `paused:true`.
- Nenhum arquivo `IMPLEMENT.*`, evento de IMPLEMENT ou preparação/roteamento
  dessa etapa; o runner retorna antes de chamar a próxima etapa.
- Bytes e hashes de ANALYZE/MAP_COMPONENTS preservados.
- Retomadas com a pausa preservam o checkpoint e taskId PLAN, sem reenvios.
- PLAN é revalidado a cada retomada, incluindo vínculo ao mapping e ANALYZE.

`--pause-after-analyze`, `--pause-after-map-components` e `--pause-after-plan`
são mutuamente exclusivos. Pedir uma pausa já ultrapassada falha, sem retroceder.
Omitir a pausa permite continuar: isso exige uma autorização operacional distinta.
Não executar essa continuação durante o aceite de PLAN.
