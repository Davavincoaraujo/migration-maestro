# Validação de comunicação — 2026-11-15

Branch consultada: `feat/agent-plan-task-handoff`.
Instruções lidas: `MAESTRI.md` e `MAESTRI_PROMPT.md`.

## CLI oficial do Maestri

A ajuda instalada confirmou `maestri ask "Agent Name" "prompt"` para envio e retorno da resposta, e `maestri check "Agent Name"` para consulta do terminal. `maestri list` confirmou os nomes dos três especialistas e do coordenador `Migration Orchestrator`.

O acesso ao socket exigiu execução fora do sandbox com solicitação de aprovação. Nenhuma permissão de socket ou configuração global foi alterada.

## Testes no canvas

Cada especialista recebeu um pedido simples de confirmação de recebimento e disponibilidade, com marcador próprio e instrução para não usar ferramentas nem iniciar migração. As saídas foram recebidas pelo próprio `ask`.

| Destino | Marcador solicitado | Retorno observado | Resultado |
| --- | --- | --- | --- |
| Analytics | `MAESTRO_ANALYTICS_ACK` | `zsh: command not found: Teste` | Falhou |
| UE-Pattern | `MAESTRO_UE_PATTERN_ACK` | `zsh: command not found: Teste` | Falhou |
| Hermes | `MAESTRO_HERMES_ACK` | `zsh: command not found: Teste` | Falhou |

A entrega aos terminais funcionou, mas nenhum especialista confirmou recebimento ou disponibilidade. As saídas indicam shells interpretando os prompts como comandos. Comunicação bidirecional com agentes autônomos não comprovada. É necessário iniciar agentes reais nesses terminais e repetir o teste antes de execução autônoma.

## Smoke test local

As variáveis foram definidas no ambiente da execução, sem alteração de configuração global:

- `MAESTRO_ANALYTICS_DIR`: projeto `migration-analyst` em `~/Developer`.
- `MAESTRO_UE_PATTERN_DIR`: projeto `ue-pattern` em `~/Developer`.
- `MAESTRO_COMPONENTS_PROJECT_DIR`: checkout de aplicação de destino configurado localmente.

Comando: `npm run integration:smoke -- hero`.

A primeira tentativa foi bloqueada pelo sandbox ao criar o socket IPC temporário do tsx (`listen EPERM`). A execução fora do sandbox, com solicitação de aprovação, terminou com código 1:

```json
{
  "mode": "read-only",
  "analytics": { "status": "failed", "reason": "ANALYTICS_CALL_FAILED" },
  "uePattern": { "status": "completed" },
  "hermes": { "status": "completed", "promptCompleted": true, "responseMatched": true },
  "ready": false
}
```

O sucesso do Hermes via ACP e do UE-Pattern via CLI local é independente dos terminais homônimos do canvas. O smoke test não expõe a causa detalhada da falha Analytics.

Nenhuma migração, publicação no AEM, merge ou push foi realizada.

## Correção da integração Analytics — 2026-11-15

Causa raiz confirmada: o terminal selecionava Node 18.20.8. O adaptador usa `process.execPath` para iniciar o servidor MCP, portanto herdava esse runtime. O processo encerrava durante a inicialização: o Playwright instalado exige Node >=20; o próprio `migration-analyst` declara Node >=22.19. O diagnóstico reduzido foi `ANALYST_EXITED_INITIALIZE_NONZERO_STDERR`.

O entrypoint `mcp/dist/src/server.js` já existia, as dependências estavam instaladas e o typecheck do servidor passou. Nenhuma reconstrução, instalação ou alteração do contrato MCP foi necessária. Sob Node 25.2.1 já instalado, a mesma chamada `search_component_catalog` completou initialize, tools/list e tools/call com `resultReceived: true` e `isError: false`.

Correção local: criado `.local-maestro/integration-env.sh` (ignorado pelo Git), selecionando o runtime compatível no PATH e os três diretórios de integração. Para repetir no terminal do projeto:

```sh
source .local-maestro/integration-env.sh
npm run integration:smoke -- hero
```

