import { isCurrentSessionAttestation, type SessionAttestation } from '../sessions/session-attestation.js';
import { classifyTask, routeAdaptiveTask, type AdaptiveModelCandidate, type AdaptiveRouteDecision, type AdaptiveRouteRequest, type Provider } from './model-router.js';

export interface AgentDeclaration {
  agentId: string;
  mode: 'declared' | 'fallback';
  provider: Provider;
  modelId: string | null;
  capabilities: string[];
}
export interface OperationalPolicy {
  version: 1;
  scope: 'isolated-synthetic';
  maxRisk: 'LOW' | 'MEDIUM';
  agents: AgentDeclaration[];
}
export interface OperationalProof {
  agentId: string;
  capabilities: string[];
  checkedAt: string;
  artifactDigest: string;
  taskId: string;
}
export function validateOperationalPolicy(value: unknown): OperationalPolicy {
  const p = value as OperationalPolicy;
  if (!p || p.version !== 1 || p.scope !== 'isolated-synthetic' || !['LOW','MEDIUM'].includes(p.maxRisk) ||
    !Array.isArray(p.agents) || !p.agents.length || p.agents.length > 20 || new Set(p.agents.map(a => a?.agentId)).size !== p.agents.length) throw Error('INVALID_OPERATIONAL_POLICY');
  for (const a of p.agents) {
    if (!a || !/^[A-Za-z0-9][A-Za-z0-9 ()_.-]{0,79}$/.test(a.agentId) || !['declared','fallback'].includes(a.mode) ||
      !['codex','claude-code','unknown'].includes(a.provider) ||
      (a.mode === 'declared' ? a.provider === 'unknown' || typeof a.modelId !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(a.modelId) : a.modelId !== null || a.provider !== 'unknown') ||
      !Array.isArray(a.capabilities) || !a.capabilities.length || new Set(a.capabilities).size !== a.capabilities.length ||
      a.capabilities.some(c => !['analysis','mapping','planning','coding','validation'].includes(c))) throw Error('INVALID_AGENT_DECLARATION');
  }
  return structuredClone(p);
}
export function selectOperationalRoute(input: {
  request: AdaptiveRouteRequest; policy: OperationalPolicy; agentId: string;
  proof?: OperationalProof; connected: boolean; confirmed: boolean; now: number;
  attestation?: SessionAttestation;
}): AdaptiveRouteDecision & { operationalEvidence?: unknown } {
  const policy = validateOperationalPolicy(input.policy), { request } = input;
  const assessment = classifyTask(request.signals);
  const blocked = (reason: string): AdaptiveRouteDecision => ({ action: 'blocked', profile: assessment.profile,
    complexity: assessment.complexity, reason, attempts: 0, escalationCount: 0, estimatedCostUsd: null,
    usage: { inputTokens: null, outputTokens: null, costUsd: null, latencyMs: null } });
  if (request.capability==='planning' || request.taskType==='planning') return {...blocked('VERIFIED_ADVANCED_PLANNING_SESSION_REQUIRED'),profile:'ADVANCED'};
  if (!input.confirmed || !input.connected) return blocked('OPERATIONAL_CONFIRMATION_AND_CONNECTIVITY_REQUIRED');
  // Critical/high-risk work has no unattended degraded path. No automatic model downgrade.
  if (request.signals.securityCritical || request.signals.businessCritical || ['HIGH','CRITICAL'].includes(assessment.complexity)) return blocked('HUMAN_APPROVAL_AND_VERIFIABLE_EVIDENCE_REQUIRED');
  if (assessment.deterministic) return { ...blocked('DETERMINISTIC_LOCAL_EXECUTION'), action: 'deterministic' };
  if (input.attestation) {
    const a=policy.agents.find(a=>a.agentId===input.agentId),d=input.attestation,b=d.binding;
    if(!isCurrentSessionAttestation(d,input.now) || !a || b.agentId!==a.agentId || b.provider!==a.provider || b.modelId!==a.modelId ||
        !a.capabilities.includes(request.capability) || !b.capabilities.includes(request.capability)) return blocked('SESSION_ATTESTATION_INVALID');
    const candidate:AdaptiveModelCandidate={id:b.agentId,provider:b.provider,modelId:b.modelId,profile:b.profile,
      capabilities:b.capabilities,availability:'available',source:'maestri-session'};
    return {...routeAdaptiveTask([candidate],request),operationalEvidence:{mode:'attested-session',sessionAttestation:d,
      deliveryAuthenticated:false,authorshipAuthenticated:false}};
  }
  const a = policy.agents.find(a => a.agentId === input.agentId), proof = input.proof;
  if (!a || !a.capabilities.includes(request.capability) || !proof || proof.agentId !== a.agentId ||
      !proof.capabilities.includes(request.capability) || !fresh(proof.checkedAt, input.now) ||
      !/^[a-f0-9]{64}$/.test(proof.artifactDigest) || !/^[a-f0-9-]{36}$/.test(proof.taskId)) return blocked('CAPABILITY_PROOF_REQUIRED');
  if (request.excludedAgentIds?.includes(a.agentId)) return blocked('INDEPENDENT_AGENT_REQUIRED');
  if (request.priorFailure || request.maxEstimatedCostUsd !== undefined) return blocked('FAILURE_OR_UNKNOWN_COST_REQUIRES_REVIEW');
  if ((policy.maxRisk === 'LOW' || a.mode === 'fallback') && assessment.complexity !== 'LOW') return blocked('DEGRADED_RISK_LIMIT');
  return { action: 'agent', agentId: a.agentId, provider: a.provider, modelId: a.modelId ?? 'unknown',
    profile: assessment.profile, modelProfile: assessment.profile, complexity: assessment.complexity,
    reason: 'Operational eligibility by declared policy and bounded capability probe; profile is task requirement, not verified model quality.',
    estimatedCostUsd: null, attempts: 0, escalationCount: 0,
    usage: { inputTokens: null, outputTokens: null, costUsd: null, latencyMs: null },
    operationalEvidence: { mode: a.mode, modelDeclared: a.modelId, modelObserved: false, identityVerified: false,
      availabilityVerified: false, availability: 'unknown', operationallyEligible: true,
      profileBasis: 'task-requirement-only', proof: { ...proof }, scope: policy.scope } };
}
function fresh(at: string, now: number) { const age = now - Date.parse(at); return Number.isFinite(age) && age >= 0 && age <= 24 * 60 * 60 * 1000; }

