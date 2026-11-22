import { RuntimeGenerationManager } from './agent-runtime/generations/manager.js';
import { bootstrapNativeConfig,loadNativeConfig,requireConfiguredProviders } from './agent-runtime/native/config.js';
import { serveNativeRuntimes } from './agent-runtime/native/service.js';
import { nativeRequest } from './agent-runtime/native/client.js';
try {
  const [command,...args]=process.argv.slice(2);const flags:Record<string,string>={};let authorized=false;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--authorize-session-creation'&&!authorized){authorized=true;continue;}
    if(!['--config','--transport','--agent','--generation-root'].includes(args[i])||flags[args[i]]||!args[i+1])throw Error('NATIVE_ARGUMENT_INVALID');
    flags[args[i]]=args[++i];
  }
  if(!flags['--config']||!['init','serve','prepare'].includes(command))throw Error('USAGE_RUNTIME_INIT_SERVE_PREPARE_CONFIG');
  if(flags['--generation-root']&&command!=='serve')throw Error('GENERATION_ROOT_ONLY_FOR_SERVE');
  if(command==='init')console.log(JSON.stringify(await bootstrapNativeConfig(flags['--config']),null,2));
  else {
  const config=await loadNativeConfig(flags['--config']);requireConfiguredProviders(config);
  if(command==='serve') {
    const service=await serveNativeRuntimes(config,{generationManager:flags['--generation-root']?new RuntimeGenerationManager(flags['--generation-root']):undefined});console.log('NATIVE_SERVICE_READY');
    let stopping=false;const close=()=>{if(stopping)return;stopping=true;void service.close();};process.once('SIGINT',close);process.once('SIGTERM',close);
  }else {
    if(!authorized||!flags['--transport']||!flags['--agent'])throw Error('NATIVE_SESSION_CREATION_AUTHORIZATION_REQUIRED');
    const controller=new AbortController();
    console.log(JSON.stringify(await nativeRequest({id:flags['--transport'],socketPath:config.socketPath,publicKey:'',moduleDigest:''},'prepare',{agentId:flags['--agent'],authorizeSessionCreation:true},controller.signal),null,2));
  }
  }
}catch(e){console.error((e as NodeJS.ErrnoException).code==='ENOENT'?'NATIVE_INSTALLATION_INCOMPLETE: execute init --config após configurar os provedores; confirme os caminhos locais.':(e as NodeJS.ErrnoException).code==='ECONNREFUSED'?'NATIVE_SERVICE_UNAVAILABLE: inicie serve --config antes de prepare.':e instanceof Error?e.message:'NATIVE_RUNTIME_FAILED');process.exitCode=1;}
