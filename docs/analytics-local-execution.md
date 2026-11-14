# Analytics → executor local → dashboard (PR #51)

Esta etapa conecta o pacote de requisitos estruturados do Migration Analytics ao executor **sintético** já existente no Migration Maestro.

## Execução local

```bash
git pull origin main
npm run check
npm test
npm run analytics:execute -- examples/analytics-specification.json .local-maestro/agent-demo
npm run dashboard -- .local-maestro/agent-demo 4177 examples/workbench-jobs.json
```

Abra `http://127.0.0.1:4177/analytics/execution` ou use o link na página `/agents`.

A CLI valida a especificação, ordena os requisitos pelas dependências, executa os cinco handlers sintéticos por requisito com checkpoints persistentes e salva `analytics-execution.json` com **metadados somente**. A tela apresenta requisito, status, agentes concluídos e checkpoint reutilizado. Não expõe outputs ou inputs de checkpoints.

O identificador dos checkpoints inclui o digest SHA-256 da especificação, impedindo reuso silencioso de resultados quando os requisitos mudam. Rodar novamente a mesma especificação permite reaproveitar checkpoints locais.

## Limites e controles

- Não é um executor LLM/MCP real. Os handlers são simulações determinísticas.
- Não cria código, commits ou PRs; não publica nem escreve no AEM.
- **Revisão humana continua obrigatória**, mesmo após todos os handlers terminarem.
- A página do dashboard é somente leitura e vinculada ao servidor local.
- Para visualizar o relatório, execute a CLI com o mesmo diretório usado no comando `dashboard`.
- Os diagramas Mermaid e requisitos continuam sendo gerados por `npm run analytics`, separadamente.

Próximo passo: aprovação humana versionada por digest, vínculo de requisitos com PRs e execução real via conectores autorizados.
