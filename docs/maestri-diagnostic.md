# Diagnóstico Maestri somente leitura

```sh
# No terminal original do Maestri, a partir da raiz do Migration Maestro:
npm run maestro:operate -- diagnose-maestri
npm run maestro:operate -- diagnose-maestri ad3b6e8aaeb3e22001ab

# Opcional: observar o rótulo de modelo no rodapé visível, sem autenticar esse dado:
npm run maestro:operate -- diagnose-maestri ad3b6e8aaeb3e22001ab --observe-model
```

Sem ID, as declarações vêm de `config/operational-agents.json`. Com ID, vêm da
política original em `operation.json`. Nenhum dos comandos exige/cria aprovação,
executa resume, envia prompts ou escreve arquivos. O resultado vai apenas a stdout.
O exit code é 1 se IPC falhar ou o formato de list for inconsistente; é 0 quando
as consultas list retornam em formato reconhecido. Exit 0 NÃO significa PLAN liberado.

## O que cada dimensão significa

| Dimensão | Evidência usada | Limite |
| --- | --- | --- |
| IPC | Retorno/erro do comando oficial list | Verifica round trip da CLI, não autentica o peer nem comprova disponibilidade de inferência |
| Nome do agente | Ocorrências exatas na seção de agentes | Observação; nomes ausentes/duplicados não identificam uma sessão |
| Identidade da sessão | Nenhuma fonte suficiente integrada | sessionId=null, verified=false |
| Modelo ativo | Opcionalmente rótulo do rodapé obtido por check | Observação não autenticada; modelo ativo continua desconhecido |
| Perfil/capacidades | Política local para declarações/requisitos | Não são habilidades comprovadas nem perfil observado |
| Disponibilidade | Nenhuma fonte suficiente integrada | Continua unknown mesmo com IPC funcional |
| Vínculo do despacho | Inspeção do executor atual | Endereçamento por nome, sem precondição atômica de sessão |

O relatório distingue `declared`, `requiredProfile`, `modelObservation` e campos
`verified`. Hermes mantém o requisito ADVANCED. O provider permanece unverified,
a autorização e os requisitos de PLAN não são alterados por este comando.

Duas amostras sequenciais permitem apontar alterações de resposta/rótulo. Não há
retry após falha inicial. As amostras não são transação: nem respostas iguais
provam continuidade, nem respostas diferentes provam mudança de sessão. Campos
extras como sessionId em list são ignorados como evidência. O digest da resposta
é usado somente em memória para comparação e não sai no relatório.

Por padrão são feitas até duas chamadas list. Com --observe-model, check é chamado
somente para nomes declarados observados uma única vez em cada amostra válida.
A leitura do terminal é opcional; nenhum transcrito, caminho de terminal, mensagem
de erro bruta ou valor de ambiente é impresso ou persistido. Cada chamada oficial
tem timeout de 3 segundos e limite de saída de 128 KB. Para N agentes, no máximo
2 + 2N chamadas; observações desconhecidas não são completadas com inferências.

## Investigação oficial e transporte

Em 19/11/2026, `maestri help` e `maestri list` falharam neste ambiente com
`Connection failed: Operation not permitted`. Não foi possível enumerar opções
adicionais da CLI instalada; nenhuma flag de sessão foi presumida ou experimentada.
O executor integrado usa `ask` com nome do agente. A identidade do executor e o
MAESTRI_TERMINAL_ID do chamador não vinculam a sessão de destino.

A [documentação oficial Wire](https://www.themaestri.app/en/docs/wire#terminals)
expõe envio por **ID de terminal** em `POST /api/terminals/{id}/prompt`. Isso é uma
alternativa documentada ao nome, ainda não integrada ou exercitada neste projeto.
O contrato consultado não fornece precondição de ID/geração da sessão do provedor
nesse envio. TerminalCard/ChatSnapshot fornecem identidade e atividade do terminal
ou conversa, não atestação completa de modelo, capacidade e disponibilidade.
Portanto endereçar um terminal não elimina por si só a corrida de troca de sessão.

Não houve pareamento, descoberta de sockets/credenciais, alteração de permissões,
conexão a host Wire ou chamada a rotas de escrita. O diagnóstico não testa envio.
Os critérios do Authorization Gate e SessionAttestationProvider permanecem intactos.

## Próximos passos seguros

1. Executar diagnose-maestri no terminal original; investigar IPC_PERMISSION_DENIED,
   IPC_TIMEOUT ou IPC_COMMAND_FAILED pelo mecanismo oficial, sem contornar permissões.
2. Se necessário, usar --observe-model para obter observações limitadas; tratar
   LIST_RESPONSE_INCONSISTENT como formato não suportado, não como evidência válida.
3. Para integração futura, usar acesso Wire somente leitura já autorizado, com
   transporte autenticado, para resolver os vínculos de canvas/terminal/conversa.
4. Exigir uma fonte oficial adicional para sessão/modelo/capacidade/disponibilidade,
   e um envio condicionado atomicamente à mesma sessão/geração antes de habilitar
   um provider verified. Um adaptador oficial de provedor com esses contratos pode
   complementar Wire; apenas snapshots ou configuração não bastam.

Enquanto isso, unverified e PLAN bloqueado são os resultados corretos. Relatórios
não são carregados como autorização ou atestação. Os testes simulam IPC, ausência,
modelos desconhecidos, troca de sessão/observações e respostas inconsistentes.
