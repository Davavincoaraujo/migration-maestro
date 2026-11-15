import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { RunRecord, RunState, TaskRecord, TaskState } from "../contracts/index.js";
const validId = /^[a-zA-Z0-9_-]{1,100}$/;
const runStates = new Set<RunState>(["pending","running","review_required","completed","failed","cancelled"]);
const taskStates = new Set<TaskState>(["pending","ready","running","review_required","completed","failed","blocked","cancelled"]);
function validateRecord(input: unknown): RunRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVALID_RUN_RECORD");
  const v=input as Partial<RunRecord>;
  if (typeof v.id!=="string" || !validId.test(v.id) ||
      typeof v.workflowId!=="string" || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(v.workflowId) ||
      !Number.isSafeInteger(v.workflowVersion) || (v.workflowVersion??0)<1 ||
      !runStates.has(v.state as RunState) || !Array.isArray(v.tasks) || v.tasks.length>100 ||
      typeof v.createdAt!=="string" || !Number.isFinite(Date.parse(v.createdAt)) ||
      typeof v.updatedAt!=="string" || !Number.isFinite(Date.parse(v.updatedAt))) throw new Error("INVALID_RUN_RECORD");
  const seen=new Set<string>();
  for (const t of v.tasks as TaskRecord[]) {
    if (!t || typeof t.taskId!=="string" || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(t.taskId) ||
        seen.has(t.taskId) || !taskStates.has(t.state) ||
        !Number.isSafeInteger(t.attempt) || t.attempt<0 ||
        !Array.isArray(t.evidenceIds) || t.evidenceIds.length>1000 ||
        !t.evidenceIds.every(id=>typeof id==="string"&&validId.test(id))) throw new Error("INVALID_RUN_RECORD");
    seen.add(t.taskId);
  }
  return v as RunRecord;
}
/** Local-only run snapshots. One writer per run; no concurrent-write guarantees. */
export class FileRunStore {
  constructor(private readonly directory: string) {}
  private path(id: string): string {
    if (!validId.test(id)) throw new Error("INVALID_RUN_ID");
    return join(resolve(this.directory),id+".json");
  }
  async save(input: RunRecord): Promise<void> {
    const run=validateRecord(input);
    const path=this.path(run.id);
    await mkdir(dirname(path),{recursive:true,mode:0o700});
    const temp=path+"."+process.pid+"."+Math.random().toString(36).slice(2)+".tmp";
    try {
      const handle=await open(temp,"wx",0o600);
      try { await handle.writeFile(JSON.stringify(run)+"\n"); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temp,path);
    } finally { await rm(temp,{force:true}); }
  }
  async load(id: string): Promise<RunRecord|null> {
    const path=this.path(id);
    let content:string;
    try { content=await readFile(path,"utf8"); }
    catch(e){ if((e as NodeJS.ErrnoException).code==="ENOENT")return null; throw e; }
    if(content.length>2_000_000)throw new Error("RUN_TOO_LARGE");
    const run=validateRecord(JSON.parse(content));
    if(run.id!==id)throw new Error("RUN_ID_MISMATCH");
    return run;
  }
}
