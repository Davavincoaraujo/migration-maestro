# Configuração de agentes e modelos: resultado local

A ativação no Maestri está bloqueada por `Connection failed: Operation not permitted` em `help`, `list`, `role list`, `preset list`, ajuda dos subcomandos e `debug`. Não foi possível comprovar agentes conectados, contas nomeadas, papéis importados, presets aplicados ou modelos ativos. Nenhuma credencial, permissão global ou configuração de segurança foi alterada. Nenhum dashboard foi criado.

As quatro responsabilidades existentes foram validadas em `.maestri/roles/{analytics,ue-pattern,hermes,validator}/role.json`. São arquivos portáveis de papéis; sua presença não significa que o aplicativo já os importou ou associou aos terminais. Não foram criados agentes duplicados nem reiniciadas sessões desconhecidas.

## Perfis existentes e plano de ativação

O `config/model-router.json` existente passou na validação e foi preservado. ECONOMY corresponde a tarefas simples; BALANCED a mapeamento e revisão; ADVANCED a arquitetura, implementação complexa e integração arriscada. A classificação considera escopo e risco: nenhuma função fica presa ao perfil padrão quando a tarefa demanda mais capacidade. Operações determinísticas usam ferramentas, sem chamada a modelo.

| Papel | Padrão proposto para ativação | Comando de lançamento |
| --- | --- | --- |
| Analytics | ECONOMY | `codex --model gpt-6-luna` |
| UE-Pattern | BALANCED | `codex --model gpt-6.1-sol` |
| Hermes | ADVANCED | `codex --model gpt-6-astra` |
| Validator | BALANCED | `codex --model gpt-6.1-terra` |

Esses comandos são um plano **não aplicado**, com modelos presentes no catálogo da CLI. Eles não substituem presets ou comandos existentes. A alteração de modelo de uma sessão requer lançamento/reinício oficial; o router não muda silenciosamente o modelo de um terminal.

`codex debug models`, lido através do módulo existente que descarta prompts e retém apenas campos de catálogo, retornou na inspeção persistida oito modelos: `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra` e `gpt-5.6-luna`. Uma primeira consulta também expôs `gpt-5.5`, mas a consulta final não o listou; ele não é tratado como opção atual garantida. IDs sem classificação permanecem UNKNOWN, sem capacidade inventada. Catálogo não comprova entitlement por conta nem uma inferência bem-sucedida.

`codex login status` informou login via ChatGPT. `claude auth status` informou `loggedIn: false`, `authMethod: none` neste contexto. A ajuda Claude Code lista `sonnet`, `opus` e `fable`; isso prova aliases aceitos, não autenticação, versão resolvida ou acesso da conta. Não foi comprovada uma opção Claude ECONOMY disponível. Contas adicionais do Maestri podem existir e não foram acessadas por falta de IPC; não confundir a conta padrão da CLI com todas as contas do aplicativo.

## Router e fallback

O controlador existente já chama a descoberta de sessões e `routeMaestriStage`. Apenas sessões ativas identificadas por metadados visíveis são elegíveis. Em limite de uso, o fallback existente exige outro provedor ativo, capaz e com perfil suficiente. Sem Claude autenticado/visível ou sem IPC, o fallback real permanece indisponível. Uma falha de IPC não causa troca de modelo. Não se redistribuem tarefas com envio ambíguo sem reconciliar os recibos.

A inspeção agora preserva o catálogo mesmo quando `maestri list` falha. O comando continua retornando código 1 com diagnóstico estruturado, sessões vazias e rotas bloqueadas; não transforma descoberta parcial em sucesso operacional. Valores de custo e uso permanecem nulos.

## Opções oficiais do aplicativo

A CLI oficial documentada permite `role create`, `role assign`, `preset create/set`, `recruit --preset/--account` e `connect`; não foi possível consultar sua ajuda instalada nesta sessão. Portanto, a limitação aqui é IPC, não a afirmação de que toda configuração exige GUI.

Enquanto essa restrição persistir, as opções documentadas são:

1. No terminal existente, abra **Edit → Role → Discover Roles**, com o diretório de trabalho neste repositório, e importe os quatro papéis. Selecione o papel correspondente em cada terminal. A biblioteca de papéis fica em **Settings → Agents**.
2. Em **Settings → Terminal → Quick Start**, crie/selecione os presets de modelo com os comandos da tabela. Em **Edit Terminal → Details**, o dropdown de presets junto a **Command** preenche o comando. Revise o comando antes do próximo lançamento; não acrescente flags que desativem segurança.
3. Consulte as contas existentes em **Settings → Agents → Accounts**. A conta de cada terminal é selecionada em **Edit Terminal → Details → Account**. Uma conta escolhida só entra em vigor no próximo lançamento. Se Claude não estiver autenticado na conta desejada, o usuário deve resolver o login por essa interface; este trabalho não alterou credenciais.
4. No coordenador, confira **Details → Maestro**. Garanta as conexões do coordenador com Analytics, UE-Pattern, Hermes e Validator no canvas.
5. Em um contexto com IPC autorizado, execute primeiro `maestri list`, `maestri role list` e `maestri preset list`. Só então associe papéis/presets realmente ausentes, preservando terminais existentes. Reexecute `npm run model-router:inspect` para observar modelos de sessão. Faça probes determinísticos por `ask/check`; resposta do próprio modelo não é metadado de provedor/modelo. Confira o footer real e a decisão do router antes de declarar seleção comprovada.

Referências oficiais: https://www.themaestri.app/en/docs/terminals e https://www.themaestri.app/en/docs/maestro. Os nomes acima vêm dessas páginas; não são opções inferidas de arquivos internos do aplicativo.

## Evidências e testes

- `.local-maestro/model-router-inspection.json`: catálogo real da CLI, ausência de IPC e decisões bloqueadas; saída reduzida, sem histórico de terminal ou credenciais.
- `.local-maestro/maestri-model-setup.json`: papéis existentes, proposta de perfis, login reduzido, bloqueios e flags `applied: false`.
- `npm run check`: passou.
- 20 testes direcionados de classificação, descoberta, histórico, fallback e inspeção: passaram. Os testes usam fixtures para roteamento/IPC; não são prova de comunicação real entre agentes.

Alterações de código desta rodada: `src/integrations/model-router-inspection.ts`, `src/cli-model-router-inspect.ts` e `tests/model-router-inspection.test.ts`. Nenhum provedor ou modelo foi ativado no aplicativo sem evidência. A configuração local existente está validada; a associação e a validação ponta a ponta continuam pendentes.
