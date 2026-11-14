# Analytics → Autopilot: contrato de transferência (PR #50)

O módulo nativo `src/analytics/autopilot-handoff.ts` transforma especificações JSON versionadas em **propostas de tarefas**, sem executar código, agentes ou integrações externas.

```bash
npm run analytics -- examples/analytics-specification.json .local-maestro/analytics-demo
```

Além de `requirements.json`, `traceability.json` e quatro diagramas Mermaid, a CLI agora exporta `autopilot-handoff.json`. Cada tarefa contém ID estável, ID do requisito original, descrição, entidades associadas, critérios de aceite, dependências e agentes sugeridos (`mapping`, `composition`, `quality`).

As tarefas são ordenadas topologicamente pelas dependências. Tarefas com pré-requisitos recebem status inicial `blocked`; tarefas sem pré-requisitos recebem `proposed`. **Esses estados não são um mecanismo de liberação**: o pacote inteiro permanece `awaiting-human-review`, `requiresHumanReview: true`, `allowExternalWrites: false` e `aemWritePerformed: false`.

O campo `specificationDigest` é um SHA-256 da representação JSON normalizada pela validação; serve para detectar alterações e vincular aprovações futuras a uma versão. Não é assinatura digital nem substitui autorização humana.

**Limites atuais:** ainda não há consumo automático pelo executor de agentes, integração MCP real, geração de código, PR automático, publicação AEM ou aprovação por interface. O handoff é um contrato seguro para essa integração posterior. A especificação estruturada é a fonte de verdade; Word é opcional.

Valide localmente com `npm run check && npm test`.
