# Adobe AEM Author — integração local de leitura

O Maestro agora pode consultar **metadados de páginas filhas diretas** de uma raiz configurada no AEM Author local. A consulta não transfere conteúdo ao GitHub, não persiste o JSON do AEM e não executa nenhuma alteração, aprovação ou publicação no AEM.

## Configuração local

Use um usuário de AEM com acesso **somente leitura**, autorizado pela equipe responsável. No terminal da mesma máquina onde roda o AEM:

```bash
export MAESTRO_AEM_AUTHOR_URL="http://localhost:4502/sites.html/content/example-site"
export MAESTRO_AEM_USER="SEU_USUARIO_DE_LEITURA"
read -s MAESTRO_AEM_PASSWORD
export MAESTRO_AEM_PASSWORD
```

O acesso é realizado pelo adaptador headless de leitura AEM e pelas ferramentas locais allowlisted. **Não coloque credenciais em commits, arquivos .env versionados ou mensagens de chat.** Use um usuário de serviço dedicado de leitura, se permitido.

## Limites atuais

- Apenas Author local em `localhost:4502` ou `127.0.0.1:4502`, via HTTP, no caminho `/sites.html/content/...`.
- Solicitação GET autenticada por Basic Auth a `/content/<raiz>.1.json`, sem redirecionamentos, com tempo limite de 4 segundos e resposta máxima de 500 KiB.
- Exibe no máximo 100 páginas filhas diretas: identificador, título e indicação de nó de conteúdo. Não busca componentes, páginas descendentes, conteúdo sensível, assets ou dados pessoais.
- Se o AEM bloquear Basic Auth, exigir SSO ou não expuser o endpoint JSON, o adaptador reporta indisponibilidade/autenticação. Não tenta contornar a configuração de segurança.
- O pipeline de migração continua sintético. Esta integração **não alimenta automaticamente os agentes** e não publica conteúdo.

## Próximas etapas possíveis

Após a equipe responsável validar o acesso e o formato de resposta do AEM local, evoluir para paginação, inventário de páginas, detecção de templates/componentes e mapeamento AEM → Next.js, mantendo revisão humana obrigatória e controles de acesso.
