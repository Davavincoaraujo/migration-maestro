export type IntegrationCapability = "source.read" | "target.preview" | "job.status";
export interface IntegrationRequest {
  capability: IntegrationCapability;
  jobId: string;
}
export interface IntegrationResponse {
  capability: IntegrationCapability;
  jobId: string;
  data: unknown;
  readOnly: true;
}
export interface MaestroConnector {
  readonly id: string;
  readonly capabilities: readonly IntegrationCapability[];
  invoke(request: IntegrationRequest): Promise<IntegrationResponse>;
}
/** Rejects all non-allowlisted connector operations. No network or credentials. */
export class ConnectorRegistry {
  private readonly connectors = new Map<string, MaestroConnector>();
  register(connector: MaestroConnector): void {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(connector.id) || this.connectors.has(connector.id) ||
        connector.capabilities.some(cap => !["source.read", "target.preview", "job.status"].includes(cap))) {
      throw new Error("Invalid connector");
    }
    this.connectors.set(connector.id, connector);
  }
  async invoke(connectorId: string, request: IntegrationRequest): Promise<IntegrationResponse> {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(request.jobId) ||
        !["source.read", "target.preview", "job.status"].includes(request.capability)) throw new Error("Operation denied");
    const connector = this.connectors.get(connectorId);
    if (!connector || !connector.capabilities.includes(request.capability)) throw new Error("Operation denied");
    const response = await connector.invoke(request);
    if (!response.readOnly || response.capability !== request.capability || response.jobId !== request.jobId) {
      throw new Error("Connector contract violation");
    }
    return response;
  }
}
