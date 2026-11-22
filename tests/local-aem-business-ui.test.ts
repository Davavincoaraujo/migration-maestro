import test from "node:test";
import assert from "node:assert/strict";
import { checkLocalAem } from "../src/integrations/local-aem-status.js";

test("local AEM connection is opt-in and rejects unsafe destinations", async () => {
  assert.equal((await checkLocalAem({})).state, "not-configured");
  for (const address of [
    "https://example.com/sites.html/content/demo",
    "http://localhost:4503/sites.html/content/demo",
    "http://user:pass@localhost:4502/sites.html/content/demo",
    "http://127.0.0.1:4502/system/console",
  ]) {
    assert.equal((await checkLocalAem({ MAESTRO_AEM_AUTHOR_URL: address })).state, "unavailable");
  }
});
