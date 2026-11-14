# Interface de negócio e AEM Author local

## Interface

A página inicial do dashboard apresenta indicadores de páginas, aprovações pendentes, impedimentos e falhas. O menu reúne Visão geral, Etapas da migração, Indicadores, Fluxo visual e Conexão AEM. Os dados continuam sintéticos e as aprovações não publicam no AEM.

## Verificação do AEM local

O servidor deve ser iniciado **na mesma máquina** em que o AEM Author está executando. Configure a variável de ambiente abaixo no terminal local, sem salvar credenciais no Git:

```bash
export MAESTRO_AEM_AUTHOR_URL="http://localhost:4502/sites.html/content/portal-banco-bradesco"
npm run dashboard -- .local-maestro/agent-demo 4177 examples/workbench-jobs.json
```

Abra `http://127.0.0.1:4177/aem/status/view` ou consulte `/aem/status`.

Esta primeira integração apenas verifica se a instância AEM responde. Não autentica no AEM, não lista páginas, não transfere conteúdo e não faz chamadas de escrita. O endereço deve ser HTTP local (`localhost` ou `127.0.0.1`), porta 4502 e caminho `/sites.html/content/...`. A verificação usa um endpoint de login do Granite UI, com tempo limite de 2,5 segundos. A mensagem “acessível” não comprova autorização para ler o conteúdo.

**Próxima integração, ainda não implementada:** leitura autenticada de metadados de páginas, com credenciais mantidas apenas no ambiente local, permissões mínimas, confirmação da equipe responsável e sem persistência de dados corporativos no GitHub.
