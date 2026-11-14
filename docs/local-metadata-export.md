# Local-only metadata export

This first stage accepts an **evaluated** component definition (JSON containing `modelId`, `fields`, `subItems`). It cannot parse TypeScript `definition.ts` or execute portal helpers directly.

Run in a controlled local environment:

```sh
npm install
npm run metadata:export -- ./local-input/evaluated-definition.json ./local-output/structure.json
npm test
npm run check
```

`local-input/` and `local-output/` must stay outside version control. The export replaces model identifiers with truncated SHA-256 hashes and collection names with positional aliases; it preserves only structural relationships. It does not export source paths, field labels, property values, content, or secrets. Hashes are pseudonymous, not guaranteed anonymous against guessing: **review exported JSON before sharing**.

The output is suitable for **structural planning only**, not generating or publishing AEM content. For eventual AEM serialization, establish a separate approved enterprise-side mapping and inspect actual JCR persistence. Never copy corporate files into the personal repository.
