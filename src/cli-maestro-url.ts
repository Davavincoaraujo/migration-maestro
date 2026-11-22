import { preparePublicMigrationJob } from './autopilot/public-migration-job.js';

export async function runMaestroUrl(args:string[],options:{prepare?:typeof preparePublicMigrationJob}={}) {
  if(args.length!==2||args[0]!=='migrate')throw Error('USAGE: maestro migrate <URL>');
  const result=await (options.prepare??preparePublicMigrationJob)(args[1]);
  return {...result,command:'maestro migrate <URL>',execution:'read-only discovery; agent tasks planned only'};
}
if(process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href) {
  try {const result=await runMaestroUrl(process.argv.slice(2));process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.state!=='prepared-blocked')process.exitCode=2;}
  catch(error){const message=error instanceof Error?error.message:'MIGRATION_FAILED';process.stderr.write((/^[A-Z0-9_ <>-]{1,120}$/.test(message)?message:'MIGRATION_FAILED')+'\n');process.exitCode=2;}
}
