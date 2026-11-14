# Provider-neutral model selection policy

`routeModel` chooses the lowest estimated-cost model satisfying declared capabilities, input capacity and a caller-provided BRL budget. Profiles are synthetic and no provider SDK, keys or live prices are included.

This is a **selection policy only**: no API requests, retries, token counting, real-time price discovery, privacy enforcement, prompt caching or live budget circuit breaker. The caller must supply trustworthy estimates and approved model profiles. Selection does not authorize sending enterprise data to an AI provider.
