# Dashboard local de agentes

A rota `GET /agents` apresenta o grafo de seis papéis e seus estados. `POST /agents/run` inicia uma simulação isolada dos cinco agentes executáveis para um job ID presente no arquivo de fixtures configurado no servidor. A sexta etapa, `review`, permanece exclusivamente humana.

`GET /agents/status` retorna `{status,jobId,agents}` para observação. Os checkpoints de agentes ficam em `agent-checkpoints/`, separados dos checkpoints do pipeline de migração. A página usa refresh de três segundos, sem JavaScript externo. O formulário mantém CSRF e verificação de origem do dashboard existente.

A execução de agentes **não altera** `report.json`, não produz aprovação, não chama modelos e não publica conteúdo. O botão `Executar lote sintético` continua usando o pipeline existente, sem regressão intencional.

## Uso

```bash
npm run check
npm test
npm run workbench -- examples/workbench-jobs.json .local-maestro/agent-demo
npm run dashboard -- .local-maestro/agent-demo 4177 examples/workbench-jobs.json
```

Abra `http://127.0.0.1:4177/agents`, mantenha o ID `demo` e clique em **Executar agentes locais**. Observe os estados na página ou em `/agents/status`. Reexecutar o mesmo job reutiliza checkpoints.

O grafo ainda usa handlers determinísticos sintéticos; integração com agentes LLM e servidores MCP reais continua fora do escopo desta PR.