Esse arquivo deve ser carregado em cada nova sessão; não altera o shell global nem é carregado automaticamente pelo npm.

Validação:

- `npm run check`: passou.
- Testes Analytics e smoke do Maestro: 8 passaram, 0 falharam.
- Typecheck do `migration-analyst`: passou.
- Testes de catálogo do `migration-analyst`: 2 passaram.
- Teste MCP do `migration-analyst`: falhou na expectativa de que a busca `cards` com limite 2 contenha `global--cards`. A busca retorna outros componentes do catálogo local; a conexão, descoberta de ferramentas/recursos e resposta MCP funcionaram. Essa expectativa de ranking não foi alterada nesta correção.
- Smoke completo fora do sandbox, com aprovação: código 0, Analytics `completed`, UE-Pattern `completed`, Hermes `completed`, `promptCompleted: true`, `responseMatched: true`, `ready: true`.

A correção da integração local não muda o resultado anterior dos terminais do canvas: sua comunicação com agentes reais ainda precisa ser validada.

## Nova validação com especialistas ativos — 2026-11-15

`maestri list` confirmou Analytics, UE-Pattern e Hermes conectados ao Migration Orchestrator. As tarefas foram enviadas por `maestri ask --batch` (comando oficial), e as saídas foram consultadas individualmente com `maestri check`, durante a execução e após sua conclusão. A CLI foi executada fora do sandbox mediante solicitação de aprovação. `maestri debug` confirmou conexão OK ao socket no contexto aprovado do coordenador.

Nesta rodada, todos os terminais mostraram sessões Codex ativas e respostas específicas às tarefas, em vez de erros de shell.

| Agente | Resposta real observada | Pedido/resposta via ask e check | Retorno iniciado pelo especialista |
| --- | --- | --- | --- |
| Analytics | `ANALYTICS_DIAGNOSTIC_ACK`, confirmação de agente ativo e diagnóstico dos recursos disponíveis | Comprovado | Bloqueado: `Connection failed: Operation not permitted` |
| UE-Pattern | `UE_PATTERN_MAPPING_ACK` observado durante a execução, seguido de plano de mapeamento, evidências e lacunas | Comprovado | Mesmo bloqueio |
| Hermes | Plano concreto de demo isolada, contrato, testes e gates de revisão; marcador solicitado não visível na saída final limitada ao terminal | Comprovado pela resposta específica | Mesmo bloqueio |

Resultados e limites:

- Analytics relatou que ferramentas Analytics MCP não estão expostas diretamente na sessão dele. Não executou busca hero. Isso é distinto da integração local do coordenador que passou no smoke: o diagnóstico do especialista se limitou às ferramentas/recursos da própria sessão.
- UE-Pattern propôs decompor conteúdo, layout, mídia, CTAs e estados; comparar componentes, tokens, variantes e responsividade; registrar evidência, adaptações e confiança. Não validou equivalência concreta: faltam hero alvo, capturas/DOM e catálogo no contexto da tarefa.
- Hermes propôs contrato com fixture sintética, destino isolado, hero semântico/responsivo/acessível, testes de escaping, links, campos ausentes, teclado e mobile/desktop, além de revisão técnica e visual antes de integração. Não implementou nem executou testes.
- Os três tentaram reportar com `maestri ask "Migration Orchestrator"`, mas o acesso ao socket foi negado em suas sessões. Não foi alterada nenhuma permissão para contornar o bloqueio. O próximo passo para comprovar esse caminho é executar a CLI com aprovação também nas sessões dos especialistas.

Conclusão de comunicação por agente: Analytics, UE-Pattern e Hermes têm troca bidirecional de pedido/resposta comprovada pelo coordenador via `ask` e `check`. A comunicação iniciada pelos especialistas de volta ao coordenador ainda não foi comprovada para nenhum dos três; todos registraram falha de permissão. Nenhum sucesso de ferramenta local substitui essa validação.

### Investigação do ranking `global--cards`

Inspecionados `mcp/src/catalog.ts`, `mcp/tests/catalog.test.ts`, `mcp/tests/server.test.ts` e o catálogo local por sua API compilada. O catálogo carregado contém 117 componentes e foi gerado em 2026-10-05. `global--cards` está presente.

