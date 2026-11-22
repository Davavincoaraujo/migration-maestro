import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { initializeNativeService, validateNativeConfig, type NativeServiceConfig } from './service.js';

export async function loadNativeConfig(path:string):Promise<NativeServiceConfig> {
  let raw:string;
  try { raw=await readFile(path,'utf8'); }
  catch(e){
    if((e as NodeJS.ErrnoException).code==='ENOENT')throw Error(`NATIVE_CONFIG_MISSING: ${path}. Execute init --config com esse caminho primeiro.`);
    throw e;
  }
  try {
    const config:unknown=JSON.parse(raw);validateNativeConfig(config);return config;
  }catch{
    throw Error(`NATIVE_CONFIG_INVALID: ${path}. Revise version, caminhos absolutos, workspaceId e providers (roles/modelId e executable do Codex). O arquivo foi preservado.`);
  }
}

export function requireConfiguredProviders(config:NativeServiceConfig) {
  if(!config.providers.length)throw Error('NATIVE_CONFIG_INCOMPLETE: configure providers com roles e modelId explicitamente escolhidos antes de serve/prepare; depois execute init novamente.');
}

export async function bootstrapNativeConfig(path:string) {
  const absolute=resolve(path),stateDirectory=join(dirname(absolute),'runtime');
  const initial:NativeServiceConfig={version:1,stateDirectory,socketPath:join(stateDirectory,'runtime.sock'),workspaceId:'migration-team-local',providers:[]};
  validateNativeConfig(initial);
  await mkdir(dirname(absolute),{recursive:true,mode:0o700});
  let created=false;
  try {
    await writeFile(absolute,JSON.stringify(initial,null,2)+'\n',{flag:'wx',mode:0o600});created=true;
  }catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  const config=await loadNativeConfig(absolute);
  // Do not bind an empty bootstrap to installation artifacts: the operator must
  // first select providers/models. No provider code or session is started here.
  if(!config.providers.length)return {configPath:absolute,created,status:'configuration-required'};
  return {configPath:absolute,created,status:'initialized',...await initializeNativeService(config)};
}
