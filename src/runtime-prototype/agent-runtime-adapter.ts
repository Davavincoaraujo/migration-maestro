import { randomUUID } from 'node:crypto';
import { dispatchDigest, type DispatchRequest } from '../autopilot/dispatch-executor.js';

/** Proposal only: no production imports, CLI registration, process, socket or file transport. */
export type RuntimeProtocol = 'codex-app-server' | 'acp-v1';
export interface RuntimeBinding {
  readonly protocol: RuntimeProtocol;
  /** Local connection generation, NOT a provider identity or authentication token. */
  readonly connectionEpoch: string;
  /** Codex thread.id or ACP sessionId; never a Maestri terminalId. */
  readonly sessionId: string;
  readonly modelRequested: string;
}
export interface RuntimeObservation {
  readonly binding: RuntimeBinding;
  readonly evidenceKind: 'synthetic-protocol-observation';
  readonly identityVerified: false;
  readonly modelVerified: false;
  readonly capabilitiesVerified: false;
  readonly availabilityVerified: false;
}
export interface SimulationAuthorization {
  scope: 'simulation-only'; requestDigest: string; authorizationDigest: string;
}
export type SimulationAuthorizer = (request: Readonly<DispatchRequest>) => Promise<SimulationAuthorization>;
export interface RuntimeReceipt {
  readonly version: 1;
  readonly kind: 'simulated-runtime-receipt';
  readonly jobId: string;
  readonly taskId: string;
  readonly requestDigest: string;
  readonly authorizationDigest: string;
  readonly binding: RuntimeBinding;
  readonly outcome: 'unknown' | 'correlated-simulation';
  readonly reason: string;
  readonly turnId?: string;
  readonly outputDigest?: string;
  readonly deliveryVerified: false;
  readonly authorshipAuthenticated: false;
  readonly operationallyEligible: false;
}
export interface AgentRuntimeAdapter {
  readonly mode: 'simulation-only';
  open(modelRequested: string, signal?: AbortSignal): Promise<RuntimeObservation>;
  dispatch(request: DispatchRequest, expected: RuntimeBinding, authorize: SimulationAuthorizer, signal?: AbortSignal): Promise<RuntimeReceipt>;
  /** Read-only reconciliation: never resumes a runtime or retransmits an ambiguous request. */
  recover(request: DispatchRequest): RuntimeReceipt | undefined;
  close(): void;
}

/** Data-only transport script; frames are synthetic objects, not live endpoint responses. */
export interface ReplayStep { method: string; frames: unknown[]; delayMs?: number; expectedParams?: Record<string, unknown>; }
const object = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('RUNTIME_PROTOCOL_INVALID');
  return v as Record<string, any>;
};
const token = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(v);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const key = (request: DispatchRequest) => JSON.stringify([request.jobId, request.taskId]);
const freezeReceipt = (value: RuntimeReceipt): RuntimeReceipt => Object.freeze({...value,binding:Object.freeze({...value.binding})});

/** In-memory claim ledger for crash/recreation simulations, NOT durable storage.
 * No JSON import API: persisted records cannot become authentication evidence. */
