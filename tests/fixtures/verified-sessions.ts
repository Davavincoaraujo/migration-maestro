import { inspectMaestriModelSessions } from '../../src/integrations/maestri-model-router.js';
import { runCentralDemo as actual } from '../../src/autopilot/central-controller.js';
/** Explicit synthetic adapter for controller tests, not a claim about footer authentication.
 * Discovery parser remains fail-closed in production and its own regression tests. */
export const simulatedDiscovery: typeof inspectMaestriModelSessions = async (...args) => {
  const result = await inspectMaestriModelSessions(...args);
  return { ...result, candidates: result.candidates.map(c => ({ ...c, availability: c.modelId !== 'unknown' ? 'available' as const : 'unknown' as const })) };
};
export const runCentralDemo = (options: Parameters<typeof actual>[0]) => actual({ ...options, discoverSessions: simulatedDiscovery });
