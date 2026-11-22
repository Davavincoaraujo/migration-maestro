# Agent Runtime Adapter direto — avaliação de 19/11/2026

## Decisão

**Viável para um piloto controlado de correlação entre runtime, sessão e resultado;
não demonstrado nem habilitado como transporte operacional autenticado.**
O candidato prioritário é Codex App Server por stdio dedicado. ACP v1 é uma
alternativa para Nous Hermes, sujeita à versão e ao comportamento do servidor.
Esta é uma conclusão de engenharia a partir dos contratos abaixo, não uma prova
de uma sessão real. Nenhum agente foi iniciado nesta investigação.

A branch permanece `feat/agent-plan-task-handoff`. As alterações existentes,
políticas, bloqueios de PLAN, recibos, checkpoints e hashes históricos permanecem.
Nenhum job foi autorizado/retomado, nenhum dispatch real foi enviado, e não houve
acesso ao AEM, instalação, login, pareamento ou commit.

## Integração encontrada no repositório

| Componente | Estado observado no código | Limite |
| --- | --- | --- |
| Codex | Política operacional declara Codex para os três papéis; execução atual usa Maestri CLI por nome | Não há cliente App Server integrado |
| Hermes, papel | Requisito declarado de planning/coding; PLAN exige atestação ADVANCED e transporte vinculado | Nome do papel não identifica Nous Hermes ou modelo |
| Nous Hermes | `NousHermesAdapter.execute` recusa execução; probes ACP e executor experimental separado existem em `src/adapters/hermes/` | Esses probes iniciam processos quando invocados; não foram executados |
| Analytics | `local-analyst-mcp.ts` descobre ferramentas MCP; executor de especificações contém handlers sintéticos | Descoberta de ferramentas não identifica a sessão LLM do papel Analytics |
| UE-Pattern | `local-ue-pattern.ts` executa CLI local de consulta; existem simulador MCP e contratos de mapping | Catálogo/mapeamento não são protocolo de sessão do modelo |

A política `config/operational-agents.json` é declarativa. Não foi promovida a
atestação. Leitura do package.json instalado identificou `@openai/codex` 0.169.0;
isso não verifica integridade do executável nem compatibilidade com toda a
referência online. Nenhum comando Codex/Hermes foi executado para descobrir versão.

O executor ACP experimental existente correlaciona respostas por IDs numéricos,
mas não confere `params.sessionId` antes de acumular `agent_message_chunk`.
Também não fornece evidência autenticada de modelo, identidade ou recuperação
persistente. Recusar pedidos de permissão no cliente não prova isolamento do
processo. Esse executor foi apenas inspecionado e permanece fora do protótipo.
`docs/hermes-acp.md` contém um retrato antigo que diz que handshake ainda não existe;
os arquivos de implementação atuais e documentos específicos têm precedência
nesta avaliação. Não foi alterado esse histórico.

## Protocolos oficiais e limites

