# Continuação sintética autorizada (v1)

A recuperação é evidência local, não aprovação, entrega ou autoria autenticada.
`maestro:operate resume` exige agora uma autorização separada e válida. `--confirm-synthetic`
sozinho não concede essa autorização. Este mecanismo aceita somente o caso estreito:
pipeline planOnly, checkpoint histórico failed sem etapas concluídas, um único probe
Analytics local válido, sem proof persistido, e despacho original unknown.
Outros tipos de retomada não são aceitos por esse comando.

## Inspeção sem escrita ou transporte

```sh
npm run maestro:operate -- inspect-continuation ad3b6e8aaeb3e22001ab
npm run maestro:operate -- reconcile ad3b6e8aaeb3e22001ab --dry-run
```

A primeira inspeção reconstrói o contrato da recuperação, exige a lista completa de
hashes SHA-256 dos arquivos originais e valida política, identidade do job/probe/tarefa,
nonce, resultado e proveniência. Mostra o SHA-256 dos bytes da recuperação e a validade
da autorização, se existir. Inspecionar não cria aprovação nem consulta agentes.

## Autorização explícita, somente quando o operador decidir

Exemplo documental; substitua os placeholders. Este comando NÃO executa tarefas:

```sh
npm run maestro:operate -- authorize-continuation ad3b6e8aaeb3e22001ab \
  --approve-continuation --reuse-local-probe \
  --operator='<operador>' \
  --recovery-digest='<SHA-256 exibido pela inspeção>' \
  --expires-at='<data ISO futura, no máximo 24 horas>' \
  --dispatch-stages=ANALYZE,MAP_COMPONENTS,PLAN \
  --capability-probes=UE-Pattern
```

Os escopos são independentes:

- `--reuse-local-probe`: permite apenas reutilizar o probe Analytics validado, sem reenviar CAPABILITY.
- `--dispatch-stages`: `none` ou prefixo ordenado de `ANALYZE,MAP_COMPONENTS,PLAN`.
- `--capability-probes`: `none` ou agentes explicitamente permitidos (`UE-Pattern`, `Hermes`).
  O fluxo atual precisa de probe UE-Pattern para mapping. PLAN usa a sessão verificada,
  não depende de novo probe Hermes. Autorizar estágios não autoriza probes implicitamente.
- IMPLEMENT, VALIDATE, publicação e escrita no AEM não fazem parte da continuação.

Contrato persistido em `.local-maestro/operations/continuation-authorizations/<id>.json`:

```json
{
  "version": 1,
  "kind": "synthetic-continuation-authorization",
  "jobId": "<id>",
  "recoveryDigest": "<sha256 dos bytes da recuperação>",
  "policyDigest": "<digest da política original>",
  "operator": "<operador>",
  "issuedAt": "<ISO>",
  "expiresAt": "<ISO>",
  "scope": "isolated-synthetic",
  "reuseLocalAnalyticsProbe": true,
  "dispatchStages": ["ANALYZE", "MAP_COMPONENTS", "PLAN"],
  "capabilityProbeAgents": ["UE-Pattern"],
  "planOnly": true,
  "implementAuthorized": false,
  "resendAuthorized": false,
  "deliveryAuthenticated": false,
  "authorshipAuthenticated": false
}
```

A publicação é exclusiva, atômica, com fsync. Repetir exatamente a mesma autorização
válida é idempotente; mudar escopo/operador/digest/prazo não substitui o registro.
Não há renovação, ampliação ou revogação gerenciada na v1. Autorização expirada bloqueia.
Não editar ou apagar registros para contornar esses limites: uma evolução do contrato
será necessária para novas decisões do operador.

## Comportamento da execução futura

O comando de retomada existente permanece `maestro:operate -- resume <id> --confirm-synthetic`.
Não deve ser usado antes de revisar a autorização e as limitações abaixo.

O gate roda antes de criar estado da continuação e novamente sob os locks globais
`operation.lock` e `controller.lock`. Sem autorização válida não chama transporte nem
modifica status, checkpoint, proof ou eventos. Os locks transitórios só são adquiridos
depois da primeira validação. Locks de execução interrompida exigem inspeção manual.

O diretório original permanece intacto, inclusive status blocked, checkpoint failed,
recuperação, recibo unknown e ausência de proof. Estado novo vive em
`.local-maestro/operations/continuations/<id>/`, ligado aos digests da autorização e da
recuperação por `continuation.json`. O status histórico não representa o progresso da
continuação; o novo checkpoint e status ficam nesse diretório separado.

O Analytics pode executar ANALYZE após a reutilização local explicitamente autorizada;
a recuperação nunca conclui ANALYZE. O gate limita os estágios, mantém pauseAfter PLAN
e barra IMPLEMENT inclusive nas entradas diretas protegidas. Recibos e claims existentes
não são substituídos; a criação exclusiva do claim impede duplicação por concorrência.
Qualquer novo despacho unknown ou claim sem recibo bloqueia nova retomada, mesmo com
resultado tardio: a autorização do probe original não vale para essa nova ambiguidade.

Os eventos ficam em `continuation-events/000001.json`, etc., publicados sem substituição,
com sequência, digest do evento anterior e vínculo à autorização. Os eventos históricos
não são anexados nem reescritos. Temporários interrompidos bloqueiam para inspeção.

## PLAN e limitações de confiança

PLAN exige Hermes com capacidade planning, perfil ADVANCED, disponibilidade available,
modelo/provider iguais aos declarados na política e atestação recente de modelo,
identidade e disponibilidade. Os sinais de PLAN permanecem ADVANCED; uma tarefa sintética
não reduz o requisito para ECONOMY. A sessão é revalidada antes do estágio e do envio,
inclusive quando já existe uma tarefa PLAN persistida.

O ponto de composição `sessionAttestationProvider` só aceita um adaptador confiável da aplicação;
não lê atestação de JSON, configuração ou texto de terminal. **Nenhum adaptador oficial
está instalado no CLI atual.** Portanto PLAN permanece bloqueado no uso real, mesmo com
autorização. Os testes usam somente um provider em memória, explicitamente simulado.
O contrato e as verificações estão descritos em [session-attestation.md](session-attestation.md).
A configuração de um modelo ou o rodapé do terminal não satisfazem esse requisito.

Os hashes detectam divergência local, mas não autenticam o operador, o agente ou a entrega.
A autorização é uma decisão local explícita, não uma assinatura criptográfica. Arquivos,
locks e callbacks pressupõem o coordenador e o filesystem local confiáveis. Um processo
com permissão para reescrever todas as âncoras ou executar código arbitrário está fora
dessa fronteira; locks não são uma transação contra escritores externos. A cadeia local
de eventos também não é uma âncora externa contra remoção de seu último sufixo.

Publicação de autorizações/eventos usa hard links e fsync de diretórios; isso exige um
filesystem local compatível. Checkpoints reutilizam o armazenamento atômico existente.
Não há garantia distribuída de exactly-once: o claim fornece at-most-once local, e uma
falha após o envio continua ambígua. Uma nova recuperação/renovação deliberada ainda
precisa de contrato próprio; a v1 falha fechada nessas situações.
