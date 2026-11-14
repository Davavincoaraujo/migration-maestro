# Histórico persistente de agentes — PR #47

A execução local sintética agora registra eventos de ciclo de vida em `agent-history.json`, dentro da pasta de trabalho. O armazenamento usa gravação atômica e mantém até 1.000 eventos por arquivo. O registro é restrito a metadados: ID do job, nome do agente, tipo do evento, sequência, data e duração em milissegundos. Nenhum conteúdo de página, input/output de agente ou mensagem de exceção é armazenado.

Acesse `/agents/history/view?id=demo` para a tabela de eventos e `/agents/history?id=demo` para JSON filtrado. A página atualiza a cada cinco segundos. O arquivo sobrevive à reinicialização do servidor, mas o histórico é limitado e a implementação é projetada para um único processo local. As durações por agente representam intervalos entre eventos, não tempo de CPU isolado. Reexecuções com checkpoint reutilizado são registradas.

O checkpoint original continua armazenado separadamente em `agent-checkpoints/`, sem exposição dos seus outputs. Não há chamadas externas, aprovação automática nem escrita AEM.

Validar com `npm run check && npm test`.
