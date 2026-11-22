import { appendFile } from 'node:fs/promises';
import { TransactionalGenerationLoader } from '../src/agent-runtime/transactional-loader/loader.ts';
const [root,log,mode,...token]=process.argv.slice(2),loader=new TransactionalGenerationLoader(root);
if(mode==='assert-stale'){
 try{await loader.assertCurrent({generationId:token[0],epoch:Number(token[1]),manifestDigest:token[2]});process.exit(1);}
 catch(e){if(e.message==='LOADER_STALE_PROCESS_FENCED')process.exit(0);throw e;}
}
await loader.withEpochLock(async pointer=>{
 const start=Date.now();
 await appendFile(log,JSON.stringify({phase:'start',pid:process.pid,start,generationId:pointer?.generationId})+'\n');
 if(mode==='crash')process.exit(77);
 await new Promise(resolve=>setTimeout(resolve,80));
 await appendFile(log,JSON.stringify({phase:'end',pid:process.pid,end:Date.now()})+'\n');
});
