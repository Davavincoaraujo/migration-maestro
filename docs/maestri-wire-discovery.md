# Investigação Maestri Wire — 17/11/2026

Resultado: integração parcialmente viável para identidade do terminal/conversa do
Maestri; insuficiente para substituir a descoberta do modelo ativo do provedor.
Não há cliente de rede implementado nem associação real dos três agentes validada.

Contrato oficial consultado: https://www.themaestri.app/en/docs/wire

## Leitura documentada

- GET /api/info: protocolVersion, capabilities e role autenticada.
- GET /api/workspaces: workspaces.
- GET /api/workspaces/{ws}/feed?floor=…: FeedSnapshot, condicionado a feedSnapshots.
- GET /api/terminals/{id}/chat: ChatSnapshot, condicionado a terminalChat.
- WS /api/terminals/{id}/chat/stream: snapshots de substituição, sem despertar,
  redimensionar ou enviar entrada ao terminal.

O fluxo futuro deve usar pareamento existente guest, endereço conhecido e TLS
verificado, nunca descobrir credenciais ou sondar rotas. Assinatura do feed como
owner pode despertar terminais; não usar esse caminho nesta investigação.

TerminalCard fornece id, nodeId, name, agentType e indicadores de atividade.
O id do terminal difere de nodeId. Feed lista terminais do workspace, não comprova
sozinho quais estão conectados ao agente chamador. Um adaptador futuro precisa
validar o vínculo no canvas, incluindo workspace/floor, e rejeitar nomes ambíguos;
não basta transformar nomes obtidos da CLI em identidades Wire.

## ChatSnapshot

Obrigatórios documentados: terminalId, conversationId, enabled, status, entries,
unreadCount, canClear.
Opcionais: talkingToAgentName, answeringAgentName, threads, appearance,
turnInterrupted, showsShellWindow, hasOlderOnRecord.

status admite idle, working, needsAttention, notRunning, unloaded; enums futuros
precisam continuar desconhecidos. threads contém activeSlot, canSelect e items
com id/color/hasMessages. Trocar thread muda conversationId. Snapshots são
substituições, inclusive na reconexão; respostas HTTP antigas não devem sobrescrever
estado mais novo do socket. Leituras continuam disponíveis com processo parado.

Não há provider/modelId/effort/disponibilidade de inferência documentados nesse
snapshot. agentType existe em TerminalCard e opcionalmente ChatEntry; não é
atestação do modelo ativo. accountName é conta, não modelo. conversationId é do
registro de conversa Maestri; não há equivalência documentada com ID de sessão
do provedor. status/isRunning/isLive não provam entitlement ou disponibilidade.

## Decisão implementada no projeto

A descoberta CLI permanece diagnóstico. Agora explicita modelObserved (booleano:
o parser reconheceu modelo no rodapé), identityVerified=false e
availabilityVerified=false. modelId/provider existentes continuam observações;
sessionIdentityVerified=false é mantido para compatibilidade. availability=unknown.

maestri-wire-contract.ts contém somente uma projeção offline dos metadados
obrigatórios do envelope. Não valida ChatEntry, não retorna conteúdo da conversa,
não acessa rede, não lê credenciais e não autentica uma sessão. Aceita campos
extras sem promovê-los a evidências. terminalTargetMatches significa apenas
igualdade de IDs; identityVerified permanece false. Não está conectado ao router.

Os testes usam exemplos sintéticos dos formatos documentados, nunca capturas
reais: campos obrigatórios/opcionais, estados de atividade, mudança de conversa,
alvo divergente, campos inválidos e ausência de promoção por campos inventados.

## Bloqueios e validação

Não foi localizada configuração/cliente Wire nos contratos do projeto; nenhum
endereço, pareamento guest ou certificado foi fornecido para esta integração.
Não foi feita busca em armazenamentos privados de credenciais, pareamento, mudança
de permissões ou tentativa de contornar o bloqueio IPC anterior.
Mesmo com acesso autorizado, o contrato atual ainda não basta para modelo/esforço
e disponibilidade. É necessária uma fonte oficial adicional que vincule essas
evidências à sessão atual. Até lá, nenhum adaptador operacional deve ser ativado.

npm run check passou. Passaram 51 testes nos arquivos maestri-wire-contract,
model-footer-diagnostic, maestri-session-model, model-router-inspection,
maestri-transport, adaptive-model-router e model-router-history.
Não houve reinícios, Autopilot, alterações em checkpoints ou acesso ao portal AEM.
