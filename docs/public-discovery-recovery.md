# Recuperação da descoberta pública

> URLs abaixo são exemplos fictícios para documentação; não representam o allowlist de implementações legadas.

O fluxo `preparePublicMigrationJob` deriva o ID da URL e retorna o status existente,
mesmo quando bloqueado. Isso preserva idempotência, mas não oferece retry implícito.
O job 6c23a49df3f6b1798231 registrou `PUBLIC_SOURCE_DNS_UNAVAILABLE`.
No terminal Codex, DNS retornou ENOTFOUND e curl código 6; não houve TLS/HTTP.
O operador confirmou DNS e HTTP 200 (curl e Node fetch) no Mac fora do sandbox.
Portanto a falha observada é específica do ambiente de execução; ENOTFOUND não
identifica por si só a política que impediu a resolução. Não alterar DNS, proxy,
certificados ou permissões para contorná-la.

Execute no terminal original do Mac, na branch e workspace atuais:

```sh
cd /Users/macos/Developer/migration-maestro
nvm use 22.23.2
npm run maestro:discovery:recover -- 6c23a49df3f6b1798231 --authorize-retry --attempt-id mac-retry-001
```

O comando não foi executado pelo Codex. Repita o mesmo ID para consultar/reaplicar
o resultado sem nova captura. Para outra tentativa de rede, autorize novamente
com outro `--attempt-id`. Um registro `.started.json` sem resultado é uma tentativa
interrompida: use outro ID explícito; não remova o histórico. O lock por job impede
concorrência. Após encerramento abrupto do processo, confirme que não há processo
ativo antes de remover manualmente um lock órfão.

A captura usa o fetch nativo do Node com um dispatcher HTTPS direto que valida e
fixa o IPv4 resolvido e mantém verificação TLS do hostname. Não usa proxy, redirects,
cookies, scripts, assets ou links. Só aceita HTTP 200 text/html, sem compressão,
até 2 MB e 15 segundos. Categorias distintas: DNS, permissão EPERM/EACCES, timeout,
TLS, erro de rede e resposta HTTP (acesso negado, redirect, status, tipo/encoding).
Os códigos nativos disponíveis ficam no histórico; nenhuma classificação infere
bloqueio de sandbox apenas a partir de ENOTFOUND.

O manifesto permanece intacto. `discovery-history/original.json` preserva status,
checkpoint, plano e manifesto anteriores. Cada tentativa possui início e resultado
separados; o resultado possui hash de integridade e permite reaplicar uma atualização
interrompida sem acessar a rede. Não há exclusão de falhas anteriores.

Sucesso grava `source.html` em UTF-8, `evidence.json` com URL, data, origem e SHA-256
sobre o HTML UTF-8 persistido (não sobre bytes de rede na codificação original).
Os arquivos são locais com modo 0600. O resultado da tentativa também preserva HTML
para recuperação de gravações parciais. Hash detecta corrupção; não é assinatura.
O checkpoint adiciona descoberta e preparação do plano, sem completar ANALYZE.
Só remove `PUBLIC_SOURCE_DISCOVERY_REQUIRED` dos bloqueios das tarefas. Sessão,
capacidade, dispatch e autorização continuam obrigatórios; nenhuma tarefa é enviada.

Alternativa sem rede, para captura legítima do operador:

```sh
npm run maestro:discovery:recover -- 6c23a49df3f6b1798231 --snapshot /caminho/atendimento.snapshot.json --attempt-id snapshot-001
```

Formato JSON (substitua os valores pelo HTML real e seu hash):

```json
{
  "version": 1,
  "url": "https://example.com/legacy/support",
  "operator": "identificação do operador",
  "legitimatelyCaptured": true,
  "capturedAt": "2026-11-19T18:00:00.000Z",
  "sha256": "SHA-256 do campo html codificado em UTF-8",
  "html": "<html><body>HTML efetivamente capturado</body></html>"
}
```

A data deve ser ISO UTC e não futura. A origem deve coincidir exatamente com a URL
permitida. Hash, tamanho e estrutura HTML são validados antes de concluir descoberta.
A legitimidade é uma declaração registrada do operador, não uma verificação externa.
Um snapshot inválido mantém a descoberta bloqueada e registra a falha sem rede.
Nenhuma opção autoriza AEM, publicação, deploy ou dispatch.
