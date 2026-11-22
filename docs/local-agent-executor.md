# Local agent executor (PR #42)

The migration agent DAG is now executable **in process**. `executeLocalAgentGraph` validates the graph and executes each synthetic node in dependency order, saving a checkpoint after every successful node. The mandatory `review` node is **never run by the executor**; results always return `awaiting-review` and `aemWritePerformed: false`.

The default rehearsal has five deterministic handlers: discovery, evidence, mapping, composition, and quality. These handlers return synthetic markers, **not** real page analysis, real mapping, actual LLM responses, or AEM output. A real agent implementation must be supplied explicitly as handlers after permission and data controls are designed.

## Guarantees and limitations

- Checkpoints are namespaced to the local agent graph and bind both input and graph topology.
- Completed nodes are reused on retry. Failed nodes can retry without rerunning successful predecessors.
- A stage completion event is emitted only after the checkpoint has been saved.
- No GitHub or Azure DevOps adapter, external network transport, LLM invocation, or AEM write.
- This module is a headless local executor with persisted checkpoints; operator status is presented through Maestri.app, not a repository-owned web interface.
- Do not treat synthetic handler output as migration evidence or approval for publication.

Run `npm run check && npm test` to validate the new module.
