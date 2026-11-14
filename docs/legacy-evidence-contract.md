# Legacy browser evidence contract

`analyzeLegacyEvidence` validates a **sanitized, synthetic** evidence record containing page structure counts, basic SEO checks, broken-link counts, optional Lighthouse scores (0–100), viewport dimensions and an optional SHA-256 screenshot digest.

The report intentionally omits URLs, page HTML, text, screenshots, cookies, request headers and credentials. A digest is not proof of authorization or anonymization. Never send sensitive page data or screenshots to a personal repository.

This is a schema and offline analysis module, **not** a Playwright crawler, Lighthouse runner, browser adapter, accessibility audit or screenshot comparison engine. Real collection must run only against authorized sources in an approved environment.
