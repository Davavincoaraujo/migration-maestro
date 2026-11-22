> Documento histórico preservado. A entrada operacional atual e seus limites estão em [ARCHITECTURE.md](../ARCHITECTURE.md) e [OPERATIONS.md](../OPERATIONS.md).

# Prontidão de autonomia — 2026-11-16

Resultado: **MVP end-to-end real ainda não aceito**. Há código executável e testes
locais, mas nenhum novo despacho real, edição do portal ou escrita AEM foi
realizado nesta rodada. O job `20261116000000000005` permanece preservado.

## Matriz de lacunas e caminho crítico

| Capacidade | Estado/evidência | Dependência e aceite restante |
| --- | --- | --- |
| Pipeline, checkpoints, locks, hashes e envio único | Implementado; testes com transportes e CLI falsa | Execução com especialistas reais e retomada interrompida |
| Pausa após PLAN | Implementada/testada na API e CLI | Aceite operacional conforme plan-authorized-validation.md |
| PLAN sintético v1 | Contrato, vínculo ANALYZE/mapping, decisões e testes validados | Revisão semântica do plano real produzido pelo Hermes |
| Descoberta/roteamento por tarefa | Implementado; LOW/MEDIUM/HIGH/CRITICAL, capacidade, custo verificado, limites e revisão adicional | Sessões ADVANCED elegíveis; CRITICAL sinaliza revisão extra, não cria revisores |
| Orçamento | Reservas por pedido preparado, teto de job/etapa na API, limite de despachos e reparos | Sem telemetria real: custos/tokens permanecem null; teto USD bloqueia custos desconhecidos. Jobs filhos de reparo têm limite próprio; agregação financeira pai/filhos ainda pendente |
| Sessões Maestri | Adaptador oficial e reconciliação testados | CLI real retorna EPERM; nenhum modelo é ativado/trocado pelo código |
| Descoberta da página | Adapter Analyst MCP existente | Nova extração real e evidências de interação/responsividade pendentes |
| Componentes/mappers/exporter | Teste usa código real do portal e readback AEM histórico | Não prova estado vivo do Author nem equivalência visual |
| Lacunas de componentes | Cobertura detecta lacunas e bloqueia contratos não comprovados | Geração automática de componente/contrato ausente ainda parcial |
| Plano local AEM | Manifesto files/tasks e gates existentes | Não usa o novo dialeto PLAN sintético; schema local completo versionado ainda parcial |
| Portal | Manifestos, escopo, autorização explícita e hashes | Escrita fora das raízes autorizadas bloqueada; isolamento automático ainda não integrado à nova CLI. Usar checkout isolado autorizado |
| AEM/DAM | Create-only, payload/contratos, intent antes do POST, reconciliação por GET | Ambiente/escopo explicitamente autorizados, autenticação e rede; atualização de conteúdo existente continua bloqueada por design |
| TEST → DIAGNOSE → FIX → RETEST | Integrado antes do checkpoint IMPLEMENT; comandos confiáveis; reparos como jobs filhos pelo controller existente | Ciclo local com subprocessos reais passou. Correção por Hermes real não validada |
| Validação independente | Agente distinto do implementador, checks e hashes | Browser, acessibilidade, SSR, SEO e comparação visual automatizada ainda não aceitos; declarações de agente não são prova |
| CLI início/status/retomada | Implementada; configuração persistida, pausa e bloqueios expostos | Fluxo real bloqueado por IPC/Author/autorizações |
| Entrega | delivery-manifest com hashes; idempotente e sem operações Git | Branch/commits/PR automáticos ainda não integrados. Nenhum push/PR/merge/publicação autorizado |

Ordem operacional: resolver acesso IPC pelo host → comprovar sessão ADVANCED →
validar PLAN sintético com pausa → revisar contratos/escopo → fornecer checkout
isolado e autorização específica → validar ciclo completo em job sintético novo →
somente então piloto AEM não produtivo autorizado. Não aproveitar o job histórico
como ambiente de experimentação nem apagar checkpoints para forçar reexecução.

## CLI

Usar Node 22.23.2. A política padrão é `plan-only`. `--autopilot` permite despacho
rotineiro até PLAN, mas **não concede autorização de edição/Author**. Sem
`--autopilot`, a CLI prepara pedidos com execução diferida. Os comandos abaixo
são para execução futura, não foram usados para avançar o job de referência.

```sh
npm run maestro:migrate -- \
  --url "https://exemplo.com/pagina-legada" \
  --target "/content/site/pt-br/nova-pagina" \
  --page-root "/content/site" --dam-root "/content/dam/site" \
  --project "/caminho/do/checkout-isolado-autorizado" \
  --environment non-production --policy plan-only --autopilot
npm run maestro:status -- <job-id>
npm run maestro:resume -- <job-id>
```

A configuração de destino fica no registro e é reutilizada na retomada. Mudar o
projeto/raízes/destino de uma migração pendente é rejeitado. IDs sintéticos
históricos podem ser consultados; sua continuação usa a CLI central específica.

Após revisão de PLAN, um operador pode fornecer um arquivo de autorização:

```json
{
  "version": 1,
  "jobId": "<20 hex do novo job>",
  "environment": "non-production",
  "authorOrigin": "http://localhost:4502",
  "project": "/caminho/do/checkout-isolado-autorizado",
  "pageRoot": "/content/site",
  "damRoot": "/content/dam/site",
  "portalEdits": true,
  "aemCreate": true,
  "approvedBy": "<identificação do operador que autorizou este escopo>"
}
```

Esse arquivo é uma declaração explícita do operador, não uma assinatura digital
nem substituto das permissões do host. Não criar automaticamente. Não contém
credenciais. Autenticação Author continua apenas nas variáveis de ambiente
existentes; a configuração do repositório não fornece autenticação.

Continuação dependente dessa autorização (não executada):

```sh
npm run maestro:resume -- <novo-job-id> \
  --continue-after-plan --authorization /caminho/autorizacao.json
```

A política `approved` em `maestro:migrate` também exige esse arquivo. Não existe
publicação automática. `aemCreate:false` bloqueia operações externas mesmo que
`portalEdits:true`. A autorização precisa corresponder ao job, origem, projeto e
raízes. Correções de conteúdo existente, push/PR e ambientes produtivos não são
habilitados por essas flags.

## Testes/correção e limites

O coordenador executa TypeScript, lint, testes e build por comandos do projeto,
sem aceitar comandos gerados pelo agente. A política padrão permite no máximo
2 reparos e 30 minutos de ciclo; cada comando possui timeout e saída limitada.
Logs e relatórios de cada ciclo são preservados com hashes. Falhas de
infraestrutura/autorização/limite de uso abrem o circuito sem escalonamento.
Entrega ambígua de reparo conserva o mesmo job filho/recibos para reconciliação.
Locks sobreviventes a crash exigem reconciliação do operador, sem roubo de lock.

O subprocesso de teste recebe ambiente sem NODE_TEST_CONTEXT para evitar falso
verde ao executar node:test dentro de node:test. Todos os checks são repetidos
após correção; testes não são removidos ou enfraquecidos. Reparos em arquivos
vinculados por contratos podem invalidar o mapping e são bloqueados, exigindo
nova evidência em vez de atualização silenciosa do contrato aceito.

Nenhum teste local com especialistas falsos conta como prova Maestri real. O
manifesto de entrega mantém acceptanceVerified:false até haver aceite externo
comprovado; resultados declarados pelos agentes ficam separados dos logs locais.
