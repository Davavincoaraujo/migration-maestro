# Observability: initial metrics contract

`summarizeUsage` aggregates synthetic or enterprise-approved events by job and computes estimated BRL cost from a supplied rate card. `withinBudget` evaluates total estimated cost, token usage and calls.

This module is a **pure reporting/budget evaluator**, not an API interceptor or active circuit breaker. No LLM provider, pricing feed, currency exchange, tracing backend, OpenTelemetry exporter, dashboard, or external network call is connected. Rates must be supplied explicitly and kept up to date.

Do not send proprietary prompts, page content or model outputs to this personal repository. The next integration should wrap actual provider calls and enforce budgets before requests, then emit privacy-safe metrics.