A busca soma pesos por campo que contém o termo: nome 5, título 4, cada prop/field/variant 2 e capability 1. Não há bônus de igualdade exata. A ordenação usa score decrescente e ID como desempate. Para `cards`:

| Posição | ID | Score |
| --- | --- | --- |
| 1 | `cinemark--background-image-with-cards` | 19 |
| 2 | `agro--service-bg-cards` | 15 |
| 3 | `agro--service-icon-cards` | 15 |
| 4 | `cinemark--image-cards-navigation` | 13 |
| 5 | `global--cards` | 13 |

O score 13 de `global--cards` corresponde a nome (5), título (4), prop cards (2) e field cards (2). O teste MCP pede `limit: 2` e exige esse ID, mas o algoritmo atual não garante sua presença no top 2. O ranking favorece componentes com mais campos correspondentes; isso explica a falha sem indicar quebra de transporte MCP ou ausência do componente.

Verificação adicional com assertions executada sob o runtime local: componente presente, score 13, busca com limite 2 igual ao prefixo do ranking completo e busca em catálogo isolado contendo o componente retornando seu ID — todas passaram (código 0). Nenhum conteúdo de implementação foi copiado para este repositório.

Não foi alterada a expectativa nem o algoritmo. Tornar o teste MCP independente do catálogo mutável requer fixture controlada; alterar relevância para favorecer igualdade exata requer definir esse requisito e testar o ranking explicitamente. Nenhuma dessas decisões foi presumida nesta investigação.

Alterações desta rodada: somente este registro. Nenhuma alteração de produção, publicação no AEM, merge ou push.

## Autopilot central executável — 2026-11-15

Implementado `autopilot:central` com o Migration Orchestrator controlando os envios e as consultas. Foram reutilizados `runCheckpointed` e `FileCheckpointStore`; o bridge de planejamento anterior não foi convertido implicitamente em executor. Detalhes e recuperação em `docs/central-autopilot.md`.

Demo real executada com ID `20261115000000000001`, exclusivamente em `.local-maestro/central-demo/<id>/`, usando título e CTA sintéticos. O comando foi aprovado fora do sandbox para acesso à CLI, sem desativar o sandbox dos especialistas. Sequência concluída:

`ANALYZE -> MAP_COMPONENTS -> PLAN -> IMPLEMENT -> VALIDATE -> REVIEW`

Analytics produziu inventário e validação independente; UE-Pattern documentou a composição genérica e lacunas; Hermes produziu plano e `index.html`. O controlador consultou o catálogo real via MCP com busca `hero`, sem alterar ranking, e preservou a resposta somente na evidência local ignorada. Nenhum código de componente corporativo foi copiado para a demo ou enviado aos agentes.

Todos os envios `ask` excederam o timeout local de 30 segundos. As tarefas continuaram nos especialistas e seus resultados foram recuperados sem reenvio. A implementação e a validação exigiram consultas `check`, registradas em logs locais. Os UUIDs de tarefa, orçamento de consultas e hashes dos resultados persistem. Não houve dependência de mensagens espontâneas.

Resultado final: checkpoint `awaiting-review`, seis etapas persistidas, `humanApprovalRequired: true`, `publishingAuthorized: false`, `mergeAuthorized: false`. Uma nova execução com o mesmo ID reutilizou as seis etapas e revalidou os hashes sem delegar nova implementação.

HTML produzido: `index.html` dentro da demo local. SHA-256 validado: `65b62024747cd5b85572da31e232368c4fb64848e724a6cb155b98c99521c5ae`. A validação independente confirmou título/CTA, semântica, destino interno, CSS responsivo e ausência de recursos externos. Ela explicitamente não realizou testes em navegador ou comprovou conformidade WCAG.

Testes:

