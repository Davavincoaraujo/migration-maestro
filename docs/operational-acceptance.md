# Homologação operacional — 18/11/2026

Atualização: o inventário foi aceito por Davi. O piloto até PLAN foi autorizado,
mas seu início está bloqueado pelo socket no sandbox. Estado atual, hashes e
comando com teto persistente em [authorized-plan-pilot.md](authorized-plan-pilot.md).
As decisões pendentes abaixo descrevem a rodada anterior ao aceite.

## Resultado e proveniência

Job `4f07b36eae3079cd0131`: execução real, ANALYZE e REVIEW concluídos,
`awaiting-approval`, `realAcceptanceVerified=true`. REVIEW é preparação de revisão,
não aprovação. Identidade e disponibilidade permanecem não verificadas; publicação
não autorizada, nenhuma escrita AEM realizada por esta homologação.

Evidência local: `local-output/operational-acceptance-22616c348d8c/audit.json`.
Contém SHA-256 de cada arquivo original, resultado da retomada e teste simulado.
`original-backup/` preserva o job antes do teste. Não compartilhe prompts/logs brutos.

- ANALYZE: taskId `84437074-3e80-4a4e-b17a-ae2e614526a4`; tarefa, rota declarada,
  request, tentativa e recibo reconciliados pelo verificador existente.
- Resultado SHA-256 `f0f60ec2d9ddceb763e57cf480fe1abd7cb6edbf9cc3a60a876d8923433d4057`.
- `inventory.json`: `0cc62f6989eeef0469273176541b6b5ae295628da93d98d33e65e1f880d8ec47`;
  contrato confirmado: dois componentes válidos, hero/text em ordem, broken inválido.
- `ANALYZE.evidence.json`: `8bfbf504352b546533f7d1b72b40c89234b3fb9449898dea7c9b8079ab730a5a`;
  conclusões consistentes com o input sintético, sem atestar runtime ou compatibilidade AEM.
- Probe Analytics: desafio, nonce, taskId, respostas, recibo e hash de capability
  revalidados pelo runner. REVIEW é saída determinística do coordenador.

Hashes comprovam consistência com o checkpoint local, não assinatura independente
nem autoria autenticada do provedor. `deliveryVerified=false` nos recibos não é
promovido a autenticação. `aemWritesPerformed=false` é o registro do coordenador,
não auditoria independente de todo o portal.

Retomada: executada no caminho original (parte do inputDigest), após backup, com
transporte que rejeita qualquer chamada. Zero chamadas; manifesto completo antes
e depois idêntico. Não houve aprovação, novo prompt ou alteração de checkpoint.

## Próxima tarefa pronta: hero sintético isolado

Usar o pipeline existente, sem alterar arquitetura/modelos. Escopo: um `index.html`
com heading “Explore the imaginary garden”, CTA “Discover the garden”, link
`#garden`, sem scripts, rede, dependências ou conteúdo corporativo.

| Etapa | Responsável | Contrato/checkpoint |
| --- | --- | --- |
| ANALYZE | Analytics | result v2, taskId/jobId, evidências e hashes |
| MAP_COMPONENTS | UE-Pattern | mapping v1 ligado ao digest de ANALYZE, lacunas explícitas |
| PLAN | Hermes | plan v1 ligado ao mapping, arquivos, critérios e testes; pausa |
| IMPLEMENT | Hermes | index.html isolado; validação determinística e digest |
| VALIDATE | Analytics | agente distinto de implementação, evidência validada |
| REVIEW | Coordenador/operador | awaiting-approval; aceite humano separado |

Ensaio local preservado em `local-output/operational-acceptance-22616c348d8c/simulation/9730de2e8f7b2153bca0`.
As seis etapas passaram, pausa PLAN funcionou, oito envios simulados (três probes,
cinco etapas), zero reenvios na retomada. `executionMode=simulated` e
`realAcceptanceVerified=false`. Isso não comprova execução real de UE-Pattern/Hermes.

Bloqueios concretos para manutenção corporativa: entrada operacional atual é fixture
fixa, não aceita uma solicitação arbitrária; integrações corporativas existentes
não estão homologadas por esse ciclo. É necessário definir tarefa/checkout, entradas,
critérios e autorização específica antes de usar essas integrações. Não ampliar
`isolated-synthetic` nem reaproveitar aceite sintético como autorização corporativa.

## Comandos reais

Na raiz do repositório, `nvm use` (Node 22; o shell desta auditoria iniciou em Node 18).

```sh
# Estado e evidências (somente leitura)
npm run maestro:operate -- status 4f07b36eae3079cd0131
cat local-output/operational-acceptance-22616c348d8c/audit.json
cat .local-maestro/operations/4f07b36eae3079cd0131/ANALYZE.evidence.json

# Auditoria reproduzível local: backup, retomada sem transporte, pipeline simulado
node --import tsx scripts/operational-acceptance.mjs

# SOMENTE após autorização para despachar o novo piloto aos agentes reais
npm run maestro:operate -- pipeline new --confirm-synthetic --pause-after-plan
# Anotar o ID retornado; não repetir new para acompanhar ou recuperar
npm run maestro:operate -- status <id>
npm run maestro:operate -- resume <id> --confirm-synthetic --pause-after-plan
# Depois de revisar PLAN e autorizar continuação local do piloto
npm run maestro:operate -- resume <id> --confirm-synthetic

# SOMENTE após aceite humano explícito; substituir pelo nome do revisor
npm run maestro:operate -- review 4f07b36eae3079cd0131 --approve-local --reviewer=NOME
```

Em falha/timeout, consultar status, recibos e eventos, retomar o MESMO ID. Nunca
apagar tentativa/lock para reenviar. Locks órfãos exigem reconciliação pelo operador
conforme TROUBLESHOOTING.md. Aprovação local não envia mensagens nem libera AEM,
merge, push ou publicação. O script de auditoria acima espera o job ainda pendente;
depois do aceite, use status e recibo review.json para consultar essa decisão.

## Decisões solicitadas (ainda não executadas)

Verificação local: Node 22.23.2; `npm run check` e `npm run build` passaram;
`npm test`: 383 passaram, 2 ignorados, zero falhas. `git diff --check` passou.
Nenhuma integração externa opt-in foi habilitada para esta homologação.

1. Aceitar localmente o inventário real do job existente, com as limitações acima;
   informar o nome a registrar em `review.json`. Isso muda apenas o aceite local.
2. Autorizar o despacho real do piloto hero isolado, inicialmente até PLAN.
   Esta é autorização separada; o ensaio local não a substitui.

Nenhuma dessas decisões autoriza alterações no portal AEM. Qualquer futura escrita
externa exige proposta concreta com alvo/diff, validação e autorização específica.
