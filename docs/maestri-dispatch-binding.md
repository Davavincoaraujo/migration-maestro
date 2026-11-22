# Vínculo de transporte Maestri — 19/11/2026

Decisão: não habilitar transporte operacional Wire. PLAN permanece bloqueado por
`MAESTRI_SESSION_BOUND_DISPATCH_UNSUPPORTED` mesmo quando uma atestação de sessão
injetada satisfaz os demais requisitos. A autorização humana continua independente.

## Contrato oficial consultado

Fonte: [Maestri Wire](https://www.themaestri.app/en/docs/wire#terminals),
consultada em 19/11/2026, seções Transport, Terminals e Terminal chat.

O protocolo documenta HTTPS/WSS, pareamento bearer e pin SHA-256 da chave pública
do host. Isso autentica o host, não o modelo do provedor. O envio
`POST /api/terminals/{id}/prompt` endereça o terminal e aceita texto ou segmentos.
Não documenta pré-condição de sessão/geração do provedor ou modelo esperado.

`TerminalCard.id` identifica terminal; `nodeId` identifica nó do canvas.
`ChatSnapshot.terminalId` e `conversationId` identificam terminal e conversa Maestri.
Trocar thread muda a conversa; prompts usam a thread selecionada. Não há equivalência
documentada entre conversa e sessão do provedor, nem atestação de modelo ativo.
`ChatEntry` contém papel, texto e campos opcionais de autor/tipo de agente; isso não
fornece vínculo autenticado entre resultado, sessão do provedor e despacho.

Logo, leituras antes/depois do envio não eliminam a corrida de troca de sessão.
Nenhuma garantia ausente foi presumida; não se afirma inexistência de outras APIs.

## Alteração local

A investigação parte do diagnóstico `diagnose-maestri --observe-model` do job
`ad3b6e8aaeb3e22001ab`. Não havia uma captura desse stdout nos registros consultados;
nenhum resultado ao vivo foi inventado. O diagnóstico existente já distingue nomes,
rótulos observados e atestação, e identifica envio por nome sem vínculo de sessão.
O job possui recuperação separada e status histórico blocked; ambos foram preservados.

O executor CLI mantém `ask [agentId, prompt]`. Seu `identity` descreve o executor;
`MAESTRI_TERMINAL_ID` não identifica o destinatário. O contrato de retorno é texto.
Nenhum nome, declaração, resposta textual ou hash local autentica origem/destino.

Foi corrigida uma lacuna de integração: a continuação podia aceitar atestação
sintética e depois enviar PLAN pelo transporte sem vínculo. Agora o gate rejeita
esse caminho antes de criar intenção PLAN. O executor de requisições persistidas
também rejeita rotas com sessionAttestation antes de gravar a tentativa, inclusive
se o chamador fornecer terminalId/sessionId aparentemente correspondentes.

Não há novo campo de recibo, migração de checkpoint, alteração de digest ou
promoção de deliveryVerified. Claims exclusivos continuam impedindo reenvio;
recuperação continua validação local, sem autenticar entrega/autoria. A barreira
não oferece flag de bypass. Adaptadores futuros exigem revisão deste bloqueio e
contrato oficial verificável, incluindo envio condicionado à sessão e evidência
de origem correlacionada à requisição; apenas configurar IDs não basta.

Não houve dispatch real, avanço PLAN/IMPLEMENT, acesso ao AEM, conexão Wire,
pareamento ou alteração de recibos históricos. Testes usam somente fixtures locais.

## Validação local

- `npm run check`: passou.
- `npm test`: 486 testes; 484 passaram, zero falhas, 2 ignorados (integrações
  portal/AEM e browser). Não foram ativados testes externos.
- Casos cobertos: troca de sessão, terminal divergente, resposta ambígua, timeout,
  atestação insuficiente para envio, bloqueio antes do claim, retomada sem reenvio,
  recuperação idempotente e rejeição de recibo promovido para entrega autenticada.
- Os 14 arquivos do job mantiveram SHA-256 idênticos antes/depois da suíte.
- `git diff --check`: passou. O workspace já continha alterações prévias extensas;
  elas não foram revertidas.

Arquivos alterados nesta investigação:

- `src/integrations/maestri-wire-contract.ts`
- `src/autopilot/dispatch-executor.ts`
- `src/autopilot/operational-continuation.ts`
- `src/autopilot/operational-run.ts`
- `tests/maestri-dispatch-binding.test.ts` (novo)
- `tests/maestri-transport.test.ts`
- `tests/operational-continuation.test.ts`
- `tests/operational-run.test.ts`
- `tests/operational-reconcile.test.ts`
- `docs/session-attestation.md`
- `docs/maestri-dispatch-binding.md` (novo)
