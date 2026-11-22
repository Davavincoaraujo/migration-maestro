# Descoberta do modelo de Hermes

## Investigação da candidata na penúltima linha

O diagnóstico informado do shell original retornou exitCode 0, stdout/stderr iguais,
sem EPERM, e modelShapedLineDistancesFromEnd=[1] nos três agentes. Isso comprova
que uma linha aceita isoladamente está antes da última linha não vazia. O parser
operacional exige a última linha; portanto a rejeição por posição está explicada.
Ainda não comprova que a candidata seja o rodapé atual, nem identifica o conteúdo
da linha posterior. Não se deve corrigir isso procurando modelos no histórico.

Para coletar a evidência restante, execute na raiz, no shell original:

```sh
node --import tsx src/cli-model-footer-diagnose.ts Hermes Analytics UE-Pattern
```

O comando faz somente list/check, sem arquivos de captura. Confirma o nome exato
na listagem antes de consultar cada agente. Exibe apenas o prefixo modelo/esforço
da candidata; sufixos com caminhos ou texto são ocultados. Mostra posições,
comprimentos, ANSI SGR, códigos dos controles e linhas posteriores exclusivamente
estruturais (bordas/espaços). Texto posterior nunca é impresso. Essa vinculação
ao alvo da CLI não autentica a sessão nem prova que o texto seja um rodapé atual.
Se houver um wrapper textual desconhecido, seu conteúdo continuará oculto: será
necessário verificar seu contrato antes de flexibilizar o parser.

Nesta continuação, list foi novamente negado no Codex com Operation not permitted.
O parser permanece inalterado até obter o formato exato e validar a origem.
Os testes novos são sintéticos e verificam diagnóstico/redação; não substituem
as três capturas reais ainda pendentes. Identidade, disponibilidade e capacidade
continuam gates distintos, sem promoção para available.

A inspeção usa `maestri list` → nomes conectados → `maestri check <nome>` → `parseMaestriSessionMetadata` → capacidades configuradas por papel → `routeMaestriStage`. O catálogo de `codex debug models` é apresentado separadamente; não cria candidatos executáveis. PLAN exige planning e IMPLEMENT exige coding, ambos com perfil ADVANCED e disponibilidade available.

Na investigação de 2026-11-17, a skill Maestri documenta `check` como saída do terminal. A documentação oficial consultada não forneceu um contrato estruturado de modelo ativo e disponibilidade por sessão. Isso não prova que tal API inexista: `maestri list` e `maestri help` foram negados pelo sandbox com `Connection failed: Operation not permitted`, impedindo a consulta à ajuda instalada e à sessão real. Não foram inventados comandos, campos JSON ou acessos internos ao socket. Referências: https://www.themaestri.app/en/docs/terminals e https://www.themaestri.app/en/docs/maestro.

O parser anterior só aceitava modelo seguido de `default` opcional e `·`; portanto não reconhecia `GPT-6-Astra low · …`. Além disso, percorria todas as linhas, podendo aproveitar um rodapé histórico. Agora aceita níveis de esforço conhecidos e somente um rodapé ancorado na última linha não vazia. Mensagens `Model changed to …`, menções em prosa, citações e rodapés anteriores não selecionam o modelo. Cada inspeção relê a sessão, sem cache de identidade. ANSI de cor é removido; controles de cursor não renderizados invalidam a identificação. Na revisão inicial, uma linha isolada `GPT-6-Astra low` permanecia desconhecida; a correção abaixo substitui essa restrição.

Esse fallback é uma heurística de identidade, não uma atestação: texto copiado no final pode imitar um rodapé. Por isso ele nunca promove disponibilidade para available. Um modelo conhecido recebe `MAESTRI_SESSION_AVAILABILITY_NOT_VERIFIED` e permanece bloqueado. Alertas de limite continuam conservadores e podem ser históricos; sua ausência não comprova acesso. As capacidades por papel são configuração local, não telemetria do provedor. O catálogo não comprova entitlement nem capacidade real de inferência.

Consequência deliberada: todas as sessões descobertas apenas por terminal ficam inelegíveis, inclusive outros papéis. A liberação exige uma fonte oficial verificável, vinculada à sessão e ao modelo atuais, que comprove disponibilidade. Quando esse contrato puder ser consultado, ele deve ter precedência sobre o fallback textual; não se deve acrescentar um esquema hipotético ou usar um preset como prova. Permissões de execução permanecem nos gates existentes, sem alterações.

