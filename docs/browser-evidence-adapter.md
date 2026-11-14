# Authorized browser evidence adapter

`collectAuthorizedEvidence` defines a boundary for browser-based collection. It requires an explicit HTTPS origin allowlist, page ID, timeout and injected driver, and returns a sanitized evidence report rather than HTML, cookies or screenshots.

**Security caveat:** origin checks alone are insufficient against DNS rebinding, redirects, subresource requests or internal-network SSRF. A production Playwright driver must additionally enforce redirect and request interception, DNS/IP restrictions, authenticated access policies, isolation and data retention. The supplied driver is a dependency injection contract, **not** a real Playwright/Lighthouse implementation.

No live URL collection is enabled by this change.
