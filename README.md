# Migration Maestro

> Projeto genérico de orquestração de migração de páginas para React/Next.js + AEM. Não contém dependências de um cliente específico.

**[Visão geral, fluxograma, integrações e canvas fictício do Maestri.app](docs/README.md)**


Orquestração local de Analytics, UE-Pattern e Hermes pelo Maestri. O coordenador
possui despacho durável, validação de artefatos, checkpoints e revisão humana.
React/Next.js continua sendo o renderizador alvo; AEM continua sendo fonte de conteúdo.

**Estado da entrega:** código e testes locais operacionais; aceite com agentes reais
bloqueado pelo IPC deste ambiente. O teste real de 17/11/2026 registrou
`MAESTRI_COMMAND_FAILED`, sem despacho. Não é uma plataforma de migração produtiva
já homologada. Testes simulados não substituem esse aceite.

## Instalação

```sh
nvm use                    # .nvmrc: 22.23.2
npm ci
npm run check
npm test
npm run build
```

São necessários Node 22, Maestri instalado e os agentes conectados ao terminal
que executa a CLI. `MAESTRI_CLI` pode indicar o executável oficial existente.
Não configure sockets internos nem copie credenciais. O runtime principal não
precisa de serviço web, banco de dados ou API key neste repositório.

## Primeira tarefa isolada

Revise `config/operational-agents.json`: os modelos são **declarações**, não descoberta
nem garantia de disponibilidade. No shell autorizado do Maestri:

```sh
npm run maestro:operate -- task new --confirm-synthetic
npm run maestro:operate -- status
npm run maestro:operate -- resume <job-id> --confirm-synthetic
```

A confirmação permite enviar um desafio de capacidade e a tarefa sintética,
restritos ao novo diretório local. Não permite migração corporativa, reinício,
publicação ou alteração de AEM. Um ACK não conclui nada: o agente precisa escrever
artefatos válidos. Reutilize o mesmo ID após timeout; não crie outro para contornar
uma entrega ambígua.

O pipeline completo de teste de orquestração gera HTML sintético, sem dependências:

```sh
npm run maestro:operate -- pipeline new --confirm-synthetic --pause-after-plan
npm run maestro:operate -- resume <job-id> --confirm-synthetic
```

Esse HTML é um teste do coordenador, não substitui Next.js na arquitetura.
Para o piloto React/Next.js use `next new --confirm-synthetic --pause-after-plan`;
instale as dependências apenas no `project/` isolado gerado antes de retomar.
Veja [OPERATIONS.md](OPERATIONS.md) para os passos e limites.

## Revisão e manutenção

```sh
npm run maestro:operate -- review <job-id> --approve-local --reviewer=<operador>
```

O aceite local é vinculado ao hash do checkpoint; não faz push, merge ou publicação.
Uma execução simulada continua simulada após revisão.

- [Arquitetura final e compatibilidade](ARCHITECTURE.md)
- [Operação, configuração, agentes e checkpoints](OPERATIONS.md)
- [Manutenção, testes e atualização de integrações](MAINTENANCE.md)
- [Diagnóstico e recuperação](TROUBLESHOOTING.md)
- [Melhorias posteriores](ROADMAP.md)
- [Auditoria e plano de entrega](docs/operational-delivery-plan.md)

Estado e evidências ficam em `.local-maestro/` (ignorado pelo Git). Não inclua
transcripts, dados corporativos ou credenciais em commits. Os comandos históricos
`maestro:migrate`, `autopilot:central` e pilotos existentes foram preservados;
continuam sujeitos às próprias autorizações e limitações documentadas.
