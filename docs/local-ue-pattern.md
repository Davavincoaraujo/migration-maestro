# Integração local real: ue-pattern (primeira fase)

O repositório `ue-pattern` expõe uma CLI em `dist/cli.js`. Esta integração usa `spawn(process.execPath, ...)` sem shell, com diretórios absolutos configurados localmente.

## Configuração no Mac

No terminal do ue-pattern:
```bash
cd /CAMINHO/ue-pattern
npm install
npm run build
```

No terminal do Maestro:
```bash
export MAESTRO_UE_PATTERN_DIR="/CAMINHO/ue-pattern"
export MAESTRO_COMPONENTS_PROJECT_DIR="/CAMINHO/repositorio-de-componentes"
npm run ue:local -- topicos
npm run ue:local -- buscar "multifield"
npm run ue:local -- validar "meu-grupo/sections/hero/v1"
```

O comando `validar` requer um caminho relativo de componente válido na biblioteca; os comandos `topicos` e `buscar` usam o conhecimento local do ue-pattern. As saídas são exibidas no terminal, não persistidas no GitHub.

## Escopo de segurança

Somente `topicos`, `buscar` e `validar` são permitidos. Não expomos `criar`, `--gravar`, `spec`, `comparar` ou outros comandos que podem alterar arquivos ou acessar páginas. A execução possui timeout de 15 segundos e limite de saída de 64 KB. Os diretórios são resolvidos localmente e a CLI não pode escapar do diretório explicitamente configurado via symlink.

O adaptador **ainda não está conectado automaticamente ao botão Nova migração** e não inicia Claude, MCP ou escrita no AEM. O primeiro objetivo é verificar um contrato real de leitura/validação na máquina antes de acoplar o executor e o roteador de modelos.

Para usar Claude via SDK em outra etapa, configure credenciais autorizadas no runtime local; nunca faça commit de tokens, paths internos, dados de clientes ou código proprietário.
