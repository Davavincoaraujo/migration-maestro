# Diagnóstico e recuperação

| Código/estado | Significado | Ação segura |
| --- | --- | --- |
| MAESTRI_COMMAND_FAILED / MAESTRI_UNAVAILABLE | CLI/IPC inacessível | Verificar list/check no shell original; retomar mesmo ID. Não trocar sockets/credenciais nem ampliar permissões. |
| DECLARED_AGENT_NOT_CONNECTED | Nome configurado ausente | Corrigir conexão no host ou configuração de um novo job após reconciliação. Não recrutar/reiniciar automaticamente. |
| AMBIGUOUS_AGENT_NAME | Mais de um alvo com o mesmo nome | Resolver nomes no host antes de despacho; identidade não é inferida. |
| CAPABILITY_PENDING_NO_RESEND | Desafio enviado sem artefato após o teto | Conferir agente e esperar resultado tardio; retomar mesmo ID. ACK não libera tarefa. |
| CAPABILITY_VALIDATION_FAILED | Exercício não comprovou capacidade | Revisar artefato e declaração. Não editar o resultado para simular sucesso. |
| CAPABILITY_PROOF_REQUIRED | Prova ausente, incompatível ou expirada | Reconciliar job; novo job/prova somente após confirmar que não há tarefa antiga pendente. |
| POLL_BUDGET_EXHAUSTED_NO_RESEND | Tarefa possivelmente entregue, resultado ainda ausente | Check-only e resultado tardio. Não apagar tentativa nem reenviar. |
| *_CHANGED / *_MISMATCH | Evidência alterada ou vínculo inválido | Parar e comparar hashes/recibos com backup; não recalcular hashes para aceitar alteração silenciosa. |
| OPERATION_INPUT_CHANGED | Tentativa de modificar política/escopo de job | Usar a configuração persistida via resume; mudança deliberada exige job novo reconciliado. |
| ISOLATED_DEPENDENCIES_MISSING | Next sem dependências no project isolado | Instalar no diretório gerado, após revisão; retomar mesmo ID. |
| HUMAN_APPROVAL_AND_VERIFIABLE_EVIDENCE_REQUIRED | Risco alto/crítico | Revisão humana específica; o fluxo sintético não oferece bypass. |
| *_LOCKED_* | Operação em andamento ou crash deixou lock | Seguir procedimento abaixo. |

## Locks após crash

Não existe lease distribuída nem detecção confiável de processo remoto. Primeiro
confirme no host que o coordenador anterior terminou e confira se há agente ainda
executando a tarefa. Preserve operation.json, checkpoints, requests, attempts e
resultados. Registre o motivo e a evidência da interrupção em arquivo de recuperação
local datado. **Somente o operador**, após essa reconciliação, pode arquivar/renomear
o lock órfão para um nome datado e retomar o mesmo ID. Não apague o recibo de tentativa.
Não mova o lock se o processo ainda puder estar ativo. Se o estado é ambíguo, mantenha
bloqueado: repetir um ask não é recuperação segura.

Se o crash ocorreu entre intenção e solicitação completa, o job exige inspeção
manual; não há reparo automático que presuma ausência de entrega. Arquive o job
intacto e só autorize outro depois de confirmar o que aconteceu no agente.

## Estados e evidências

`pending` não é sucesso; pode ser pausa ou espera de resultado tardio. `failed`
significa contrato/bytes inválidos. `blocked` significa pré-requisito/política.
`awaiting-approval` contém etapas validadas, ainda não aceitas pelo operador.
`completed` é aceite local, nunca publicação. Consulte operation-status.json e
os eventos da etapa; erros não convertidos em código seguro ficam genéricos na CLI.
Logs do host só devem ser inspecionados localmente, sem colar histórico/credenciais.

A prova operacional não acompanha trocas invisíveis de sessão. Se houver troca,
pare, reconcilie e faça novo job/probe. Até existir fonte oficial de identidade,
identityVerified e availabilityVerified permanecem false.

## Aceite real pendente desta entrega

Job 4f07b36eae3079cd0131 superou o bloqueio inicial e está awaiting-approval,
executionMode=real e realAcceptanceVerified=true. Em 18/11/2026, a auditoria
revalidou os resultados e retomou o mesmo ID com transporte bloqueado: zero
chamadas e todos os arquivos preservados byte a byte. O aceite humano continua
pendente; o pipeline completo real não é comprovado por esse job mínimo.
Consulte docs/operational-acceptance.md.
