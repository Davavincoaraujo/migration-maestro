# Atestação de sessões — 19/11/2026

## Evidência oficial investigada

`maestri help` e `maestri list` retornaram `Connection failed: Operation not permitted`
neste ambiente. Portanto não foi possível enumerar a ajuda instalada ou confirmar
sessões ao vivo. Não houve acesso a sockets alternativos, pareamento, credenciais,
reinício ou alteração de permissões.

A [documentação oficial Wire](https://www.themaestri.app/en/docs/wire), consultada
em 19/11/2026, descreve TerminalCard, ChatSnapshot e metadados de atividade. Não
foi encontrado nesses contratos um vínculo autenticado entre sessão do provedor,
modelo ativo, perfil, capacidade de planejamento e disponibilidade de inferência.
As capabilities de `/api/info` são funcionalidades do protocolo, não habilidades
de agentes. IDs de conversa e indicadores de processo não suprem esse vínculo.

A CLI `list` fornece nomes para descoberta diagnóstica; `check` fornece texto de
terminal. Catálogo CLI, configuração, variáveis de ambiente e snapshots históricos
não atestam uma sessão ativa. O provider implementado não lê transcritos ou catálogos.
Não há implementação que retorne verified usando fonte real: o provider padrão
retorna sempre unverified, inclusive quando observa Hermes conectado.

## Contrato e fronteira de confiança

`src/sessions/session-attestation.ts` não importa o roteador nem a política.
`SessionAttestationProvider` expõe `id` e `attest(request, AbortSignal): Promise<unknown>`.
O retorno desconhecido é validado em runtime. Implementações são injetadas por código
confiável da aplicação, nunca escolhidas por JSON, ambiente ou argumentos da CLI.

Cada pedido contém versão, desafio aleatório, requestedAt e requisitos de
compatibilidade: agente, provider, modelo, perfil e capacidade. Os requisitos
vêm da operação; não são evidência de que o agente os satisfaça.

Um resultado verified precisa conter:

- issuer igual ao provider e resposta ao desafio corrente;
- vínculo único agentId/workspaceId/terminalId/sessionId/provider/modelId/profile;
- capabilities não vazias, incluindo a requerida, e available=true;
- issuedAt a partir do pedido, sem futuro, expiresAt futuro e validade de até 60 segundos;
- referência de evidência e verificações explícitas de identidade, modelo, perfil,
  capacidades e disponibilidade; SHA-256 consistente do vínculo completo.

Um futuro adaptador deve autenticar a fonte oficial e verificar todas essas
asserções, inclusive o desafio e os instantes. O digest verifica consistência,
não uma assinatura. Preencher os campos booleanos não autentica uma fonte.
Nenhum desses campos é inventado pelo provider padrão.

Timeout (3 segundos por padrão), exceção, ausência, conflito ou expiração retorna
unverified. O adaptador CLI tem também timeout próprio de 3 segundos. O sinal de
cancelamento faz parte do contrato para futuros adaptadores.

Resultados aceitos são projetados, congelados e registrados em memória. O roteador
rejeita objetos brutos/clonados e snapshots serializados, mesmo se tiverem a mesma
forma. Uma atestação persistida serve para auditoria e vínculo, nunca como substituta
de uma consulta atual. Isso protege a fronteira entre dados e callbacks confiáveis;
não protege contra código arbitrário executado dentro do coordenador.

## Integração com autorização e PLAN

`operationalSessionGate` combina o provider com os requisitos de PLAN. A autorização
de continuação continua independente e obrigatória, verificada antes de consultar
o provider. Atestação não concede aprovação humana, autorização de avanço,
entrega autenticada ou autoria autenticada.

O gate consulta novamente antes do estágio PLAN, da seleção da rota e do despacho.
Exige Hermes, ADVANCED e planning; o roteador genérico recusa planning via prova
local/declarada. Não existe redução para ECONOMY/BALANCED.

O vínculo de sessão é fixado durante a execução; uma troca exige revisão. Quando
existe intenção PLAN persistida, a nova atestação deve corresponder à sessão
registrada na rota. Intenções antigas sem esse vínculo falham fechadas. O controller
continua validando os recibos e hashes; nenhum registro histórico é reescrito.
A continuação permanece planOnly, com IMPLEMENT proibido. Reutilizar um PLAN já
concluído não é um novo despacho e continua validando seus artefatos offline.

## Inspeção operacional segura

```sh
npm run maestro:operate -- inspect-session-attestations ad3b6e8aaeb3e22001ab
npm run maestro:operate -- inspect-continuation ad3b6e8aaeb3e22001ab
```

O primeiro comando lê a política para definir requisitos e consulta o provider
para os agentes declarados. Os perfis exibidos são **requeridos**, não descobertos.
Examina planning para agentes de planejamento e a primeira capacidade declarada
para os demais; não afirma validar todas as capacidades. Usa somente `list`, sem
check/ask, sem escrita de arquivos e sem criar autorização. Não exige autorização
para inspecionar. Unverified é um resultado diagnóstico esperado, não sucesso do gate.

Enquanto o IPC estiver indisponível, o motivo será MAESTRI_UNAVAILABLE. Com conexão
e nome único, será MAESTRI_SESSION_ATTESTATION_UNSUPPORTED. Ausência ou ambiguidade
do nome também permanecem unverified.

## Bloqueios e evolução necessária

PLAN continua bloqueado por autorização ausente/expirada, recuperação divergente,
sessão não atestada, identidade/modelo/capacidade incompatível, expiração, falta de
disponibilidade ou mudança de sessão. O provider padrão não pode liberar PLAN.

Para validar operacionalmente no futuro: executar somente as inspeções, revisar a
fonte oficial disponível e implementar um adaptador autenticado se o contrato passar
a fornecer as evidências faltantes. Será necessário revisar também o transporte:
o envio atual é endereçado por nome, e verificações separadas não eliminam a corrida
entre a última atestação e uma troca de sessão. Um adaptador real deve oferecer um
vínculo verificável com o destino do executor antes de ser habilitado. Nenhuma troca
automática de provider, aprovação ou retomada faz parte desta alteração.

A continuação agora também bloqueia uma atestação aceita quando falta o vínculo
operacional do transporte, antes da intenção PLAN. Consulte a
[investigação de transporte](maestri-dispatch-binding.md) para o contrato oficial,
a limitação de sessão e os testes da barreira independente.