Validação: 32 testes focados em descoberta, inspeção, roteamento e histórico passaram; `npm run check` passou. Os testes incluem modelos conhecidos/desconhecidos, troca de modelo, histórico, falha de leitura, ANSI e gates independentes de perfil/capacidade/disponibilidade. Candidatos available nos testes são sintéticos, não comprovação da sessão Hermes. A execução de `npm run model-router:inspect` retornou código 0, `maestri.state: connected`, `connectedMaestriSessions: []` e todas as rotas bloqueadas. A chamada direta pelo transporte retornou `MAESTRI_COMMAND_FAILED`, e a CLI direta informou `Operation not permitted`. Essa divergência não comprova sessão Hermes nem acesso autorizado; nenhum modelo real de Hermes foi validado. Nenhuma sessão foi criada/reiniciada, nenhum Autopilot foi executado e nenhum checkpoint, implementação staged ou arquivo do portal AEM foi alterado.


## Continuação: rodapé compacto e diagnóstico de transporte

O caminho efetivo é cli-model-router-inspect.ts → inspectModelRouter → maestriTransport(list) → inspectMaestriModelSessions → maestriTransport(check, [nome]) → parseMaestriSessionMetadata. O transporte executa o binário MAESTRI_CLI (ou maestri via PATH), sem shell, herdando ambiente e diretório do Node. Não carrega aliases, funções ou arquivos de inicialização do shell. npm pode acrescentar node_modules/.bin ao PATH. stdin é ignorado; stdout/stderr são pipes, portanto a apresentação pode diferir de um terminal TTY.

Defeito reproduzido: o parser exigia o separador · mesmo após um esforço válido. Assim rejeitava o trecho compacto informado pelo usuário, GPT-6-Astra low. Agora aceita modelo + esforço como última linha não vazia, além do formato com separador. Não procura modelos na conversa para substituir o rodapé atual; não atribui Astra por papel. Os testes usam o trecho informado, não uma captura completa da sessão, que segue inacessível neste sandbox.

Outro defeito corrigido: chunk.toString() podia quebrar UTF-8 entre blocos, inclusive o separador ·. StringDecoder preserva esses caracteres. O limite de 128000 bytes rejeita a resposta inteira; não retorna texto truncado. stderr continua separado e descartado pelo transporte operacional: não há evidência de que contenha o rodapé real, e misturá-lo a stdout poderia substituir a última linha por diagnósticos. A ferramenta de diagnóstico inspeciona ambos separadamente.

Verificação local: shell e Node retornaram exit 1, stdout vazio e stderr de 52 bytes, com hashes iguais e Operation not permitted. MAESTRI_CLI correspondeu ao executável resolvido pelo shell neste ambiente. O transporte retornou MAESTRI_COMMAND_FAILED. Portanto a causa completa da divergência no shell original ainda depende da captura sanitizada abaixo; não foi demonstrado que o rodapé completo lá tenha somente o trecho informado, nem se há linhas posteriores ou wrappers.

Execute na raiz do projeto, no shell original do Maestri:

```sh
sh scripts/model-router-diagnose.sh Hermes
sh scripts/model-router-diagnose.sh Analytics
sh scripts/model-router-diagnose.sh UE-Pattern
npm run model-router:inspect
```

O diagnóstico chama somente check, compara stdout/stderr do executável via shell e Node e passa pelo transporte operacional. Usa arquivos temporários privados removidos ao sair; imprime somente tamanhos, hashes, indicadores de formato/EPERM e metadados de modelo. Não imprime credenciais, valores de ambiente, caminhos nem conversa. As capturas são sequenciais e podem diferir se a sessão mudar. O script sh não reproduz aliases/funções do shell interativo; diferenças devem ser verificadas localmente com command -v maestri, sem compartilhar caminhos ou valores sensíveis. modelShapedLineDistancesFromEnd indica se há linhas posteriores ao possível rodapé, sem expor seu conteúdo.

Resultado final neste sandbox: model-router:inspect saiu com código 1, maestri.state unavailable, diagnóstico MAESTRI_IPC_UNAVAILABLE, zero sessões e cinco rotas blocked. Isso não contradiz Connection: OK observado no shell original. Modelo reconhecido ainda mantém disponibilidade unknown até existir evidência confiável por sessão.

Validação desta continuação: 31 testes de descoberta/inspeção/roteamento/histórico e 3 testes de transporte passaram; npm run check passou. Os testes de transporte cobrem UTF-8 dividido, argumentos com espaços, ambiente/diretório herdados, limite sem truncamento silencioso, stderr separado e saída não zero. Nenhum Autopilot, reinício, alteração de checkpoint ou portal foi executado.

## Correção de 17/11/2026: classificação da linha auxiliar

O parser agora examina somente a última linha não vazia ou a penúltima quando
seguida de exatamente `? for shortcuts` ou `N% context left` (inteiro de 0 a 100).
Nesse segundo caso exige modelo GPT e separador ` · `; não aplica auxiliares
Codex a Claude. Bordas, texto desconhecido, múltiplos auxiliares e controles
invisíveis não são ignorados. Nenhuma busca operacional no histórico foi adicionada.