export class SimulationJournal {
  #records = new Map<string, RuntimeReceipt>();
  read(request: DispatchRequest): RuntimeReceipt | undefined {
    const record = this.#records.get(key(request));
    if (record && record.requestDigest !== dispatchDigest(request)) throw Error('RUNTIME_REQUEST_CONFLICT');
    return record;
  }
  claim(request: DispatchRequest, record: RuntimeReceipt): void {
    if (this.#records.has(key(request))) throw Error('RUNTIME_ALREADY_CLAIMED');
    this.#records.set(key(request),freezeReceipt(record));
  }
  finish(request: DispatchRequest, record: RuntimeReceipt): RuntimeReceipt {
    const prior = this.read(request);
    if (!prior || prior.reason !== 'RUNTIME_IN_FLIGHT' || record.requestDigest !== prior.requestDigest ||
        record.authorizationDigest !== prior.authorizationDigest || dispatchDigest(record.binding) !== dispatchDigest(prior.binding)) throw Error('RUNTIME_JOURNAL_CONFLICT');
    const frozen = freezeReceipt(record);
    this.#records.set(key(request),frozen);
    return frozen;
  }
}

/** Only transport available in this prototype. Copy inputs to prevent later fixture mutation. */
class ReplayTransport {
  #steps: ReplayStep[];
  constructor(steps: ReplayStep[]) {
    if (!Array.isArray(steps) || steps.length > 10 || Buffer.byteLength(JSON.stringify(steps)) > 256000) throw Error('RUNTIME_REPLAY_INVALID');
    this.#steps = structuredClone(steps);
    for (const step of this.#steps) if (!Array.isArray(step.frames) || step.frames.length > 100 ||
      !Number.isInteger(step.delayMs ?? 0) || (step.delayMs ?? 0) < 0 || (step.delayMs ?? 0) > 10000) throw Error('RUNTIME_REPLAY_INVALID');
  }
  async exchange(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown[]> {
    if (signal.aborted) throw Error('RUNTIME_CANCELLED');
    const step = this.#steps.shift();
    if (!step || step.method !== method) throw Error('RUNTIME_REPLAY_METHOD_MISMATCH');
    if (step.expectedParams && dispatchDigest(params)!==dispatchDigest(step.expectedParams)) throw Error('RUNTIME_REPLAY_PARAMS_MISMATCH');
    await new Promise<void>((resolve,reject) => {
      const abort = () => { clearTimeout(timer); reject(Error('RUNTIME_CANCELLED')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort',abort); resolve(); },step.delayMs ?? 0);
      signal.addEventListener('abort',abort,{once:true});
    });
    return step.frames;
  }
}

/** Strict minimal subset, intentionally rejects unsupported events and server tool requests.
 * Correlation is NOT authentication. A future live adapter must establish its own trust root. */
export function createSimulatedRuntimeAdapter(protocol: RuntimeProtocol, steps: ReplayStep[],
  journal = new SimulationJournal(), timeoutMs = 1000): AgentRuntimeAdapter {
  if (!['codex-app-server','acp-v1'].includes(protocol) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw Error('RUNTIME_CONFIG_INVALID');
  const transport = new ReplayTransport(steps), lifetime = new AbortController();
  const epoch = randomUUID();
  let binding: RuntimeBinding | undefined, opening = false, used = false;
  const bounded = async <T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted || lifetime.signal.aborted) controller.abort();
    signal?.addEventListener('abort',abort,{once:true});lifetime.signal.addEventListener('abort',abort,{once:true});
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      if (controller.signal.aborted) throw Error('RUNTIME_CANCELLED');
      return await Promise.race([work(controller.signal),new Promise<never>((_,reject) => {
        onAbort = () => reject(Error('RUNTIME_CANCELLED'));
        controller.signal.addEventListener('abort',onAbort,{once:true});
        timer = setTimeout(() => { reject(Error('RUNTIME_TIMEOUT'));controller.abort(); },timeoutMs);
      })]);
    } finally { if(timer)clearTimeout(timer);if(onAbort)controller.signal.removeEventListener('abort',onAbort);signal?.removeEventListener('abort',abort);lifetime.signal.removeEventListener('abort',abort); }
  };
  const parse = (frames: unknown[], id: number) => {
    const messages=frames.map(object);
    if (protocol==='acp-v1' && messages.some(m=>m.jsonrpc!=='2.0')) throw Error('RUNTIME_PROTOCOL_INVALID');
    if (messages.some(m=>m.id!==undefined && m.method!==undefined)) throw Error('RUNTIME_SERVER_REQUEST_DENIED');
    const replies=messages.filter(m=>m.id!==undefined);
    if (replies.length!==1 || replies[0].id!==id || replies[0].error!==undefined || replies[0].result===undefined) throw Error('RUNTIME_RESPONSE_AMBIGUOUS');
    if(protocol==='acp-v1' && messages.indexOf(replies[0])!==messages.length-1) throw Error('RUNTIME_RESPONSE_AMBIGUOUS');
    return {result:object(replies[0].result),events:messages.filter(m=>m.id===undefined)};
  };
  return {
    mode:'simulation-only',
    async open(modelRequested,signal) {
      if (binding || opening || lifetime.signal.aborted || !token(modelRequested)) throw Error('RUNTIME_SESSION_STATE_INVALID');
      opening=true;
      try {
        return await bounded(async cancellation => {
          const init=parse(await transport.exchange('initialize',protocol==='acp-v1'?{protocolVersion:1,clientCapabilities:{},clientInfo:{name:'migration-maestro-prototype',version:'0.1.0'}}:{clientInfo:{name:'migration-maestro-prototype',version:'0.1.0'}},cancellation),1);
          if (init.events.length || (protocol==='acp-v1' && init.result.protocolVersion!==1)) throw Error('RUNTIME_INITIALIZE_INVALID');
          // Codex initialized is a notification; the replay transport models it as an empty step.
          if (protocol==='codex-app-server' && (await transport.exchange('initialized',{},cancellation)).length) throw Error('RUNTIME_PROTOCOL_INVALID');
          const session=parse(await transport.exchange(protocol==='acp-v1'?'session/new':'thread/start',protocol==='acp-v1'?{cwd:'/simulation',mcpServers:[]}:{model:modelRequested,cwd:'/simulation',approvalPolicy:'never',sandbox:'read-only'},cancellation),2);
          const sessionId=protocol==='acp-v1'?session.result.sessionId:session.result.thread?.id;
          if (!token(sessionId)) throw Error('RUNTIME_SESSION_INVALID');
          for(const event of session.events) {
            if(protocol!=='codex-app-server' || event.method!=='thread/started' || event.params?.thread?.id!==sessionId) throw Error('RUNTIME_SESSION_MISMATCH');
          }
          // modelRequested remains a requirement; it is never copied into a verified model field.
          binding=Object.freeze({protocol,connectionEpoch:epoch,sessionId,modelRequested});
          return Object.freeze({binding,evidenceKind:'synthetic-protocol-observation' as const,
            identityVerified:false as const,modelVerified:false as const,capabilitiesVerified:false as const,availabilityVerified:false as const});
        },signal);
      } catch(error) { lifetime.abort();throw error; }
      finally { opening=false; }
    },
    async dispatch(input,expected,authorize,signal) {
      const request=Object.freeze(structuredClone(input));
      if(request.version!==1 || !/^[a-f0-9]{20}$/.test(request.jobId) || !/^[a-f0-9-]{36}$/.test(request.taskId) ||
        !token(request.agentId) || !/^[A-Z][A-Z_]{0,63}$/.test(request.stage) || !digest(request.routeDigest) ||
        typeof request.prompt!=='string' || !request.prompt || Buffer.byteLength(request.prompt)>128000) throw Error('RUNTIME_REQUEST_INVALID');
      if(!binding || dispatchDigest(expected)!==dispatchDigest(binding) || lifetime.signal.aborted) throw Error('RUNTIME_BINDING_CHANGED');
      const authorization=await bounded(()=>authorize(request),signal);
      if(authorization?.scope!=='simulation-only' || authorization.requestDigest!==dispatchDigest(request) || !digest(authorization.authorizationDigest)) throw Error('RUNTIME_AUTHORIZATION_REQUIRED');
      if(signal?.aborted || lifetime.signal.aborted) throw Error('RUNTIME_CANCELLED');
      const prior=journal.read(request);
      if(prior) {
        if(prior.authorizationDigest!==authorization.authorizationDigest || dispatchDigest(prior.binding)!==dispatchDigest(binding)) throw Error('RUNTIME_RECOVERY_BINDING_CHANGED');
        return prior;
      }
      if(used) throw Error('RUNTIME_SESSION_ALREADY_USED');
      used=true; // One turn per connection; ACP v1 updates have no universal turn ID.
      const attempt: RuntimeReceipt={version:1,kind:'simulated-runtime-receipt',jobId:request.jobId,taskId:request.taskId,
        requestDigest:dispatchDigest(request),authorizationDigest:authorization.authorizationDigest,binding,
        outcome:'unknown',reason:'RUNTIME_IN_FLIGHT',deliveryVerified:false,authorshipAuthenticated:false,operationallyEligible:false};
      journal.claim(request,attempt); // Atomic in-memory claim before any simulated prompt.
      try {
        const pinned=binding;
        const completed=await bounded(async cancellation => {
          const {result,events}=parse(await transport.exchange(protocol==='acp-v1'?'session/prompt':'turn/start',protocol==='acp-v1'?{sessionId:pinned.sessionId,prompt:[{type:'text',text:request.prompt}]}:{threadId:pinned.sessionId,model:pinned.modelRequested,input:[{type:'text',text:request.prompt}]},cancellation),3);
          const output:string[]=[];
          let turnId:string|undefined,finished=0;
          if(protocol==='codex-app-server') {
            turnId=result.turn?.id;
            if(!token(turnId) || result.turn.status!=='inProgress') throw Error('RUNTIME_TURN_INVALID');
          } else if(result.stopReason!=='end_turn') throw Error('RUNTIME_TURN_INCOMPLETE');
          for(const event of events) {
            const p=object(event.params);
            if(protocol==='acp-v1') {
              if(event.method!=='session/update' || p.sessionId!==pinned.sessionId) throw Error('RUNTIME_SESSION_MISMATCH');
              const update=object(p.update);
              if(update.sessionUpdate==='config_option_update' || update.sessionUpdate==='current_mode_update') throw Error('RUNTIME_CONFIGURATION_CHANGED');
              if(update.sessionUpdate!=='agent_message_chunk' || update.content?.type!=='text' || typeof update.content.text!=='string') throw Error('RUNTIME_EVENT_UNSUPPORTED');
              output.push(update.content.text);
            } else {
              if(p.threadId!==pinned.sessionId) throw Error('RUNTIME_SESSION_MISMATCH');
              if(event.method==='model/rerouted') throw Error('RUNTIME_MODEL_CHANGED');
              if(event.method==='turn/completed') {
                if(p.turn?.id!==turnId || p.turn.status!=='completed' || p.turn.error!=null || ++finished!==1) throw Error('RUNTIME_TURN_INVALID');
              } else if(event.method==='item/agentMessage/delta') {
                if(p.turnId!==turnId || !token(p.itemId) || typeof p.delta!=='string' || finished) throw Error('RUNTIME_TURN_INVALID');
                output.push(p.delta);
              } else throw Error('RUNTIME_EVENT_UNSUPPORTED');
            }
          }
          if(protocol==='codex-app-server' && finished!==1) throw Error('RUNTIME_TURN_INCOMPLETE');
          if(!output.length) throw Error('RUNTIME_RESULT_MISSING');
          return {turnId,outputDigest:dispatchDigest(output)};
        },signal);
        return journal.finish(request,{...attempt,...completed,outcome:'correlated-simulation',reason:'SIMULATION_ONLY_NOT_AUTHENTICATED'});
      } catch(error) {
        const reason=error instanceof Error && /^RUNTIME_[A-Z_]+$/.test(error.message)?error.message:'RUNTIME_UNKNOWN';
        return journal.finish(request,{...attempt,reason}); // No retry even after cancellation/timeout.
      }
    },
    recover: request=>journal.read(request),
    close: ()=>lifetime.abort(),
  };
}
