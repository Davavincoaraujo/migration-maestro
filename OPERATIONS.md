# Operação

## Pré-requisitos

Execute na raiz do repositório, Node 22 (`nvm use`), após `npm ci`.
No terminal autorizado, `maestri list` deve mostrar nomes únicos e exatos dos
agentes. A CLI usa somente list/check/ask; não recruta, reinicia ou muda sessões.
Não habilite Wire nem amplie permissões para contornar IPC bloqueado.

## Cadastro e política

Edite `config/operational-agents.json` antes de criar o job. Cada agente declara
agentId, mode, provider, modelId e capabilities. Os valores iniciais refletem as
declarações fornecidas: Analytics/UE-Pattern Sol, Hermes Astra; não foram verificados
por uma API de sessão. As capacidades suportadas são analysis, mapping, planning,
coding e validation. Cadastre o nome exato único do `maestri list`.

Para fallback use `mode:"fallback", provider:"unknown", modelId:null`. Esse modo
aceita apenas LOW. A política padrão permite até MEDIUM para agentes declarados,
sempre no escopo isolated-synthetic. Não amplie o risco mudando o nome de uma tarefa.
Política fica copiada no job e não muda em resume. Mudanças exigem novo job após
reconciliar o anterior; não use isso para repetir envio desconhecido.

## Tarefa e pipeline

```sh
npm run maestro:operate -- task new --confirm-synthetic
npm run maestro:operate -- status <job-id>
npm run maestro:operate -- resume <job-id> --confirm-synthetic
```

`task` exige um inventário real escrito pelo Analytics e um exercício de capacidade
anterior. `--confirm-synthetic` é consentimento operacional explícito para esses
prompts de escopo limitado; não atesta modelo nem identidade.

```sh
npm run maestro:operate -- pipeline new --confirm-synthetic --pause-after-plan
npm run maestro:operate -- resume <job-id> --confirm-synthetic
```

Executa ANALYZE → MAP_COMPONENTS → PLAN → IMPLEMENT → VALIDATE → REVIEW.
O resultado desse teste é HTML estático sintético. REVIEW prepara a revisão;
somente o operador aceita a entrega. Use a mesma flag de pausa ao retomar se ainda
não quiser passar PLAN. `resume` sem a flag permite continuar o escopo sintético.

## React/Next.js isolado

Para autorização limitada permanentemente a PLAN, use
`npm run maestro:operate -- pipeline new --confirm-synthetic --plan-only`.
O teto fica em operation.json e é preservado por `resume`, mesmo sem repetir a flag.
Esse modo para imediatamente após recibo de despacho ambíguo, incluindo probes.
Não retome após ambiguidade sem reconciliação humana; nunca reenvie a solicitação.
Não é possível liberar IMPLEMENT removendo a flag desse job. `--pause-after-plan`
sozinho continua sendo uma pausa temporária, conforme o fluxo anterior.

```sh
npm run maestro:operate -- next new --confirm-synthetic --pause-after-plan
```

Anote o ID retornado. Após PLAN, revise os manifestos. No diretório
`.local-maestro/operations/<id>/project`, revise o package.json gerado e instale
suas dependências com `npm install` no ambiente autorizado. Esse passo usa rede
e dependências externas; não é feito implicitamente pelo coordenador. Volte à
raiz e use `resume <id> --confirm-synthetic`. IMPLEMENT e VALIDATE executam
TypeScript, React SSR e Next build sobre o projeto isolado. Não há teste visual
implícito, EDS/VDS, troca de renderizador, escrita AEM ou falha intencional.

Se faltar dependência, IMPLEMENT não é despachado. Se o código falhar nos checks,
o job não avança. Preserve artefatos e solicite correção revisada; o piloto antigo
com correção/falha deliberada continua separado, não é o padrão operacional.

## Resultado, revisão e rastreabilidade

Acompanhe `maestro:operate -- status [id]`. Estados: running, pending (pausa ou
resultado tardio), blocked (pré-requisito externo/política), failed (contrato/bytes
inválidos), awaiting-approval e completed (aceite local). executionMode é real ou
simulated; nenhum teste simulado vira aceite real. realAcceptanceVerified refere-se
a coleta/validação operacional, não à identidade autenticada do provedor.

Dentro do job: operation.json contém input/política; probes/ contém os desafios;
*.task.json, *.dispatch.json, *.dispatch-attempt.json e *.dispatch-receipt.json
vinculam tarefa, agente e envio; *.result.json e artefatos contêm os resultados;
*.checkpoint.json conserva etapas/hashes; events.jsonl registra transições.
A CLI de status não imprime prompts ou transcripts. Logs novos de ask/check guardam
somente tamanho, nunca conversa. Não compartilhe arquivos locais brutos.

Após inspecionar os artefatos:

```sh
npm run maestro:operate -- review <job-id> --approve-local --reviewer=<operador>
```

O recibo review.json vincula o operador ao hash do checkpoint. Aceite local não
aprova merge, push, publicação ou alteração corporativa. O mesmo aceite é idempotente.

## Interrupção e retomada

Prefira pausa após PLAN. Se houver interrupção abrupta, confira processo, lock,
recibo de tentativa e atividade do agente antes de agir. Não apague locks ou
recibos para tentar de novo. Um ask com timeout pode ter sido entregue. O teto é
12 polls por tarefa; uma retomada ainda pode coletar resultado tardio sem reenviar.
Não há cancelamento presumido. Recuperação de lock está em TROUBLESHOOTING.md.

Para retomar o job mínimo já verificado, no shell original:

```sh
npm run maestro:operate -- resume 4f07b36eae3079cd0131 --confirm-synthetic
```

Esse job concluiu ANALYZE e REVIEW com execução real e aguarda aceite humano.
A auditoria de 18/11/2026 confirmou retomada offline sem chamadas ao transporte e
sem alteração dos arquivos. Não crie outro job para repetir esse inventário.
Veja `docs/operational-acceptance.md` para evidências e a próxima tarefa isolada.

## Projetos corporativos

`maestro:migrate`/`maestro:resume` e as integrações AEM anteriores são preservados,
mas não estão homologados por esta entrega. Use checkout/branch isolados e
configuração explícita, revisão de escopo e autorização específica de escrita.
Consulte docs/autonomy-readiness.md, docs/local-execution.md e
 docs/mapper-exporter-contracts.md. Nenhuma autorização sintética libera esses fluxos.
