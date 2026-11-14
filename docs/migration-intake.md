# Central de migrações — fluxo de entrada

Abra `http://127.0.0.1:4177/migrations/new` para registrar uma solicitação.

1. Informe a URL HTTPS da página legada e o caminho `/content/...` de destino.
2. O Maestro valida os campos e registra **somente um plano** no arquivo local `migration-intakes.json`.
3. A tela mostra a sequência planejada: discovery → evidence → mapping → composition → quality → review.
4. A aprovação humana é obrigatória antes de qualquer integração futura de escrita.

**Limite atual:** esta etapa não faz requisição à URL legada, não aciona agentes reais, não invoca servidores MCP e não cria conteúdo no AEM. O registro é independente do executor de fixtures sintéticas já existente. As URLs informadas são metadados locais; não devem conter tokens, parâmetros sensíveis ou credenciais.

## Arquitetura para a próxima fase

- Conector de origem com allowlist explícita de domínios e proteção SSRF, sem redirecionamento a destinos não autorizados.
- Adaptadores MCP de leitura para extração e catálogo de componentes.
- Executor de agentes com estados persistidos por solicitação, idempotência, checkpoints e observabilidade.
- Geração de propostas Next.js/UE e validação de qualidade.
- Revisão humana antes de qualquer PR ou operação no AEM.

O painel não deve apresentar um plano registrado como migração executada.
