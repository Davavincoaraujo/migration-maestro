# Descoberta pública por URL

Comando no repositório: `npm run maestro -- migrate <URL>`.
O pacote também registra o executável `maestro` em `bin/maestro.mjs` para
instalações que exponham os executáveis do pacote.

A primeira página aprovada é
`https://banco.bradesco/html/classic/atendimento/atendimento.shtm`.
A descoberta usa um GET HTTPS, exige DNS IPv4 público, não segue redirects,
aceita apenas HTML até 2 MB e não busca recursos ou links. Scripts são analisados
apenas como marcadores de integrações; nunca executados. HTML bruto não é gravado.

O job determinístico fica em `.local-maestro/public-migrations/<jobId>` e contém
manifesto, workspace privado vazio, plano, checkpoint, status e resumo de evidência.
Repetir URL com job concluído retorna os mesmos registros sem novo GET. Lock ativo
exige reconciliação operacional. Falha de origem persiste como blocked; retomar
essa captura requer novo fluxo de reconciliação, nunca limpar recibos/checkpoints.

O Model Router recebe somente candidatos de sessão verificados. Declarações locais
de papel/modelo aparecem separadas como candidatos e não tornam uma rota executável.
A amostra atual deixa Analytics, UE-Pattern e Hermes blocked porque a descoberta
falhou e não há sessão/modelo/capacidade/dispatch atestados. Validator permanece
sem candidato declarado. Nenhuma tarefa foi entregue aos agentes.

Execução validada em 19/11/2026: o sandbox bloqueou DNS com
`PUBLIC_SOURCE_DNS_UNAVAILABLE`. O job `6c23a49df3f6b1798231` registra esse
bloqueio. No shell com acesso público autorizado, execute novamente o comando;
a política de idempotência não repetirá GET no mesmo job. Uma tentativa após falha
exige o fluxo de reconciliação, que deve preservar a evidência da falha original.

A saída não autoriza AEM, edição, envio de formulários, chat, transações, publicação
ou deploy. Contratos AEM/React e suporte real de Universal Editor precisam ser
verificados no projeto destino antes de propor reutilização.
