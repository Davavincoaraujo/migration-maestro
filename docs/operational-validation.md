# Evidência de entrega local

Data: 17/11/2026. Runtime: Node 22.23.2. Não é homologação produtiva.

| Verificação | Resultado |
| --- | --- |
| npm run check | passou |
| npm run build | passou, JavaScript emitido em dist/ |
| npm test | 385 testes; 383 pass, 0 fail, 2 skip |
| git diff --check | passou |
| CLI compilada status | leu o job sem probes externos |
| Pipeline simulado de seis etapas | passou com artefatos/hashes em diretório temporário |
| Retomada e idempotência | sem novo ask; aceita resultado tardio; completo reutilizado offline |
| Falha/indisponibilidade | sem despacho ou sem reenvio, conforme recibo persistido |
| Revisão local | hash-bound, idempotente, não promove simulação |
| Next | plano validado em fixture; falta de dependências bloqueia IMPLEMENT |
| Maestri real | list exit 1, EPERM; nenhum ask |
| Next build real de código novo de agente | não executado: depende de Maestri/dependências |
| Portal/AEM/browser externos | não homologados; testes externos opt-in não executados na suíte final |

Job real novo: 4f07b36eae3079cd0131. Evidência sanitizada local:
.local-maestro/operations/4f07b36eae3079cd0131/environment-diagnostic.json.
Estado: blocked, executionMode=real, realAcceptanceVerified=false.

No shell original autorizado:

```sh
nvm use
npm run maestro:operate -- resume 4f07b36eae3079cd0131 --confirm-synthetic
npm run maestro:operate -- status 4f07b36eae3079cd0131
npm run maestro:operate -- resume 4f07b36eae3079cd0131 --confirm-synthetic
```

Aceite mínimo exige: inventory.json válido, resultado v2 com job/task corretos,
hashes verificados, checkpoint ANALYZE/REVIEW persistido e segunda retomada sem
novas tentativas de envio. Depois disso o operador revisa os artefatos e registra
aceite local. Um terminal conectado ou ACK isolado não satisfaz o critério.
