# Security and governance

- Use only synthetic examples; never commit bank/customer data, credentials or proprietary source code.
- Private repository is not by itself a data-classification guarantee.
- Keep secrets in approved secret managers, not repository files.
- Use allowlisted source/target paths, least-privilege tokens and reviewable diffs before enabling integrations.
- Autopilot cannot approve its own output, merge, deploy or publish.
- Require explicit human approval and organization policy checks for external side effects.
- Future adapters must implement rate limits, redaction, audit logs and dry-run by default.