- `npm run check`: passou.
- Suíte completa `npm test`, fora do sandbox após aprovação por bloqueio de sockets locais: 253 testes passaram, zero falhas.
- Testes específicos de controlador, adaptador CLI e checkpoints: 11 testes passaram, incluindo pipeline completo com subprocessos da CLI simulada, timeout, retomada sem duplicação, resposta tardia, limites de retry, resultado inválido, lock e evidência alterada.
- Checagem adicional `integration:smoke -- hero` após a demo: código 1, Analytics e UE-Pattern `completed`, Hermes ACP `promptCompleted: true` mas `responseMatched: false` (`HERMES_ACK_MISMATCH`), `ready: false`. O ACK estrito do caminho ACP falhou nesta execução; esse adaptador não foi alterado nem usado pelo novo controlador Maestri. O sucesso anterior do smoke não foi presumido como resultado atual.

Limites (registro histórico): entrada limitada à fixture sintética; sem mapeamento corporativo verificado, executor de produção ou serviço autenticado de aprovação. O gate REVIEW é uma parada obrigatória e não possui transição automática para publicação ou merge. Locks após crash exigem reconciliação pelo operador. Os detalhes antigos de falha permanecem no histórico local, sem invalidar o sucesso posterior.

Nenhuma publicação no AEM, push, merge, alteração global de permissões ou mudança de produção foi realizada.

## Piloto da página pública e correção ACP — 2026-11-15

Fonte real: URL de origem omitida (evidência histórica sanitizada)

Foi reutilizado `analyzeUrlViaMcp`, com a ferramenta real `collect_page_evidence`. As duas capturas retornaram HTTP 200 em sessões novas, sem estado autenticado. O novo perfil `publicPilotWorkflow` estende o controlador existente, preservando lock, recibos, timeouts, polling limitado, hashes, checkpoints e parada em revisão. Não há segundo executor paralelo de etapas.

O piloto `20261115000000000002` executou ANALYZE, MAP_COMPONENTS, PLAN, IMPLEMENT e VALIDATE por `maestri ask/check`, e chegou à parada REVIEW com `awaiting-review`. A retomada com o mesmo ID revalidou os artefatos sem reenvio. Foram cinco dispatches efetivos; falhas iniciais de extração ocorreram antes do primeiro dispatch. O sandbox dos especialistas não foi desativado.

### Dados e componentes

O modo executado foi exclusivamente público: `metadataAllowed: false`. A preferência sobre consultar metadados locais foi solicitada; nenhuma autorização foi presumida. Assim, o catálogo privado e o conhecimento local opcional UE não foram consultados nesta execução. O agente UE-Pattern fez o mapeamento dos dados públicos; a integração opt-in de metadados reais está implementada, mas não foi exercitada no piloto. Isso não demonstra ausência de componentes no catálogo.

| Região observada | Seletor real | Aproximação local planejada/implementada | Equivalência de catálogo |
| --- | --- | --- | --- |
| Breadcrumb | `.path-link` | Trilha semântica com atalhos locais | Nenhuma verificada; confiança baixa |
| Banner | `section.banner` | Título e placeholder de imagem | Nenhuma verificada; confiança baixa |
| Produtos | `#conteudo` | Sete cards estáticos e referências locais | Nenhuma verificada; confiança baixa |
| Serviços | `section.servicos` | Três cards com placeholders | Nenhuma verificada; confiança baixa |
| WhatsApp | `section.whatsApp` | Bloco informativo e mídia não funcional | Nenhuma verificada; confiança baixa |
| Vídeo | `section.example-video` | Título e placeholder sem player | Nenhuma verificada; confiança baixa |
| Simulação | `.qrcode` | QR placeholder e referência local, sem simulador | Nenhuma verificada; confiança baixa |

Os produtos públicos identificados foram crédito pessoal, crédito rápido, crédito consignado, limite da conta, crédito imobiliário, crédito pessoal com garantia de imóvel e financiamento de veículos. Duplicações responsivas foram deduplicadas. Navegação global, login, busca, consentimento e tracking foram excluídos da implementação. Nenhum contrato AEM foi inferido.

### ACK ACP

