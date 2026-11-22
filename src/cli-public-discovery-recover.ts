import { recoverPublicDiscovery } from './autopilot/public-discovery-recovery.js';
try {
  const [id,...args]=process.argv.slice(2);
  let attemptId='',snapshot:string|undefined,authorizeRetry=false;
  const seen=new Set<string>();
  for(let i=0;i<args.length;i++) {
    const flag=args[i];if(seen.has(flag))throw Error('PUBLIC_RECOVERY_ARGUMENT_INVALID');seen.add(flag);
    if(flag==='--authorize-retry')authorizeRetry=true;
    else if(flag==='--attempt-id'&&args[i+1])attemptId=args[++i];
    else if(flag==='--snapshot'&&args[i+1])snapshot=args[++i];
    else throw Error('PUBLIC_RECOVERY_ARGUMENT_INVALID');
  }
  const result=await recoverPublicDiscovery(id,{attemptId,snapshot,authorizeRetry});
  console.log(JSON.stringify(result,null,2));
  if(result.sourceDiscovery!=='completed')process.exitCode=1;
} catch(e) {console.error(e instanceof Error?e.message:'PUBLIC_RECOVERY_FAILED');process.exitCode=1;}
