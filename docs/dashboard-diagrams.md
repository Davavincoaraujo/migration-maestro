# Diagramas no dashboard local — PR #44

Acesse `http://127.0.0.1:4177/diagrams` após iniciar o dashboard local. A página contém três visualizações SVG geradas no servidor, sem JavaScript externo, CDN, React Flow ou conexão de rede:

- **Execução**: nós derivados do grafo de agentes validado e estados atuais do executor local; revisão humana permanece pendente.
- **Componentes UML (simplificado)**: visão ilustrativa dos módulos locais (dashboard, orquestrador, agentes, checkpoints, MCP read-only, revisão).
- **Sequência UML (simplificado)**: interação ilustrativa entre operador, dashboard, orquestrador, agentes, checkpoints e revisor.

A aba Execução reflete os estados em memória publicados por `/agents/status`; atualiza a cada cinco segundos. As duas visões UML são estáticas e ilustrativas, não introspecção automática de chamadas reais. Os diagramas são gerados em SVG sem dependências adicionais. **Ainda não são um editor visual com arrastar e soltar**; essa é uma possível etapa posterior, quando a execução real dos agentes e o modelo de eventos estiverem estabilizados.

Use `npm run check && npm test` e abra `/agents` para seguir o link **Ver diagramas UML e execução**.

A aplicação continua local, sem adaptadores GitHub/Azure, sem chamada a LLM, sem dados corporativos e sem publicação AEM.
