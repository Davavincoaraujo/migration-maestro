import { createReadDispatcher } from "../mcp/dispatcher.js";
import type { WorkbenchReport } from "../workbench/local-workbench.js";
import { ConnectorRegistry, type MaestroConnector, type IntegrationCapability } from "./connector-contract.js";

const capabilities: readonly IntegrationCapability[] = ["source.read", "target.preview", "job.status"];

/**
 * In-process, synthetic-only MCP-shaped adapter. No MCP network transport.
 * Results are derived solely from a precomputed local workbench report.
 */
export function createSyntheticReportConnector(report: WorkbenchReport): MaestroConnector {
  const jobs = new Map(report.jobs.map(job => [job.id, job]));
  return {
    id: "synthetic-report",
    capabilities,
    async invoke(request) {
      const job = jobs.get(request.jobId);
      if (!job) throw new Error("Unknown synthetic job");
      let data: unknown;
      switch (request.capability) {
        case "source.read":
          data = { id: job.id, componentCount: job.componentCount, synthetic: true };
          break;
        case "target.preview":
          data = { id: job.id, status: job.status, componentCount: job.componentCount, publishable: false };
          break;
        case "job.status":
          data = { id: job.id, status: job.status, stages: [...job.stages] };
          break;
        default:
          throw new Error("Unsupported capability");
      }
      return { capability: request.capability, jobId: request.jobId, data, readOnly: true };
    },
  };
}

/** MCP-shaped read tool dispatcher, routed through connector capability checks. */
export function createSyntheticMcpAdapter(report: WorkbenchReport) {
  const registry = new ConnectorRegistry();
  registry.register(createSyntheticReportConnector(report));
  const route = async (capability: IntegrationCapability, args: Readonly<Record<string, unknown>>) => {
    if (typeof args.id !== "string") throw new Error("Invalid job ID");
    return (await registry.invoke("synthetic-report", { capability, jobId: args.id })).data;
  };
  return createReadDispatcher({
    "source.list": async () => report.jobs.map(job => ({ id: job.id, status: job.status })),
    "source.read": args => route("source.read", args),
    "target.preview": args => route("target.preview", args),
    "job.status": args => route("job.status", args),
  });
}
