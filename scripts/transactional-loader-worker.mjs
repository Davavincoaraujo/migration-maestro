import { readFile } from 'node:fs/promises';
import { TransactionalGenerationLoader } from '../src/agent-runtime/transactional-loader/loader.ts';
const [root,approvalPath,publicKey]=process.argv.slice(2);
const loader=new TransactionalGenerationLoader(root);
const approval=JSON.parse(await readFile(approvalPath,'utf8'));
const fence={acquireExclusive:work=>work(),assertReady:async()=>{}};
try {
  const pointer=await loader.activate(approval,publicKey,approval.payload.sequence,fence,
    async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
  process.stdout.write(JSON.stringify({ok:true,pointer}));
} catch(e) {process.stderr.write(e.message);process.exitCode=1;}
