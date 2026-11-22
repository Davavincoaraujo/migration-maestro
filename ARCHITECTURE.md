# Arquitetura operacional

## Caminho principal

CLI `maestro:operate` → `operational-run` → `central-controller` →
`dispatch-executor` → CLI oficial Maestri → artefatos → validação/hashes →
`FileCheckpointStore` → revisão local.

Há um controlador sequencial, arquivos JSON atômicos e locks exclusivos. Não há
novo scheduler, serviço de descoberta ou banco distribuído. O núcleo antigo
`core/workflow` e os pipelines anteriores permanecem para compatibilidade, sem
serem a entrada operacional recomendada.

Analytics recebe análise e validação; UE-Pattern recebe mapping; Hermes recebe
planejamento e implementação. O Migration Orchestrator controla dependências,
políticas, evidências e revisão. VALIDATE não usa o agente que implementou.

## Roteamento A/B/C

- A: a função de política aceita evidência fresca de um adaptador oficial confiável.
  Não existe adaptador instalado que obtenha modelo/entitlement por sessão; Wire
  e rodapé não preenchem esse contrato. Configuração nunca ativa A.
- B: configuração versionada declara agente, provider, modelo esperado e capacidades.
  Antes de despachar, list/check confirmam conectividade e um desafio isolado testa
  a interface de capacidade. Isso autoriza somente o escopo sintético especificado.
- C: provider/modelo desconhecidos, capacidades declaradas e prova operacional,
  restritos a LOW. MEDIUM é aceito somente em B e com política compatível.

HIGH/CRITICAL ficam bloqueados por aprovação/evidência. Não há downgrade automático.
`modelObserved`, `identityVerified`, `availabilityVerified` são distintos de
`operationallyEligible`; a disponibilidade da sessão permanece unknown em B/C.
O perfil registrado em rotas degradadas é requisito da tarefa, não qualidade
verificada do modelo. Custos desconhecidos não satisfazem teto monetário.

## Durabilidade e confiança

Cada job possui ID hexadecimal de 20 caracteres; cada tarefa, UUID. Input, política
e modo real/simulado são persistidos. A solicitação contém o prompt exato e é
vinculada ao recibo por SHA-256. Um arquivo de tentativa exclusivo precede ask;
não há repetição automática de envio. Timeout significa entrega desconhecida.
Retomada consulta a mesma tarefa e aceita resultado tardio, mesmo após esgotar polls.

Resultados novos exigem versão 2, job/task/stage, manifesto de arquivos e hashes.
Workflows validam semântica além dos hashes. O checkpoint só avança após isso;
reutilização verifica novamente os bytes. Hashes não são assinaturas de autoria.
A máquina e os diretórios locais precisam ser confiáveis. As instruções de escopo
não substituem isolamento do sistema operacional dos agentes.

O desafio de capacidade prova execução de um exercício pequeno, não competência
geral nem identidade da sessão do provedor. A prova vale por 24 horas para novos
despachos e é vinculada ao job, declaração, nonce e artefato. Sessões não são
reiniciadas nem modelos trocados pelo coordenador.

Locks sobreviventes a crash exigem reconciliação humana. Não há roubo automático
de lock. JSON usa rename atômico; não se promete transação distribuída nem garantia
contra perda física de disco. Envio é no máximo uma vez, não exatamente uma vez.

## Next.js e AEM

`task` valida inventário mínimo; `pipeline` testa seis etapas com HTML sintético;
`next` reaproveita o workflow React/Next com arquivos App Router/CSS Modules,
contratos mapping/plan, TypeScript, SSR e build. A entrada nova desativa a falha
intencional e a correção forçada do piloto experimental. Dependências locais são
verificadas antes do despacho IMPLEMENT. Navegador/visual/HTTP não são presumidos.

Integração corporativa existente: descoberta de páginas, definições/resourceType,
mapper/exporter, model.json, templates/policies, detecção de lacunas, manifesto de
implementação e escrita AEM create-only autorizada. Fica fora do aceite sintético.
A operação corporativa exige checkout isolado e autorização específica; código
experimental não é convertido em autorização pela política B/C.

## Compatibilidade

Não houve migração/apagamento de checkpoints históricos. Entradas antigas mantêm
contratos legacy; novos jobs usam resultados v2. Novo estado fica em
`.local-maestro/operations`, separado dos jobs históricos. Fontes anteriores à
rodada foram copiadas para `.local-maestro/maintenance-backups`.

Os adaptadores simulados ficam em tests/fixtures, nunca carregados por configuração
produtiva. Testes anteriores que inferiam available do rodapé receberam injeção
explícita de descoberta simulada. Nenhum caminho produtivo recebeu essa inferência.
