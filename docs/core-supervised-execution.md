# Core execution safety boundary

`executeOneReadyTask` is a minimal **read-only** adapter dispatcher. It selects an eligible registered agent, checks availability and declared tool permissions, and records the returned status and evidence references.

It does not run write, execute, publish or external tools. Such operations require a future durable execution coordinator with persisted pre-execution state, explicit run/task-scoped authorization, idempotency, cancellation and crash recovery. This restriction is deliberate: a simple in-memory function cannot guarantee safe replay after a crash.

The current function does not persist state and should not be presented as a production-grade autopilot. The Maestri interface remains optional and not integrated.
