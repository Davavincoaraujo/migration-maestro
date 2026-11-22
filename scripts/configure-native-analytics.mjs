// Run with node --import tsx. Configuration only: never starts provider processes.
import { readFile, lstat, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { validateNativeConfig, nativeImplementationDigest } from '../src/agent-runtime/native/service.ts';
import { digest } from '../src/agent-runtime/contracts.ts';

const path = join(homedir(), '.migration-maestro/runtime.json');
const original = await readFile(path);
const info = await lstat(path);
if (!info.isFile() || info.isSymbolicLink()) throw Error('REGULAR_CONFIG_REQUIRED');
const config = JSON.parse(original.toString());
validateNativeConfig(config);
const desired = {
  id: 'codex-local', provider: 'codex',
  executable: '/Users/macos/.nvm/versions/node/v22.23.2/bin/codex',
  roles: [{ agentId: 'Analytics', modelId: 'gpt-6-luna' }]
};
const candidate = structuredClone(config);
const existing = candidate.providers.find(p => p.id === desired.id);
if (existing) {
  if (existing.provider !== desired.provider || existing.executable !== desired.executable)
    throw Error('EXISTING_PROVIDER_CONFLICT');
  const role = existing.roles.find(r => r.agentId === 'Analytics');
  if (role && role.modelId !== 'gpt-6-luna') throw Error('EXISTING_MODEL_CONFLICT');
  if (!role) existing.roles.push(desired.roles[0]);
} else {
  if (candidate.providers.some(p => p.provider === 'codex'))
    throw Error('EXISTING_CODEX_PROVIDER_REQUIRES_RECONCILIATION');
  candidate.providers.push(desired);
}
validateNativeConfig(candidate);
const implementation = await nativeImplementationDigest();
let installed;
try {
  installed = JSON.parse(await readFile(join(config.stateDirectory, 'team-adapters.json'), 'utf8'));
  console.log(JSON.stringify({ installedDigests: installed.adapters.map(a => a.moduleDigest),
    currentDigest: digest({ implementation, config }),
    proposedDigest: digest({ implementation, config: candidate }) }));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  console.log('No installed team-adapters.json or installed digest.');
}
if (installed) {
  if (digest(config) !== digest(candidate) ||
      installed.adapters.some(a => a.moduleDigest !== digest({ implementation, config })))
    throw Error('NATIVE_INSTALLATION_CHANGED_REVIEW_REQUIRED');
}
if (digest(config) === digest(candidate)) {
  console.log('Configuration already matches; unchanged.');
} else {
  // Stop on partial installation too; do not rebind an existing identity.
  for (const name of ['signing-key.pem', 'service.lock']) {
    try { await lstat(join(config.stateDirectory, name)); }
    catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    throw Error('PARTIAL_OR_ACTIVE_INSTALLATION_REQUIRES_RECONCILIATION');
  }
  const backup = path + '.backup-' + randomUUID();
  await writeFile(backup, original, { flag: 'wx', mode: 0o600 });
  console.log('Private backup: ' + backup);
  if (!(await readFile(path)).equals(original)) throw Error('CONFIG_CHANGED_CONCURRENTLY');
  const staging = path + '.pending-' + randomUUID();
  await writeFile(staging, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (!(await readFile(path)).equals(original)) throw Error('CONFIG_CHANGED_CONCURRENTLY');
  await rename(staging, path);
  validateNativeConfig(JSON.parse(await readFile(path, 'utf8')));
  console.log('Configured Analytics; no sessions created.');
}
