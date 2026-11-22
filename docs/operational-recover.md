# Recuperação local do probe Analytics

Comando (exige nova autorização do operador para o job real):

```sh
npm run maestro:operate -- recover ad3b6e8aaeb3e22001ab --probe-only --confirm-synthetic
```

Só aceita operação pipeline com `planOnly: true`, checkpoint `failed` sem etapas concluídas e probe Analytics válido. Reutiliza `reconcileOperational` e seus validadores de política, binding, nonce, resultado e despacho. Exige recibo de despacho existente. Não chama transporte, workflow, resume ou escritor de checkpoints.

Publica `analytics-probe-recovery.json` na raiz do job. Contrato v1:

- `kind: local-reconciled-probe`, `jobId`, `probeId`, `agentId`, `taskId`, `nonce`;
- política original e `policyDigest`, `requestDigest`, `routeDigest`, `resultDigest`;
- `files`: caminhos relativos e SHA-256 dos bytes de todos os arquivos originais;
- `originalDispatch`: outcome e deliveryVerified originais;
- `planOnly`, `confirmedSynthetic`, `humanAuthorizationRequired`: true;
- `deliveryAuthenticated`, `authorshipAuthenticated`, `analyzeCompleted`, `resendAuthorized`, `pipelineAdvanceAuthorized`: false.

Os digests de contratos usam a serialização existente `dispatchDigest`; `files` usa os bytes integrais. Nenhum recibo, proof, status ou checkpoint é substituído. O registro não é consumido como OperationalProof e não conclui ANALYZE. O job indicado continua blocked, pelo motivo histórico AMBIGUOUS_DISPATCH_RECONCILIATION_REQUIRED.

A escrita usa os locks existentes de operação e controller, arquivo temporário exclusivo fora do job, fsync, revalidação completa imediatamente antes da publicação, hard link atômico sem substituição e fsync do diretório. Repetições com as mesmas evidências retornam o mesmo registro; alterações ou conflitos bloqueiam. Falhas comuns limpam apenas o temporário e os locks próprios. Encerramento abrupto pode deixar locks/temporário: não são removidos automaticamente nem interpretados como sucesso; exigem inspeção manual. Se ocorrer após publicação, o registro já estará inteiro, e uma repetição após inspeção verificará sua igualdade.

Limites: arquivos locais não autenticam entrega ou autoria. O dry-run anterior não persiste uma âncora de hashes; a recuperação reexecuta os validadores e ancora os bytes presentes, não comprova igualdade com uma execução histórica cujo relatório não foi guardado. Locks coordenam os escritores existentes, mas não impedem alterações por processos externos que os ignorem; não há transação de filesystem sobre todos os arquivos. O registro permite verificar alterações posteriores, mas não autoriza continuação. Requer filesystem local com hard links e fsync de diretórios.
