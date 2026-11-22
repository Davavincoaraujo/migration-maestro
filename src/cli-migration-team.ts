import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadTeamRegistry, builtInRuntimeSupport, inspectTeamCoordination } from './agent-runtime/adapters.js';
import { authorizationTemplate, readTeamSource, runMigrationTeam } from './autopilot/migration-team.js';
import { teamStages, type TeamStage } from './agent-runtime/contracts.js';

try {
  const [command,...args]=process.argv.slice(2);
  if(!['inspect','run'].includes(command))throw Error('USAGE_TEAM_INSPECT_OR_RUN');
  const flags:Record<string,string>={};
  for(let i=0;i<args.length;i+=2) {
    if(!['--job','--run-id','--adapter-config','--authorization','--pause-after'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||flags[args[i]])throw Error('TEAM_ARGUMENT_INVALID');
    flags[args[i]]=args[i+1];
  }
  const jobId=flags['--job'],runId=flags['--run-id']??'first-authorized-run';
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(runId))throw Error('TEAM_RUN_ID_INVALID');
  if(flags['--pause-after']&&!teamStages.includes(flags['--pause-after'] as TeamStage))throw Error('TEAM_PAUSE_INVALID');
  const registry=await loadTeamRegistry(flags['--adapter-config']);
  await registry.refresh();
  if(command==='inspect') {
    const source=jobId?await readTeamSource(jobId):undefined;
    const report=registry.report();
    console.log(JSON.stringify({...report,builtInRuntimeSupport:builtInRuntimeSupport.map(item=>({...item,configured:registry.transports.some(t=>t.id===item.id),...(registry.transports.some(t=>t.id===item.id)?{reason:'NATIVE_SESSION_OR_CAPABILITY_QUALIFICATION_REQUIRED'}:{})})),coordination:await inspectTeamCoordination(),
      ...(source?{jobId:source.jobId,sourceDigest:source.sha256,authorizationTemplate:authorizationTemplate(source,registry,runId)}:{})},null,2));
    if(Object.values(report.routes).some(r=>!r.session))process.exitCode=2;
  } else {
    if(!jobId||!flags['--authorization'])throw Error('TEAM_EXPLICIT_AUTHORIZATION_REQUIRED');
    const source=await readTeamSource(jobId),authorization=JSON.parse(await readFile(flags['--authorization'],'utf8'));
    console.log(JSON.stringify(await runMigrationTeam({source,registry,authorization,runId,
      runDirectory:join(resolve('.local-maestro/team-runs'),jobId,runId),pauseAfter:(flags['--pause-after']??'ANALYZE') as TeamStage}),null,2));
  }
} catch(e) {
  const reason=e instanceof Error&&e.cause instanceof Error?e.cause.message:e instanceof Error?e.message:'TEAM_FAILED';
  console.error(reason);process.exitCode=1;
}
