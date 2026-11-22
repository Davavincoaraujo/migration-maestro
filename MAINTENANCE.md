# Manutenção

## Começar uma alteração

1. Execute `git status --short`. Preserve alterações de terceiros e checkpoints.
   A rodada de entrega já guardou uma cópia das fontes em maintenance-backups.
2. Leia ARCHITECTURE.md, OPERATIONS.md e o contrato do módulo afetado.
3. Use Node 22. Execute o teste focado antes e depois da alteração.
4. Execute `npm run check`, `npm test`, `npm run build` e revise o diff.
5. Descreva escopo, risco, evidência e limitações. Não faça push/PR sem autorização.

Não reverta arquivos inteiros para uma versão antiga sobre alterações locais.
Para refatorar, preserve contratos de arquivos existentes ou escreva migração
explícita que trabalhe em uma cópia. Nunca apague checkpoint para corrigir teste.

## Mapa do código

- ai/operational-routing.ts: política A/B/C e elegibilidade, sem acesso externo.
- autopilot/operational-run.ts: configuração imutável do job, probe e entrada nova.
- autopilot/central-controller.ts: pipeline, hashes, evidências e revisão pendente.
- autopilot/dispatch-executor.ts: intenção/tentativa/recibo e envio no máximo uma vez.
- autopilot/checkpoint-runner.ts e file-checkpoint-store.ts: progresso persistente.
- integrations/maestri-central-cli.ts: CLI oficial, timeout, limite e UTF-8.
- integrations/model-discovery.ts: observação diagnóstica, nunca entitlement.
- autopilot/isolated-next-pilot.ts: workflow React/Next e checks do projeto isolado.
- autopilot/local-migration-workflow.ts: integração corporativa autorizada, separada.

## Testes

`npm test` usa concorrência 4. Os testes criam diretórios temporários e fixtures;
os especialistas simulados não são demonstração de execução Maestri real.

```sh
node --import tsx --test tests/operational-routing.test.ts tests/operational-run.test.ts
node --import tsx --test tests/central-controller.test.ts tests/autopilot-result-contract.test.ts
npm run check
npm test
npm run build
```

As integrações de browser externo e portal são opt-in. A integração de portal só
roda com MAESTRO_ENABLE_PORTAL_TESTS=1 e fontes/readback explicitamente autorizados;
não ative em manutenção comum. O script histórico maestro:isolated:runtime-test
aponta para um piloto específico e não compõe a suíte portátil. Não altere esse
piloto para obter verde.

Para um agente novo, declare capacidades e teste o challenge em job novo. Para
nova capacidade, implemente uma validação determinística real do exercício,
instruções correspondentes e testes negativos; não aceite self-report como prova.

## Atualizar provedores e integrações

Consulte documentação oficial e registre URL/data. O Wire não tem contrato de
modelo ativo suficiente hoje. Não reabra essa investigação sem evidência nova.
Um futuro adaptador A deve verificar vínculo da sessão, fonte/autenticidade,
modelo, capacidades e disponibilidade; valores configurados ou catálogo não bastam.
Adicione fixtures documentadas, casos de campo ausente, mudança de sessão, stale
state e indisponibilidade. Nunca carregue código de adaptador de uma configuração
ou resposta do terminal. Interfaces injetáveis são pontos de composição confiáveis.

Atualize dependências via branch revisada, lockfile e suíte. O scaffold Next mantém
as versões existentes do piloto; avalie compatibilidade e avisos oficiais antes
de adotá-lo em projeto real. Não copie node_modules ou código de portal corporativo
para uma pasta pública. Não chame rede, instalação ou build de projeto externo
implicitamente em testes unitários.

## Branches e PRs

Faça mudanças de aplicação em checkout/worktree isolado com base e escopo
registrados. Não resete o worktree compartilhado. Execute build/testes nesse
checkout, guarde hashes e peça revisão humana antes de merge/publicação.
Este repositório não automatiza push/PR/merge. A descrição da revisão deve separar
resultados locais, fixtures, resultados reais e bloqueios externos.
