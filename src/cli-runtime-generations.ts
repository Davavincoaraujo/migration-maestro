import { readFile } from 'node:fs/promises';
import { admissionRequest } from './agent-runtime/native/admission-client.js';
import { RuntimeGenerationManager } from './agent-runtime/generations/manager.js';
import { TransactionalGenerationLoader } from './agent-runtime/transactional-loader/loader.js';

try {
  const [command,...args]=process.argv.slice(2);
  const usage='Usage: node --import tsx src/cli-runtime-generations.ts <initialize|prepare|status|admission-status|recover|loader-status|recover-lock|request-drain|mark-ready|activate|request-rollback|rollback> --root ABSOLUTE_PATH [--config FILE --approver-key FILE | --candidate FILE | --approval FILE | --report FILE | --lock LOCK_NAME --authorization FILE] [--sequence N]';
  if(command==='--help'){console.log(usage);}
  else {
    const allowed:Record<string,string[]>={
      initialize:['--config','--approver-key'],prepare:['--candidate','--sequence'],status:[],'admission-status':[],
      recover:['--sequence'],'loader-status':[],'recover-lock':['--lock','--authorization','--manager-root'],
      'request-drain':['--sequence','--approval'],'mark-ready':['--sequence','--report'],
      activate:['--sequence'],'request-rollback':['--sequence'],rollback:['--sequence','--approval']
    };
    if(!Object.hasOwn(allowed,command))throw Error(usage);
    const flags:Record<string,string>={};
    for(let i=0;i<args.length;i+=2){
      if(!['--root',...allowed[command]].includes(args[i])||flags[args[i]]||!args[i+1])throw Error(usage);
      flags[args[i]]=args[i+1];
    }
    for(const f of ['--root',...allowed[command]])if(!flags[f])throw Error(usage);
    const sequence=Number(flags['--sequence']);
    if(flags['--sequence']&&!/^(0|[1-9][0-9]*)$/.test(flags['--sequence']))throw Error('GENERATION_SEQUENCE_INVALID');
    const manager=new RuntimeGenerationManager(flags['--root']);
    const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
    let result;
    switch(command){
      case 'initialize':result=await manager.initialize(flags['--config'],await readFile(flags['--approver-key'],'utf8'));break;
      case 'prepare':result=await manager.prepare(await json(flags['--candidate']),sequence);break;
      case 'status':result=await manager.status();break;
      case 'recover':result=await manager.recover(sequence);break;
      case 'loader-status':result=await new TransactionalGenerationLoader(flags['--root']).inspectRecovery();break;
      case 'recover-lock':{
        if(!['epoch.lock','activation.lock'].includes(flags['--lock']))throw Error('RUNTIME_LOCK_NAME_INVALID');
        const authorization=await json(flags['--authorization']);
        if(authorization?.payload?.lockName!==flags['--lock'])throw Error('RUNTIME_LOCK_RECOVERY_AUTHORIZATION_INVALID');
        result=await new TransactionalGenerationLoader(flags['--root']).recoverOrphanLock(authorization,
          await new RuntimeGenerationManager(flags['--manager-root']).trustedApprovalPublicKey());break;
      }
      case 'admission-status':result=await admissionRequest(await manager.runtimeEndpoint(),'admission-status',{},AbortSignal.timeout(20000));break;
      case 'request-drain':result=await admissionRequest(await manager.runtimeEndpoint(),'drain',
        {sequence,approval:await json(flags['--approval'])},AbortSignal.timeout(20000));break;
      case 'mark-ready':result=await manager.markReady(sequence,await json(flags['--report']));break;
      case 'activate':result=await manager.activate(sequence);break;
      case 'request-rollback':result=await manager.requestRollback(sequence);break;
      case 'rollback':result=await manager.rollback(sequence,await json(flags['--approval']));break;
    }
    console.log(JSON.stringify(result,null,2));
  }
}catch(e){console.error(e instanceof Error?e.message:'GENERATION_OPERATION_FAILED');process.exitCode=1;}
