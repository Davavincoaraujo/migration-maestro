# Migration Analytics nativo — especificações como código

O módulo `src/analytics/specification.ts` estabelece o contrato inicial para substituir documentos Word como **fonte principal** dos requisitos de migração. A especificação JSON versionada é a fonte de verdade; os diagramas são projeções editáveis geradas a partir dela, não imagens que a IA precisa interpretar.

## Gerar artefatos

```bash
npm run analytics -- examples/analytics-specification.json .local-maestro/analytics-demo
```

Arquivos criados:
- `requirements.json`: entidades, atributos, operações, relacionamentos, requisitos, critérios de aceite e dependências.
- `traceability.json`: IDs de requisitos ligados a entidades, dependências e critérios.
- `classes.mmd`: diagrama UML de classes com multiplicidades e composição/associação/herança declaradas.
- `sequence.mmd`: sequência **genérica de entrega e revisão** de cada requisito (não representa fluxos transacionais de negócio).
- `activity.mmd`: grafo de dependências entre requisitos e revisão humana.
- `components.mmd`: visão de integração Analytics → especificação → Maestro → revisão.

Os arquivos `.mmd` são Mermaid em texto, versionáveis e renderizáveis em visualizadores compatíveis. A especificação pode ser consumida diretamente por agentes de IA, sem OCR ou leitura de Word.

## Escopo e segurança

Esta primeira entrega é **local e sintética**. O Analytics ainda não realiza entrevistas, extração automática de requisitos de documentos, execução de MCP remoto, geração de código, integração com AEM ou publicação. A CLI recebe um JSON fornecido pelo operador e o valida antes de gerar os artefatos. Os diagramas de sequência são representações genéricas do processo, não sequências inferidas das regras de negócio.

O modelo rejeita IDs duplicados, referências desconhecidas, dependências cíclicas e campos inválidos. Não há aprovação automática. O próximo passo é conectar a especificação validada aos jobs do Maestro e adicionar um editor/visualizador no dashboard, preservando revisão humana e checkpoints.

`npm run check && npm test` valida tipos e testes.
