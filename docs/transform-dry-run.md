# Synthetic transform dry-run (stage 7)

`dryRunTransform(contract, source)` maps **explicitly approved** source-to-target field names, checks required fields and primitive types, and returns a preview with `publishable: false`. All successful previews still require human review.

The function is intentionally not an autonomous mapping inference system. It does not support nested multifields, images, HTML sanitization, JCR serialization, page routing, analytics, access controls or AEM publishing. Do not use it for real portal content until enterprise-side data handling, field semantics and persistence contracts are approved.

Security: field names must match a constrained allowlist, dangerous JavaScript object keys are rejected, output uses a null-prototype object, and there are size limits. A dry-run result may contain source content, so **never commit or share real previews in this personal repository**.
