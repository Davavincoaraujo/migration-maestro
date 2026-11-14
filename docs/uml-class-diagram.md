# UML de classes — PR #48

Acesse `/diagrams?kind=classes` no dashboard local. A nova aba **Classes UML** segue a referência visual de UML de classes: caixas com nome, atributos e operações em compartimentos separados, visibilidade `+`/`-`, associações e multiplicidades, e tipos destacados por estereótipo (`«interface»`, `«class»`, `«union type»`).

O modelo é uma representação **explícita e versionada** de contratos TypeScript reais, consultados em:
- `src/orchestration/agent-graph.ts`: `MigrationAgentNode`, `MigrationAgentPlan`, `MigrationAgentRole`.
- `src/orchestration/local-agent-executor.ts`: `AgentExecutionResult`.
- `src/autopilot/checkpoint-runner.ts`: `Checkpoint`, `CheckpointStore`, `MemoryCheckpointStore`.

Os métodos `get` e `put` e as propriedades dos contratos correspondem aos tipos existentes. Interfaces não recebem métodos fictícios. A associação `MigrationAgentPlan.nodes` é `0..*` por tipagem de array (o planejador valida pelo menos um nó em tempo de execução). `Checkpoint.completed` armazena IDs de etapas, não objetos `MigrationAgentNode`. Não foi inferida herança ou composição onde o código não as define.

**Limite atual:** o diagrama não é extraído automaticamente pelo compilador TypeScript; é um modelo manual rastreável ao código, para evitar falsas relações. Não há editor drag-and-drop nesta PR. A visualização é SVG local e sem dependências externas. Os outros diagramas continuam disponíveis.

Validação: `npm run check && npm test`. Sem dados corporativos, chamadas externas ou escrita AEM.
