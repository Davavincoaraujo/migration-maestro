# Bounded in-process Autopilot queue

`runBoundedQueue` executes a list of synthetic asynchronous tasks with a configurable concurrency limit and maximum batch size. It preserves output ordering, isolates task failures without leaking exception messages, and supports cooperative cancellation through `AbortSignal`.

This is **not** a durable distributed queue. It does not integrate with Redis/BullMQ, PostgreSQL, checkpoints, leases, retry scheduling, token budgets or model routing. Running tasks must respect the supplied signal to stop promptly. No AEM writes or external integrations are enabled.
