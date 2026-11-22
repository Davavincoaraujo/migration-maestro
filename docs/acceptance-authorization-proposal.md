# Proposta restrita de autorização para aceitação local

Status: proposta preparada; não ativada. Nenhum sandbox, configuração global,
credencial ou regra persistente foi alterado nesta rodada.

## Estado confirmado

- O perfil efetivo desta execução é `workspace-write`, com escrita apenas no
  checkout `migration-maestro` e diretórios temporários; aprovação de comandos
  externos está em `never` e a política de rede é restrita pelo host.
- Analytics, UE-Pattern, Hermes e Maestro Mode foram confirmados pelo usuário e
  registrados no checkpoint. Isso confirma o canvas, mas não prova IPC nesta
  sessão.
- O socket atual conhecido é
  `/var/folders/xq/glpfg2bs4dv41frf1pdnk6l80000gn/T/maestri-ca200b5b/maestri.sock`.
  A tentativa anterior registrada falhou com `EPERM`. A allowlist Claude do
  projeto não altera a política externa efetiva do Codex/host.
- `portalbradesco` foi lido para preparar a integração de contratos, mas seu
  checkout não é gravável nesta sessão. Nenhuma escrita foi tentada nele.
- O checkpoint registrou `EPERM` para localhost nas portas 3000 e 4502.
  Variáveis de autenticação AEM não estavam presentes. Nenhuma nova conexão foi
  tentada nesta rodada.
- `config/permissions/codex-project.toml` continua candidato inativo e com rede
  desativada. Ativá-lo por si só não concede direitos negados pela política do
  host.

## Alteração mínima proposta ao operador do host/Codex

Aplicar ao **perfil/sessão local desta tarefa**, por meio do launcher ou painel
de permissões realmente suportado pelo Codex/host:

1. Acrescentar como raiz de workspace gravável somente
   `/Users/macos/Developer/iibr-fed-portalbradesco`.
2. Permitir somente o socket Unix exato fornecido pelo launcher em
   `MAESTRI_SOCKET`. A regra precisa acompanhar o caminho temporário atual e
   não pode autorizar `/tmp`, `/var/folders` ou sockets em geral.
3. Permitir conexões de saída somente para `127.0.0.1:3000` e
   `127.0.0.1:4502` (e os destinos IPv6 loopback equivalentes, se usados pelos
   serviços). Aplicar a restrição de portas no controle de rede do host. A
   lista de domínios do perfil Codex não filtra portas e, sozinha, não é
   suficiente.
4. Manter política de aprovação sob demanda e a filtragem de rede do host;
   não ativar full-access, não desligar sandbox e não ampliar raízes de escrita.

Esta proposta é reversível: remover o checkout adicional, a exceção do socket
exato e as duas regras de destino/porta devolve a sessão ao escopo anterior.
Não instalar o perfil candidato nem editar configuração global do usuário como
substituto dessa autorização do host.

## Ação exata necessária

No Codex que iniciou esta sessão, o operador do host precisa relançar ou retomar
esta mesma sessão/histórico usando um perfil de permissões **escopado** que
aplique os quatro itens acima; preservar o workspace e os checkpoints. Se a
interface de permissões não oferecer filtro por porta, solicitar ao operador
do host uma regra de rede local que permita apenas as portas 3000 e 4502. Não
selecionar “acesso total” nem desativar o sandbox. A sessão atual não expõe um
mecanismo autorizado para alterar permissões em tempo real.

Não é necessária ação adicional na interface Maestri para as três associações
já confirmadas pelo usuário. Depois da autorização de socket, a comunicação
deve usar os comandos oficiais `maestri list`, `maestri check` e `maestri ask`;
nenhum resultado de comunicação real foi produzido nesta sessão.

## Credenciais e aceitação AEM

Não compartilhar credenciais no chat. Disponibilizar as credenciais AEM locais
no ambiente seguro já adotado pelo portal/Maestri, expondo ao processo somente
as variáveis `MAESTRO_AEM_AUTHOR_URL`, `MAESTRO_AEM_USER` e
`MAESTRO_AEM_PASSWORD`. Não alterar senha nem persistir valores neste
repositório. Essa disponibilização é separada das permissões de socket/rede.
