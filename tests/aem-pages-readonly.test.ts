import test from "node:test";
import assert from "node:assert/strict";
import { readLocalAemPages, parseAemAuthorUrl } from "../src/integrations/aem-pages-readonly.js";

const env = {
  MAESTRO_AEM_AUTHOR_URL: "http://localhost:4502/sites.html/content/portal-banco-bradesco",
  MAESTRO_AEM_USER: "local-reader",
  MAESTRO_AEM_PASSWORD: "test-only",
};
test("AEM connector restricts destination and requires credentials", async () => {
  assert.deepEqual(parseAemAuthorUrl(env.MAESTRO_AEM_AUTHOR_URL), {
    origin: "http://localhost:4502", root: "/content/portal-banco-bradesco",
  });
  for (const url of ["http://evil.example:4502/sites.html/content/x",
    "http://localhost:4502/system/console", "http://user:pass@localhost:4502/sites.html/content/x",
    "http://localhost:4502/sites.html/content/x?foo=1"]) {
    assert.throws(() => parseAemAuthorUrl(url));
  }
  assert.equal((await readLocalAemPages({})).state, "not-configured");
  assert.equal((await readLocalAemPages({ MAESTRO_AEM_AUTHOR_URL: env.MAESTRO_AEM_AUTHOR_URL })).state, "credentials-required");
});
test("AEM connector extracts only bounded page metadata and never returns raw content", async () => {
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    assert.equal(String(input), "http://localhost:4502/content/portal-banco-bradesco.1.json");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "manual");
    assert.match(String((init?.headers as Record<string, string>)?.Authorization), /^Basic /);
    return new Response(JSON.stringify({
      "home": { "jcr:primaryType": "cq:Page", "jcr:content": { "jcr:title": "Página inicial", "secret": "DO_NOT_EXPOSE" } },
      "assets": { "jcr:primaryType": "sling:Folder" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await readLocalAemPages(env, fetcher as typeof fetch);
  assert.equal(result.state, "connected");
  assert.deepEqual(result.pages, [{ name: "home", title: "Página inicial", hasContent: true }]);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_EXPOSE|test-only/);
});
test("AEM connector refuses redirects and oversized responses", async () => {
  const redirected = await readLocalAemPages(env, (async () => new Response(null, { status: 302, headers: { location: "https://example.com" } })) as typeof fetch);
  assert.equal(redirected.state, "authentication-failed");
  const oversized = await readLocalAemPages(env, (async () => new Response("{}", {
    headers: { "content-type": "application/json", "content-length": "999999" },
  })) as typeof fetch);
  assert.equal(oversized.state, "unavailable");
});