O diagnóstico classifica a linha posterior como shortcuts, context-left, border,
blank, unknown ou unsafe-control sem publicar texto desconhecido. A associação
`command-target` preserva o agente consultado; `sessionIdentityVerified=false`,
`currentFooterVerified=false` e `MAESTRI_SESSION_IDENTITY_NOT_VERIFIED` deixam
explícito que reconhecer a estrutura não autentica a sessão. Disponibilidade
permanece unknown, inclusive diante de alertas textuais potencialmente históricos.
Catálogo e capacidades não foram usados como prova de sessão ou disponibilidade.

Os trechos informados são Hermes/GPT-6-Astra low, Analytics/GPT-6.1-Sol default e
UE-Pattern/GPT-6.1-Sol default, com separador · e distância 1. Os testes usam esses
prefixos reais e auxiliares **sintéticos**, pois o conteúdo/classificação da última
linha ainda não foi fornecido. Não constituem capturas completas reais validadas.
A consulta local list/check foi impedida em list (exit 1, EPERM); os três agentes
não puderam ser redescobertos neste sandbox. Isso não invalida o exit 0 reportado
no shell original. Os três continuam sem comprovação da sessão ativa e bloqueados.

Para concluir a identificação da linha real, execute o diagnóstico mínimo atualizado
no shell original e compartilhe apenas seu JSON sanitizado:

```sh
node --import tsx src/cli-model-footer-diagnose.ts Hermes Analytics UE-Pattern
```

O comando usa somente list/check, não grava capturas e não reinicia sessões.
Se a classificação for unknown ou border, o parser continua fechado; não se deve
adicionar uma exceção sem evidência do contrato dessa linha.

## Investigação a partir do diagnóstico de 17/11/2026 às 16:34

Evidência fornecida: três agentes conectados, check exit 0, candidata na penúltima
linha; auxiliar com 32 caracteres em Hermes/Analytics e 142 em UE-Pattern, sem
ANSI/controles. Esses tamanhos não identificam a gramática nem a origem da linha.
Não há evidência suficiente para afirmar se é barra de atalhos, aviso ou conversa.

Causa de rejeição demonstrável no código: o parser só recua uma linha quando o
auxiliar inteiro corresponde à gramática fechada. Unknown não permite recuar.
O classificador recebe texto original com somente SGR removido e aplica trim;
a redação de caminhos/sufixos ocorre apenas na saída do diagnóstico. Não há
sanitização prévia substituindo palavras da linha auxiliar. Sem ANSI, essa etapa
não altera o texto informado. Outro detalhe: o diagnóstico antigo classificava
a própria candidata com a gramática de auxiliares, logo unknown nessa candidata
não significava falha no reconhecimento de modelo/esforço.

Nesta alteração, o diagnóstico distingue model-line de auxiliaryClassification,
explicita classifierInput e stylingRemoved, e acrescenta trimmedLength e sinais
booleanos de atalhos/contexto/teclas/aviso, além de contagens de separadores e
espaçamento. São indícios, nunca autorização para aceitar a linha. Não imprime
texto desconhecido. A busca diagnóstica fica limitada às cinco últimas linhas;
o parser operacional mantém seu limite de uma linha auxiliar. A remoção de SGR
é compartilhada pelos dois caminhos. Nenhum novo formato foi aceito sem prova.

Metadados estruturados: a documentação oficial Maestri Wire descreve ChatSnapshot
com terminalId e conversationId, acessível mediante terminalChat e conexão
autenticada. Isso oferece uma via para associação estruturada, mas não autentica
a captura textual atual de check, nem comprova modelo/disponibilidade operacional.
Não foi estabelecida conexão Wire nem consultada uma sessão por essa via.
Fonte: https://www.themaestri.app/en/docs/wire (consultada nesta investigação).
A ajuda instalada e list foram negados pelo sandbox com Operation not permitted.
Portanto não foi possível verificar se a CLI instalada oferece campos equivalentes.
Não se conclui que Maestri não possua metadados estruturados.

Resultado local: diagnóstico exit 1, list.ok=false, permissionDenied=true; nenhuma
nova captura real obtida. Isso não substitui nem contradiz o check exit 0 das 16:34.
A identificação da linha auxiliar real permanece pendente. sessionIdentityVerified
continua false e availability continua unknown. O próximo diagnóstico no shell
original usa o mesmo comando já documentado e agora fornece os sinais estruturais
adicionais; indícios parciais ainda exigem comprovação do formato antes de aceitá-lo.

Validação: npm run check passou; 45 testes passaram nos arquivos
model-footer-diagnostic, maestri-session-model, model-router-inspection,
maestri-transport, adaptive-model-router e model-router-history. Os testes novos
usam sondas sintéticas explicitamente identificadas, não capturas reais.
Nenhum agente reiniciado, Autopilot executado, checkpoint ou portal AEM alterado.
