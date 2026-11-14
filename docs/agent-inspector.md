# Inspeção de agentes — PR #45

Abra `/diagrams` e escolha um dos seis agentes em **Inspecionar agente**, ou use `/agents/inspect?id=mapping`.

O painel mostra função, estado em memória, tipo de execução, job atual, dependências e sucessores. Os estados são atualizados a cada cinco segundos. Não são exibidos payloads de entrada, saídas brutas, conteúdo das páginas nem dados de checkpoints. A informação de checkpoint é apenas um indicador derivado do estado do agente, **não** uma consulta ao armazenamento persistido.

A navegação é somente leitura e restrita ao servidor local. Não altera o pipeline existente, não executa aprovação humana e não publica no AEM.

Para validar: `npm run check && npm test`. Próximo passo sugerido: eventos de agentes tipados e metadados persistidos de checkpoints, com filtros de privacidade, antes de disponibilizar inspeção detalhada.
