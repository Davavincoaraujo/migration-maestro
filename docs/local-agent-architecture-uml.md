# Migration Maestro — Local architecture and UML

Migration Maestro is a **local-first migration orchestration workbench**. It is specialized for analyzing legacy pages, matching a sanitized AEM component catalog, preparing a Next.js/Universal Editor composition proposal, validating evidence, and handing the result to a human reviewer. GitHub and Azure DevOps adapters are intentionally out of scope.

## UML component diagram

```mermaid
flowchart LR
  U[Maestri.app operator] --> O[Migration Maestro orchestrator]
  O --> Q[Bounded job queue]
  Q --> C[Checkpoint store]
  O --> J[Event journal]
  O --> R[Read-only MCP dispatcher]
  R --> A[Local synthetic adapter]
  O --> H[Human review gate]
  H --> L[Local review ledger]
  A -. future allowlisted read-only integration .-> M[AEM metadata / component catalog]
  O -. future .-> I[Local AI agent runtime]
```

## UML sequence diagram — page migration

```mermaid
sequenceDiagram
  actor Operator
  participant UI as Maestri.app
  participant Maestro as Orchestrator
  participant Agents as Synthetic Agents
  participant Store as Checkpoints
  participant Gate as Human Review
  Operator->>UI: Start synthetic migration batch
  UI->>Maestro: Submit local job IDs
  loop Each stage
    Maestro->>Agents: Execute read-only synthetic step
    Agents-->>Maestro: Sanitized stage result
    Maestro->>Store: Persist checkpoint
    Maestro-->>UI: Stage-completed event
  end
  Maestro->>Gate: Request human review
  Gate-->>UI: Await explicit approval or rejection
  Note over Maestro,Gate: Approval never publishes to AEM
```

## Agent dependency diagram

```mermaid
flowchart TD
  A[Discovery Agent] --> B[Evidence Agent]
  B --> C[Mapping Agent]
  C --> D[Composition Agent]
  D --> E[Quality Agent]
  E --> F{Human Review Gate}
  F -->|Approved| G[Approved local plan]
  F -->|Rejected| H[Revise / blocked]
  G -. no automatic publishing .-> I[Future integration boundary]
```

The `src/orchestration/agent-graph.ts` module now validates a local agent DAG with deterministic ordering, cycle detection, and a mandatory final human review gate. **It is a planning contract, not a live six-agent executor**: the currently running workbench still uses its existing three-stage synthetic evidence/composition/quality pipeline. The graph is the blueprint for incremental local agent execution and MCP routing.

## Planned local-first milestones

1. Bind graph nodes to local agent handlers and checkpointed task execution.
2. Add agent assignment, retries, bounded concurrency and cancellation.
3. Surface graph and agent state through supported Maestri.app capabilities.
4. Introduce local MCP transport and read-only metadata adapters with explicit allowlists.
5. Add opt-in model-provider agents with budget and data controls; keep approval and publishing separate.

No corporate source data, credentials, remote repository access, AEM writes or publication are required for the current development phase.
