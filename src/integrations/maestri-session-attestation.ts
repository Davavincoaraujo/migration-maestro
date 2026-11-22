import type { SessionAttestationProvider } from '../sessions/session-attestation.js';
import { maestriTransport, type MaestriTransport } from './maestri-central-cli.js';

/** Diagnostic discovery only. CLI names are observations, never session/model/capability proof.
 * Current official Wire TerminalCard/ChatSnapshot also lack the complete attestation contract.
 * No terminal transcripts, catalogs, environment identities, credentials or cached sessions read. */
export function maestriSessionAttestationProvider(transport:MaestriTransport=maestriTransport(undefined,3000)):SessionAttestationProvider {
  return {id:'maestri-cli-unverified',async attest(request,signal) {
    if(signal.aborted) return {status:'unverified',reason:'MAESTRI_UNAVAILABLE'};
    try {
      const listing=await transport('list',[]);
      const section=listing.split(/Connected agents:\s*/i)[1]?.split(/Connected portals\b/i)[0] ?? listing;
      const matches=[...section.matchAll(/name:\s*"([^"]{1,100})"/g)].filter(m=>m[1]===request.expected.agentId);
      return {status:'unverified',reason:matches.length===0?'MAESTRI_AGENT_NOT_OBSERVED':matches.length>1?'MAESTRI_AGENT_AMBIGUOUS':'MAESTRI_SESSION_ATTESTATION_UNSUPPORTED'};
    }catch{return {status:'unverified',reason:'MAESTRI_UNAVAILABLE'};}
  }};
}
