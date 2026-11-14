# Local verification without GitHub Actions

The repository has two local verification modes.

**Without npm install:** use Node.js 22.16+ and run:

```sh
node scripts/offline-smoke.mjs
```

On older Node.js versions, the script falls back to the project's existing `typescript` devDependency, if installed. If neither is available, it prints a clear compatibility error. This uses Node's built-in test runner and TypeScript type stripping or transpilation. It reads the actual local TypeScript source files for four self-contained modules: model routing, bounded queue, metrics and legacy evidence. It does not contact GitHub, Adobe, Jira, model providers or corporate systems. The type-stripping API is experimental in Node 22.

**Full repository tests** (requires installing only the existing package devDependencies locally):

```sh
npm install
npm run check
npm test
```

The smoke suite is not a substitute for the full test suite, typecheck, browser tests or an enterprise pilot. It deliberately avoids modules that import other local modules, since those require a TypeScript-aware loader/build step.

No CI, workflow permissions or corporate access are required for either local command.