A consulta somente leitura ao histórico das próprias sondagens identificou a resposta divergente: o modelo enviou `MAESTRO_INTEGRATION_ACK` seguido de um resumo dos status MCP/UE incluídos no prompt. Isso comprova texto extra gerado pelo modelo, não uma resposta ACP perdida ou sucesso válido rejeitado indevidamente. A sonda inicial e quatro repetições posteriores retornaram ACK correto, caracterizando falha intermitente de seguimento do prompt original.

Correção: remover status do pedido de ACK, terminar com instrução de saída literal e preservar igualdade exata. A validação também exige `end_turn`, ausência de truncamento e zero solicitações negadas. Não foi aceito substring, Markdown, prefixo/sufixo nem sucesso por retry. O teste inclui a antiga resposta incorreta e confirma sua rejeição. Dois smoke tests completos independentes após a correção retornaram `ready: true`.

### Build, testes e evidências

Artefatos locais ignorados em `.local-maestro/central-demo/20261115000000000002/` (registro da execução anterior):

- `source.html`, `source.json`, `source-mcp.json`, `source-desktop.png`, `source-mobile.png`;
- `inventory.json`, `mapping-evidence.json`, `mapping.json`, `implementation-plan.json`;
- `index.html`, `built.index.html`, `build-report.json`, `test-report.json`, `pilot-desktop.png`, `pilot-mobile.png`;
- resultados de cada especialista, recibos UUID, logs `ask/check`, journal de eventos, estado e checkpoint;
- `dashboard-check.json` é evidência histórica da interface removida: HTTP 200 e seis etapas em `/autopilot/data`, sem evidência bruta exposta naquela versão.

O build estático confiável produziu HTML com CSP, sem executar scripts gerados ou instalar dependências. Foram validadas semântica, cobertura das sete regiões/produtos, IDs, links derivados da fonte ou fragmentos locais e proibição de conteúdo ativo/recursos externos. Renderização real em Chromium desktop 1440×1000 e mobile 390×844 passou com zero requests de rede, sem overflow horizontal e com foco de teclado. As capturas foram salvas; a captura mobile também foi inspecionada visualmente pelo coordenador.

SHA-256: `index.html` = `8bfec519ebdfdb135d1c53747dd874e67f6ed0513f7d1bd40634717b8f3637ea`; `built.index.html` = `274cfb7caa32809240c32fa5557d6ed1e14371236204659ab8a97aa99156c6dc`.

Validação histórica da execução: typecheck passou; suíte completa passou com 258 testes, zero falhas e zero skips; dois smoke tests corrigidos retornaram código 0 e `ready: true`. Naquela versão, a integração real do dashboard foi verificada com servidor loopback temporário. A interface HTML e a rota `/autopilot` foram removidas na limpeza posterior; Autopilot, checkpoints e evidências locais permanecem.

Falhas durante desenvolvimento: a extração inicial encontrou o helper `__name` introduzido pelo tsx em callback serializado para o navegador; a tentativa intermediária com string de função não executou a função. A extração foi corrigida usando callbacks sem closures nomeadas. Essas tentativas não delegaram etapas nem invalidaram evidências já concluídas. Uma consulta de retomada com ID digitado fora do formato também foi rejeitada antes de qualquer execução; a retomada com ID correto passou.

### Limitações e revisão

Analytics concluiu a revisão independente com ressalvas: sete regiões e hashes conferem, mas há descrições públicas de produtos/serviço omitidas; navegação externa virou referência inerte/local; mídia, QR, carrosséis, tabs e simulador não são funcionais. O aviso integral contra contato impostor não foi preservado. A divergência de descrição imobiliária na origem foi exposta, sem decidir qual alegação é correta.

Portanto, cobertura estrutural e build aprovado não significam paridade integral de conteúdo, comportamento, WCAG ou visual. A aprovação humana está pendente. O build é HTML estático, não Next.js/AEM. A equivalência com componentes corporativos permanece não comprovada, e a execução opt-in de metadados ainda precisa de autorização e validação próprias. Ver `docs/public-pilot.md` para contrato e limites.

Nenhum dado interno, credencial corporativa, código de projeto corporativo, publicação AEM, push, merge ou alteração global de permissões foi utilizado/realizado no piloto.
