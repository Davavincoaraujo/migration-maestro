# Continuação Next.js do piloto público

Situação: **bloqueada antes da implementação Next.js**. Piloto de origem: `20261115000000000002`. O HTML anterior chegou a REVIEW; isso não significa aprovação nem validação de uma aplicação Next.js.

Foram lidos `docs/central-autopilot.md`, `docs/communication-validation.md`, o contrato de `publicPilotWorkflow` e os artefatos do piloto. O controlador existente foi preservado. Não foi criado outro orquestrador, reiniciado o job ou alterado checkpoint, recibo, evidência ou resultado concluído.

## Execução e bloqueios

`maestri list` e os pedidos explícitos a Analytics, UE-Pattern e Hermes via `maestri ask` retornaram código 1: `Connection failed: Operation not permitted`. Entrega não confirmada; não há inventário aprovado novo, mapeamento novo ou implementação Hermes recebida. A política atual proíbe elevação de permissões. A orientação de executar fora do sandbox presente na documentação não foi usada para contornar essa restrição.

A resolução de módulos neste workspace não encontrou Next.js, React, React DOM, Playwright, Playwright Core, axe-core ou @axe-core/playwright. Não houve instalação. Não foram executados build Next.js, typecheck de uma app Next.js, testes de app, auditoria automatizada de acessibilidade ou novas capturas. Dependências e execução local precisam estar disponíveis em contexto autorizado para concluir esses gates.

## Evidência preservada e inventário recuperado

O relatório local `nextjs-parity.json` contém hashes dos cinco artefatos-base, diagnósticos por especialista, critérios de aceite, arquivos alterados e hashes/dimensões das quatro capturas anteriores. `continuation-inventory.json` recupera diretamente de `source.html` os textos completos, headings, links, referências de mídia, classes responsivas e metadados públicos das sete seções. Essa extração offline é **pendente de revisão**, não uma resposta Analytics aprovada. Nenhum script da fonte foi executado.

As capturas anteriores são da origem e do piloto HTML: desktop 1440×3456 / 1440×5220 e mobile 390×4409 / 390×7513. Não são capturas Next.js nem uma comparação pixel a pixel. A diferença de altura é apenas um indício de apresentação diferente, não uma métrica suficiente de fidelidade.

A revisão anterior identificou descrições de seis produtos e de um serviço omitidas, alerta integral contra impostores ausente, navegação pública substituída por referências inertes e widgets sem comportamento equivalente. A extração nova permite localizar a copy omitida para revisão. Não decide entre as duas alegações imobiliárias divergentes. Os nove placeholders permanecem; QR não decodificados, vídeo/legendas e mídias não verificados. Nenhum placeholder foi substituído sem evidência.

As sete linhas de `mapping.json` continuam `candidateId: null`, `confidence: low`, `equivalence: none`. Isso indica falta de equivalência comprovada neste piloto, não ausência de componentes possíveis. Sem dados privados, apenas componentes públicos verificáveis ou implementações locais explicitamente identificadas poderão ser avaliados. Não foram inventados contratos AEM, modelos JCR ou configurações Universal Editor.

## Evidências persistidas

`src/autopilot/nextjs-parity.ts` lê o relatório opcional, limita tamanho, aceita somente enums e códigos de lacunas conhecidos, rejeita links simbólicos nos arquivos lidos e verifica hashes dos artefatos-base. `src/autopilot/progress-reader.ts` extrai status validado e seguro dos checkpoints para consumidores headless. Nenhum dos módulos despacha tarefas ou expõe prompts, evidência bruta ou caminhos privados. Ausência ou invalidez do relatório não autoriza prontidão.

Maestri.app é a interface operacional; checkpoints são os registros de evidência local e não equivalem a uma aprovação humana.

## Verificação executada

- `npm run check`: passou para o repositório Maestro.
- `node --import tsx --test tests/nextjs-parity.test.ts`: passou; verifica bloqueios separados do piloto, filtragem, rejeição de dados maliciosos, prontidão inconsistente, identidade errada, hash alterado e symlink.
- `node --import tsx --test tests/*.test.ts`: 259 testes, 245 passaram, 13 falharam por `listen EPERM` ao abrir loopback e 1 teste de navegador foi ignorado por ausência de `MAESTRO_ANALYTICS_DIR`. A suíte não passou integralmente.
- Os relatórios antigos de build estático e checks Chromium permanecem somente como evidência histórica. Nenhum resultado foi promovido a teste Next.js, conformidade WCAG ou paridade visual.

## Critérios para revisão humana da implementação

1. Receber e revisar o inventário Analytics completo, incluindo copy omitida, metadados, navegação e escopo explícito de chrome global.
2. Receber mapeamento UE-Pattern distinguindo prova pública de sugestão, com lacunas; não consultar dados corporativos privados.
3. Hermes produzir aplicação Next.js isolada após aprovação desses insumos. Preservar URLs reais, conteúdo, metadados e semântica; exceções de escopo devem ser explícitas. Não reutilizar automaticamente referências locais como substituto dos destinos originais.
4. Executar build Next.js, typecheck e testes de comportamento com dependências fixadas e comandos/saídas registrados.
5. Capturar origem e app em desktop/mobile quando acessíveis; vincular comparação estrutural, textual, de navegação e responsiva aos hashes atuais. Inspecionar capturas, não deduzir paridade só pela cobertura de seções.
6. Executar testes automatizados de acessibilidade e registrar resultados, mantendo revisão manual de teclado, leitor de tela, contraste, zoom e semântica. Resultado automatizado não declara WCAG.
7. Registrar evidências nos checkpoints e submetê-las à revisão humana em Maestri.app. Publicação AEM, push e merge permanecem proibidos.

Arquivos desta rodada: `src/autopilot/nextjs-parity.ts`, `src/autopilot/progress-reader.ts`, `tests/nextjs-parity.test.ts`, este documento e os dois JSON locais mencionados. Nenhum arquivo da implementação anterior foi alterado.

Para retomar, é necessário um contexto que permita IPC oficial Maestri e sockets locais, além das dependências de app/browser. Esta sessão não pode solicitar nem executar elevação. A implementação Next.js ainda não está pronta para revisão humana; o diagnóstico e os critérios estão disponíveis para revisão.
