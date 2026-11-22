# Plano incremental de entrega — 17/11/2026

## Auditoria inicial

Inventário: 204 módulos TypeScript, 120 arquivos de teste e 71 documentos antes
desta rodada. Há 73 entradas/módulos na raiz src e três gerações de coordenação:
core/workflow (transições), pipelines sintéticos e autopilot/central-controller
(despacho durável). O último já oferece UUID de tarefa, contratos de resultado v2,
SHA-256, envio único, reconciliação e revisão humana. Será o caminho operacional.
As gerações anteriores ficam preservadas como bibliotecas e compatibilidade.

Estado preservado: cópia das fontes, testes, configuração, scripts e documentação
em .local-maestro/maintenance-backups (ignorado). Nenhum checkpoint histórico foi
editado. O inventário de estados encontrou jobs pausados, falhos e em revisão;
isso não prova execução real nem autoriza retomá-los.

Lacunas comprovadas: router exige available, descoberta textual retorna unknown;
38 testes existentes falham porque usam rodapés falsos como disponibilidade.
Baseline: 330 pass, 38 fail, 1 skip sob Node 18 do shell (projeto fixa Node 22).
A execução final usará Node 22.23.2 instalado. README e docs/architecture.md
continuam descrevendo um protótipo anterior aos adaptadores atuais.

Contratos: CLI Maestri list/check/ask documentados na skill instalada; ACK não
prova conclusão. Wire foi auditado nesta sessão: não fornece modelo/esforço nem
entitlement por sessão. Sem repetir investigação. Catálogos de provedores não
comprovam execução. Não haverá novo protocolo ou acesso interno não documentado.

AEM/Next: existem contracts de mapper/exporter, resourceType/model.json,
create-only, validação de build e piloto React isolado. São integrações condicionais,
não aceite corporativo. Piloto com falha deliberada é experimental e não deve ser
a entrada padrão. Nenhum portal ou job histórico será usado nesta aceitação.

## Tarefas e aceite

1. [x] Auditoria e preservação; registrar falhas anteriores e fontes oficiais.
2. [x] Política A/B/C: declaração distinta de observação, prova operacional,
   conectividade fresca, bloqueio de alto risco e orçamento desconhecido.
3. [x] Fluxo isolado: desafio de capacidade, tarefa real, artefatos/hashes,
   checkpoints, pausa/retomada e envio no máximo uma vez.
4. [x] Regressões: corrigir fixtures que confundem rodapé com disponibilidade;
   testar indisponibilidade, ACK, timeout, corrupção, retomada e idempotência.
5. [x] Build TypeScript, suíte completa portátil e integração isolada;
   tentar somente o fluxo novo autorizado, registrar bloqueio externo se houver.
6. [x] Documentação operacional, arquitetura, manutenção, recuperação e roadmap.

Aceite real exige artefato de agente via CLI autorizada; fixtures são simulação.
Sem acesso externo, entregar código/testes e procedimento reproduzível, registrando
explicitamente o aceite real como bloqueado, não concluído.

## Resultado da rodada

Os itens marcados referem-se a implementação e verificações locais, não a aceite
externo. Política A/B/C entregue; A tem apenas o ponto de composição confiável
porque nenhum contrato oficial suficiente foi encontrado. B/C executam o escopo
sintético mediante declaração, list/check, confirmação e exercício de capacidade.

Entrada nova: maestro:operate task/pipeline/next/resume/status/review. Reutiliza
controlador e contratos anteriores. O piloto Next normal não injeta defeitos;
a variante experimental anterior foi preservada. Revisão local é hash-bound.
Retomada de checkpoint completo valida evidências sem depender da rede.

Qualidade final em Node 22.23.2: 385 testes, 383 aprovados, zero falhas, duas
integrações externas não executadas (portal autorizado e browser externo).
TypeScript, build e git diff --check passaram. Testes novos cobrem políticas,
capacidade, ACK, timeout, late result, concorrência/locks, alteração de bytes,
retomada offline, identidade ambígua, revisão, pipeline seis etapas e Next sem deps.
A execução compilada de status também foi exercitada.

Aceite real: job 4f07b36eae3079cd0131, em .local-maestro/operations, bloqueado em
list com exit 1 e permissionDenied=true, antes de qualquer ask. Registro
sanitizado em environment-diagnostic.json. Nenhum fluxo de especialista real
foi aceito nesta rodada. Procedimento curto de retomada em OPERATIONS.md.

Sem reinícios, migrações reais, escrita AEM, push, PR, merge ou publicação.
Checkpoints históricos não foram alterados. As falhas do baseline foram
corrigidas nos testes que presumiam disponibilidade textual, não escondidas por
um bypass produtivo. Fixtures são declaradas como simulação.
