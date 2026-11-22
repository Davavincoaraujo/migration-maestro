// Read-only IPC observation; never calls prepare, send or provider query.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadNativeConfig } from '../src/agent-runtime/native/config.ts';
import { nativeImplementationDigest } from '../src/agent-runtime/native/service.ts';
import { nativeTransportClient } from '../src/agent-runtime/native/client.ts';
import { digest } from '../src/agent-runtime/contracts.ts';
import { assessNativeObservation } from '../src/agent-runtime/observe-native.ts';

try {
  const config = await loadNativeConfig(join(homedir(), '.migration-maestro/runtime.json'));
  const installed = JSON.parse(await readFile(join(config.stateDirectory, 'team-adapters.json'), 'utf8'));
  const matches = installed.adapters.filter(a => a.id === 'codex-local');
  const expectedDigest = digest({ implementation: await nativeImplementationDigest(), config });
  if (matches.length !== 1 || matches[0].moduleDigest !== expectedDigest ||
      matches[0].socketPath !== config.socketPath || matches[0].kind !== 'native-service')
    throw Error('NATIVE_INSTALLATION_CHANGED_REVIEW_REQUIRED');
  const provider = config.providers.find(p => p.id === 'codex-local');
  if (provider?.provider !== 'codex' ||
      !provider.roles.some(r => r.agentId === 'Analytics' && r.modelId === 'gpt-6-luna'))
    throw Error('NATIVE_EXPECTED_ROLE_NOT_CONFIGURED');
  const client = nativeTransportClient(matches[0]);
  try {
    const values = await client.observations(AbortSignal.timeout(20000));
    const result = assessNativeObservation(values, {
      sessionId: '01a1f928-e639-7811-a40d-01817d1ac362',
      agentId: 'Analytics', modelId: 'gpt-6-luna'
    });
    console.log(JSON.stringify({ transportId: 'codex-local', installedDigest: expectedDigest, ...result }, null, 2));
    if (!result.confirmed) process.exitCode = 2;
  } finally { client.close(); }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