/** Trusted adapter only. A declared model or rendered footer is never sufficient for PLAN. */
export function selectVerifiedOperationalPlan(agent: AgentDeclaration, session: SessionAttestation | undefined, request: AdaptiveRouteRequest, now=Date.now()) {
  if (!isCurrentSessionAttestation(session,now) || agent.agentId!=='Hermes' || session.binding.agentId!==agent.agentId ||
      session.binding.provider!==agent.provider || session.binding.modelId!==agent.modelId ||
      session.binding.profile!=='ADVANCED' || !agent.capabilities.includes('planning') || !session.binding.capabilities.includes('planning')) {
    throw Error('VERIFIED_ADVANCED_PLANNING_SESSION_REQUIRED');
  }
  const b=session.binding;
  const candidate:AdaptiveModelCandidate={id:b.agentId,provider:b.provider,modelId:b.modelId,profile:b.profile,
    capabilities:b.capabilities,availability:'available',source:'maestri-session'};
  const decision=routeAdaptiveTask([candidate],{...request,capability:'planning',signals:{taskKind:'architecture',affectedFiles:5,dependencyCount:3,technicalRisk:'high',reasoningNeed:'high',confidence:0.45}});
  if(decision.action!=='agent' || decision.profile!=='ADVANCED') throw Error('VERIFIED_ADVANCED_PLANNING_SESSION_REQUIRED');
  return {...decision,operationalEvidence:{mode:'attested-session',sessionAttestation:session,
    deliveryAuthenticated:false,authorshipAuthenticated:false}};
}
