import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AemCreateOnly, contentPath } from "../src/integrations/aem-create-only.js";

const env = { MAESTRO_AEM_AUTHOR_URL: "http://localhost:4502", MAESTRO_AEM_USER: "fixture", MAESTRO_AEM_PASSWORD: "fixture" };
const path = "/content/site/new-page";
const page = { "jcr:primaryType": "cq:Page", "jcr:content": { "jcr:primaryType": "cq:PageContent", "jcr:title": "Fixture" } };
const json = (value: unknown) => Response.json(value);

test("AEM rejects remote hosts, unsafe paths and missing auth", () => {
  assert.throws(() => new AemCreateOnly({ ...env, MAESTRO_AEM_AUTHOR_URL: "https://example.com:4502" }, "/tmp/unused"), /LOCAL_AEM_ONLY/);
  assert.throws(() => new AemCreateOnly({ ...env, MAESTRO_AEM_PASSWORD: "" }, "/tmp/unused"), /AUTH_REQUIRED/);
  assert.throws(() => contentPath("/content/site/../other", "/content/site"));
  assert.throws(() => contentPath("/content/other/page", "/content/site"));
});

test("page create is non-replacing and resumes after an ambiguous successful write using GET only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aem-create-"));
  let created: unknown; let posts = 0;
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.redirect, "manual");
    if (init?.method === "POST") {
      posts++;
      const form = init.body as FormData;
      assert.equal(form.get(":replace"), "false"); assert.equal(form.get(":replaceProperties"), "false");
      assert.equal(form.get(":name"), "new-page");
      created = JSON.parse(String(form.get(":content")));
      throw Error("simulated disconnect after server applied write");
    }
    if (String(url).endsWith("/site.1.json")) return json({ "jcr:primaryType": "cq:Page" });
    return created ? json(created) : new Response(null, { status: 404 });
  };
  try {
    const client = new AemCreateOnly(env, dir, fetcher as typeof fetch);
    await assert.rejects(client.createPage(path, page, "/content/site", "a".repeat(20)), /TRANSPORT/);
    assert.equal((await client.createPage(path, page, "/content/site", "a".repeat(20))).reconciled, true);
    assert.equal(posts, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("unrelated existing page and unavailable read never trigger a write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aem-conflict-"));
  let posts = 0;
  try {
    const client = new AemCreateOnly(env, dir, (async (_url, init) => { if (init?.method === "POST") posts++; return json(page); }) as typeof fetch);
    await assert.rejects(client.createPage(path, page, "/content/site", "a".repeat(20)), /DESTINATION_EXISTS/);
    const denied = new AemCreateOnly(env, dir, (async () => new Response(null, { status: 403 })) as typeof fetch);
    await assert.rejects(denied.createPage(path, page, "/content/site", "a".repeat(20)), /AUTHENTICATION/);
    assert.equal(posts, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("ambiguous write with absent destination is never resent automatically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aem-ambiguous-"));
  let posts = 0;
  const client = new AemCreateOnly(env, dir, (async (url, init) => {
    if (init?.method === "POST") { posts++; throw Error("offline"); }
    return String(url).endsWith("/site.1.json") ? json({}) : new Response(null, { status: 404 });
  }) as typeof fetch);
  try {
    await assert.rejects(client.createPage(path, page, "/content/site", "b".repeat(20)), /TRANSPORT/);
    await assert.rejects(client.createPage(path, page, "/content/site", "b".repeat(20)), /RECONCILIATION/);
    assert.equal(posts, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("DAM existing node without an original binary is a conflict, not an upload target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dam-conflict-")); let posts = 0;
  const client = new AemCreateOnly(env, dir, (async (url, init) => {
    if (init?.method === "POST") posts++;
    if (String(url).endsWith("/site.1.json")) return json({ "jcr:primaryType": "sling:OrderedFolder" });
    return String(url).endsWith("/original") ? new Response(null, { status: 404 }) : json({});
  }) as typeof fetch);
  try {
    await assert.rejects(client.createAsset("/content/dam/site/hero.png", Buffer.from("fixture"), "image/png", "/content/dam/site"), /DESTINATION_EXISTS/);
    assert.equal(posts, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("DAM identical bytes are reused read-only and conflicting bytes never overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dam-reuse-")); let posts = 0;
  const client = new AemCreateOnly(env, dir, (async (url, init) => {
    if (init?.method === "POST") posts++;
    if (String(url).endsWith("/original")) return new Response("fixture");
    return json({ "jcr:primaryType": String(url).endsWith("/site.1.json") ? "sling:OrderedFolder" : "dam:Asset" });
  }) as typeof fetch);
  try {
    assert.equal((await client.createAsset("/content/dam/site/hero.png", Buffer.from("fixture"), "image/png", "/content/dam/site")).reconciled, true);
    await assert.rejects(client.createAsset("/content/dam/site/hero.png", Buffer.from("different"), "image/png", "/content/dam/site"), /DESTINATION_EXISTS/);
    assert.equal(posts, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("DAM creates missing folders and a new binary once, then reuses both read-only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dam-create-"));
  const nodes = new Map<string, unknown>([["/content/dam/site.1.json", { "jcr:primaryType": "sling:OrderedFolder" }]]);
  let binary: Uint8Array | undefined; let posts = 0;
  const client = new AemCreateOnly(env, dir, (async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    if (init?.method === "POST") {
      posts++;
      const target = "/content/dam" + endpoint.slice("/api/assets".length);
      if (String(new Headers(init.headers).get("Content-Type")) === "application/json") nodes.set(target + ".1.json", { "jcr:primaryType": "sling:OrderedFolder" });
      else { nodes.set(target + ".1.json", { "jcr:primaryType": "dam:Asset" }); binary = Buffer.from(init.body as Uint8Array); }
      return new Response(null, { status: 201 });
    }
    if (endpoint.endsWith("/original")) return binary ? new Response(Buffer.from(binary)) : new Response(null, { status: 404 });
    return nodes.has(endpoint) ? json(nodes.get(endpoint)) : new Response(null, { status: 404 });
  }) as typeof fetch);
  try {
    const target = "/content/dam/site/new/hero.png";
    assert.equal((await client.createAsset(target, Buffer.from("fixture"), "image/png", "/content/dam/site")).reconciled, false);
    assert.equal((await client.createAsset(target, Buffer.from("fixture"), "image/png", "/content/dam/site")).reconciled, true);
    assert.equal(posts, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
