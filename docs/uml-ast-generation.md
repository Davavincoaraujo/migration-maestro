# UML de classes extraído do TypeScript

A aba `/diagrams?kind=classes` agora lê, **em cada requisição**, os arquivos TypeScript locais do projeto usando a API de AST do compilador `typescript`. Não executa o código-fonte, não usa serviços externos e não faz escrita no AEM.

O extrator em `src/workbench/uml-ast.ts` lê as declarações reais de interfaces, classes e o tipo de união `MigrationAgentRole`. Atributos, métodos, tipos, modificadores de visibilidade e cláusulas `implements` vêm das declarações do repositório. As associações são inferidas apenas quando um atributo referencia diretamente outro tipo conhecido; multiplicidade de array é `0..*` e referências singulares recebem `0..1` como notação conservadora, **não como garantia de opcionalidade**.

O escopo é intencionalmente restrito a sete contratos centrais nos arquivos `agent-graph.ts`, `local-agent-executor.ts` e `checkpoint-runner.ts`. Para incluir outros contratos, expanda a lista de nomes e caminhos no extrator. O layout é SVG determinístico com caixas separadas em nome, atributos e operações. Não é um editor gráfico e não infere dependências dinâmicas, chamadas de método, cardinalidades de negócio ou herança não declarada.

Execute `npm run check && npm test` e acesse `http://127.0.0.1:4177/diagrams?kind=classes`.