**Codex App Server.** A referência documenta initialize/initialized, thread/start,
thread/resume, turn/start e eventos por thread/turn/item. `thread.sessionId` pode
identificar a raiz compartilhada por forks: não deve substituir `thread.id` no
destino. Há seleção de modelo e evento model/rerouted. O esquema pode ser gerado
para a versão instalada. Stdio é o transporte escolhido para o piloto; WebSocket
é descrito como experimental. `account/read` relata estado da conta;
`requestAttestation` pede um token ao cliente para uso upstream, não certifica
para o coordenador a autoria de uma resposta. [Referência oficial](https://learn.chatgpt.com/docs/app-server).

**Codex não interativo.** `codex exec --json` fornece eventos estruturados e aceita
saída por schema; existe retomada de sessão. É alternativa para tarefas pontuais,
mas proponho App Server para controlar ciclo de vida e correlação explícita.
JSON e schema validam estrutura, não autenticam autor.
[Referência oficial](https://learn.chatgpt.com/docs/non-interactive-mode).

**ACP significa Agent Client Protocol nesta avaliação.** V1 cria/carrega sessões
e envia session/prompt com sessionId; session/update acompanha a sessão e a
resposta ao pedido encerra o turno com stopReason. Não foi assumido um turnId
universal em todas as notificações v1. O protótipo limita cada conexão a um turno
para não misturar atualizações de pedidos sucessivos. V2 está em draft e não foi
implementado. [Sessões](https://agentclientprotocol.com/protocol/v1/session-setup),
[turnos](https://agentclientprotocol.com/protocol/v1/prompt-turn).

ACP negocia recursos de protocolo e métodos de autenticação; authenticate bem
sucedido permite acessar operações que exigem login. Não é uma assinatura da
sessão/modelo/resultado. [Autenticação](https://agentclientprotocol.com/protocol/v1/authentication).
Config options podem reportar/alterar configurações de modelo; categorias servem
à interface e não são obrigatórias para correção. Alterações podem ser notificadas.
[Configuração](https://agentclientprotocol.com/protocol/v1/session-config-options).
ACP não fornece sandbox; pedidos de permissão dependem de o agente respeitar a
decisão. [Modelo de confiança](https://agentclientprotocol.com/protocol/v1/security).

**Nous Hermes ACP.** A documentação descreve servidor stdio, sessão com cwd/modelo,
persistência e configuração de provedor compartilhada com o CLI. Também descreve
ferramentas próprias do runtime. Portanto cwd temporário e mcpServers vazio não
provam ausência de ferramentas ou acesso externo. É necessário validar versão,
configuração efetiva e isolamento antes de um piloto real.
[Documentação Nous](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp).

## O que seria verificável

A distinção abaixo é requisito proposto para o futuro adaptador, não garantia
implementada pelo protótipo:

| Dimensão | Evidência necessária | O que não basta |
| --- | --- | --- |
| Identidade do runtime | Executável/origem aprovada, integridade verificada e canal privado ligado ao processo observado; geração de conexão | PATH, nome de agente, PID isolado, agentInfo ou JSON com verified=true |
| Sessão e envio | Destino devolvido por esse runtime, controle exclusivo do canal, correlação de pedido e turno, detecção de reconexão/troca | Reusar ID antigo, snapshot prévio ou comparar nomes |
| Modelo | Estado reportado pelo runtime confiável, configuração efetiva e observação de mudanças/fallback durante o turno | Modelo pedido, catálogo, rodapé ou declaração na resposta |
| Capacidade | Recursos disponíveis mais testes de capacidade sob a mesma política/sessão | agentCapabilities do protocolo ou lista local planning/coding |
| Disponibilidade | Operação contemporânea e limitada, sem promessa de disponibilidade futura | Login ou sessão criada sem inferência |
| Resultado | Evento correlacionado ao turno no canal confiável, status final e validação independente do contrato e bytes dos artefatos | Texto dizendo “sou Hermes”, saída com schema ou hash sem origem |

Confiança no processo local pode estabelecer proveniência **relativa a esse
runtime**. Não implica atestação criptográfica do modelo remoto que calculou cada
token. Não encontrei nos contratos consultados evidência suficiente para todas as
asserções de `SessionAttestation` existentes, particularmente perfil ADVANCED,
habilidade semântica e identidade/modelo upstream. A política não foi reduzida:
enquanto uma garantia requerida estiver ausente, a execução permanece bloqueada.

## Interface e compatibilidade proposta

`src/runtime-prototype/agent-runtime-adapter.ts` define `AgentRuntimeAdapter`:

- `open(modelRequested, signal)` obtém observação e binding imutável da simulação.
- `dispatch(request, expectedBinding, authorize, signal)` reusa `DispatchRequest`
  e `dispatchDigest`; exige autorização específica **da simulação** antes do claim.
- `recover(request)` consulta o registro sem enviar mensagens.
- `close()` encerra a conexão simulada e cancela sua atividade.

`RuntimeBinding` separa protocolo, geração local, endereço da sessão e modelo
pedido. O nome da sessão normalizado é `thread.id` no Codex e `sessionId` no ACP;
não identifica uma requisição de inferência upstream. `modelRequested` nunca é
copiado para uma afirmação de modelo verificado. ACP não seleciona modelo neste
protótipo. Configurações declaradas são ignoradas como prova.

O recibo possui namespace `simulated-runtime-receipt`, digest da autorização,
digest do pedido, binding e, quando correlacionado, turno/digest da saída.
`deliveryVerified`, `authorshipAuthenticated` e `operationallyEligible` são sempre
false. A saída textual não é retida no recibo. Seu digest cobre o array de chunks
simulados; não é hash dos arquivos de resultado nem assinatura.

A interface deliberadamente **não implementa DispatchExecutor**: o retorno atual
desse executor é texto, e seu recibo não suporta autenticação por runtime. Não há
registro em CLI/router nem provider que retorne SessionAttestation verified.
Para integração futura, manter o envelope/digest original e anexar evidência em
registro separado, versionado e vinculado ao claim existente. Nunca reinterpretar
recibos antigos. Os validadores v2 de resultado/artefatos continuam necessários.

O SessionBinding atual exige terminalId. Um runtime direto pode não ter terminal;
não preencher esse campo com threadId ou nome fictício. Uma evolução versionada
com variantes Maestri/runtime deverá preservar leitura e verificação dos formatos
antigos. Até ela ser implementada e aprovada, a compatibilidade é de contratos de
pedido, autorização e consistência, não substituição operacional imediata.

## Protótipo isolado e recuperação

A única implementação usa `ReplayTransport`, roteiro de dados copiados em memória.
Não aceita endpoint, executável ou callback de transporte. Frames vêm de fixtures,
nunca de captura de sessão real. O subconjunto é propositalmente estrito; eventos
não suportados, pedidos do servidor, erros, respostas ambíguas, troca de sessão,
modelo/configuração e conclusões incompletas deixam o outcome unknown.

`SimulationJournal` faz claim exclusivo antes do prompt simulado, fixa os digests
e impede reenvio em concorrência, timeout ou cancelamento. Um adapter recriado pode
ler o mesmo journal; nova conexão não pode continuar o envio com o binding antigo.
**O journal não sobrevive à morte do processo.** Ele demonstra semântica de
recuperação em memória, não durabilidade real. Não importa snapshots como prova.
Timeout de autorização ocorre antes de claim; timeout após claim continua ambíguo.

Nenhum pedido de permissão é aprovado; o subconjunto interrompe a simulação quando
recebe um pedido do servidor. Não implementa respostas live de negação, replay de
histórico, reconexão ou retomada de sessão real. `close`/AbortSignal simulam parada
local, não provam cancelamento upstream. Esses limites precisam ser implementados
explicitamente no piloto futuro, sem retry automático de prompts.

## Comparação com Maestri Wire

Wire autentica o host e endereça terminal por ID, mas o contrato de prompt não
fornece pré-condição de sessão do provedor. Conversa Maestri não atesta modelo ou
origem da inferência. [Contrato Wire](https://www.themaestri.app/en/docs/wire#terminals).

| Aspecto | Direto, proposta | Maestri Wire |
| --- | --- | --- |
| Destino | Sessão/thread do runtime e turno correlacionado | Terminal/conversa da interface |
| Controle | Coordenador gerencia processo, canal, configuração e falhas | Aproveita sessões e canvas do operador |
| Custo de implementação | Maior: schemas por versão, auth, sandbox, permissões, histórico | Menor integração visual; insuficiente para a política atual |
| Troca de sessão | Canal exclusivo e geração local permitem detectar mudanças | Leitura separada não elimina corrida no envio |
| Modelo/capacidade | Mais telemetria potencial; ainda exige evidência e política | Sem atestação completa no contrato consultado |
| Recuperação | Exige claims duráveis e reconciliação por turno | Recibos atuais preservam outcome ambíguo sem autenticação |

Minha recomendação é manter Maestri como interface do operador e experimentar o
runtime direto em ambiente separado. Isso aumenta controle e responsabilidade do
coordenador; não autoriza migrar automaticamente as sessões abertas no canvas.

## Próxima etapa para demonstrar uma sessão real autenticada

Será necessária uma autorização futura específica para um piloto novo, separado
do job `ad3b6e8aaeb3e22001ab`, com escopo, dados sintéticos, custo e ferramentas
limitados. Antes da única inferência de teste:

1. Fixar versão e origem do Codex, verificar integridade do executável e gerar/
   revisar os schemas correspondentes; definir explicitamente a fronteira de
   confiança local e quais evidências upstream a política exige.
2. Implementar stdio dedicado com geração de processo/canal, isolamento de SO,
   sandbox e configurações auditadas. Impedir compartilhamento de sessões e
   mudanças externas. Não ler ou registrar segredos como evidência.
3. Verificar login pelo mecanismo oficial, criar uma sessão nova e validar a
   configuração efetiva. Capturar somente metadados mínimos vinculados ao canal.
4. Gravar claim durável e autorização por digest; enviar uma tarefa sintética
   somente se os requisitos prévios forem satisfeitos. Correlacionar resposta,
   turno, eventos de mudança de modelo e artefatos. Testar interrupção e
   reconciliação sem reenvio.
5. Distinguir proveniência local demonstrada de atestação upstream. Se perfil,
   capacidade ou modelo continuarem sem evidência aceita, registrar a limitação
   e manter PLAN bloqueado. Um teste bem-sucedido não altera a política sozinho.

Essa etapa não foi executada nem autorizada implicitamente por este protótipo.

## Validação desta alteração

- `node --import tsx --test tests/agent-runtime-adapter.test.ts`: 34 passaram.
- `npm test`: 520 testes, 518 passaram, zero falhas, 2 ignorados (integrações
  externas portal/AEM e browser, sem ativação nesta execução).
- `npm run check`: passou.
- `git diff --check`: passou; os três arquivos novos também foram verificados
  com `git diff --no-index --check`, sem mensagens de whitespace.
- Comparação SHA-256: 483 arquivos preexistentes inspecionados preservados,
  incluindo os 14 arquivos do job real. O protótipo não escreveu evidências.

Os testes cobrem endereçamento e correlação, mensagens não autenticadas,
autorização ausente/divergente, mudança de pedido/sessão/conexão/modelo,
concorrência, resposta duplicada, sessão/turno divergente, evento tardio,
conclusão incompleta, pedidos de permissão, timeout, cancelamento,
recuperação idempotente e recusa de reenvio após recriação do adapter.
A recuperação de processo realmente encerrado e a validação do isolamento de um
runtime real permanecem fora do que esses testes demonstram.

Arquivos adicionados, sem editar arquivos existentes:

- `src/runtime-prototype/agent-runtime-adapter.ts`
- `tests/agent-runtime-adapter.test.ts`
- `docs/agent-runtime-adapter-feasibility.md`
