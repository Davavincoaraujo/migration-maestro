# Runtime registry discovery (stage 3)

The new `discoverRegistry(registry)` accepts an **already evaluated** `Map` or plain object of entries. Each entry may contain `definition` or be the definition itself. The function inspects `modelId`, `fields` and `subItems` to build the anonymized structural catalog, and deliberately **never invokes** `load()` or `loadMapper()`.

## Integration sketch (corporate environment only)

Inside the portal, after its existing `generate:registries` script has produced the registry:

```ts
import { componentRegistry } from "@/common/generated/registry";
import { discoverRegistry } from "./approved-local-adapter";

const result = discoverRegistry(componentRegistry);
console.log(result.catalog.summary);
// Save result.catalog only to an approved local path after reviewing it.
```

This is an **integration sketch**, not a verified import path for the portal. The adapter must first be copied or packaged through an approved internal process. The Maestro's GitHub connector cannot access files on the MacBook or enterprise GitHub. Do not paste proprietary registry entries into this repository.

## Limits and security

- No direct parsing of TypeScript source; the portal must evaluate its own definitions.
- The result contains pseudonymous hashes of model IDs; dictionary attacks may recover predictable IDs. Review before sharing.
- No page content, credentials, URLs, field labels or source paths are emitted.
- Invalid entries are reported by ordinal position with generic reasons, not raw values.
- A catalog collision on identical model IDs is a hard error; it is not silently merged.
- This stage does not serialize JCR or publish to AEM.
