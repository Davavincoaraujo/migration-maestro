# Review gate

This module creates an immutable-by-convention review request from a successful synthetic dry-run and binds the decision to a SHA-256 digest of the preview. Stale or changed previews cannot be approved. Reviewers may approve or reject exactly once.

The module is **not an authentication or authorization system**. The reviewer identifier is supplied by the caller; production usage requires trusted identity, audit persistence, access controls and a server-side transaction to prevent concurrent decisions. No AEM write or publish capability is implemented. Do not use real corporate content in the personal repository.
