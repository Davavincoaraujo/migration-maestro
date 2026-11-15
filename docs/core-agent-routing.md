# Agent registry and model routing

The registry stores explicit agent capabilities and tool allowlists. Agents are eligible only when they support the task capability and every required tool. Registration requires an adapter with a matching adapter ID.

The model router selects the lowest estimated USD cost among models with declared prices, compatible capabilities, adequate context window, and agent model preferences. Missing pricing/context prevents selection; it does not guess. This is advisory selection, **not** permission to execute.

This phase does not connect providers, execute agents, or expose a Maestri API. Future execution must check adapter availability, tool effects, scoped approvals, local isolation and persistence before running.
