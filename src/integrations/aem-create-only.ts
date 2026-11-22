import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
export function contentPath(path: string, root: string): string {
  if (!/^\/content\/[a-zA-Z0-9_/-]+$/.test(root) || !/^[a-zA-Z0-9_./:-]+$/.test(path) ||
      !path.startsWith(root + "/") || path.includes("//") || path.split("/").some(x => x === "." || x === "..")) throw Error("AEM_PATH_OUTSIDE_SCOPE");
  return path;
}

/** Local Author only. No delete, update, publish, redirects, or automatic write retries. */
export class AemCreateOnly {
  readonly origin: string;
  private readonly authorization: string;
  constructor(env: NodeJS.ProcessEnv, private readonly receipts: string, private readonly fetcher: typeof fetch = fetch) {
    if (!env.MAESTRO_AEM_AUTHOR_URL) throw Error("AEM_URL_REQUIRED");
    const url = new URL(env.MAESTRO_AEM_AUTHOR_URL);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "4502" || url.username || url.password || url.search || url.hash) throw Error("LOCAL_AEM_ONLY");
    this.origin = url.origin;
    if (!env.MAESTRO_AEM_USER || !env.MAESTRO_AEM_PASSWORD) throw Error("AEM_ENV_AUTH_REQUIRED");
    this.authorization = "Basic " + Buffer.from(env.MAESTRO_AEM_USER + ":" + env.MAESTRO_AEM_PASSWORD).toString("base64");
  }
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("..") || path.includes("?") || path.includes("#")) throw Error("INVALID_AEM_ENDPOINT");
    try {
      const response = await this.fetcher(this.origin + path, { ...init, redirect: "manual", signal: AbortSignal.timeout(15000), headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: this.authorization } });
      if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw Error("AEM_AUTHENTICATION_REQUIRED"); }
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw Error("AEM_REDIRECT_DENIED"); }
      return response;
    } catch (error) {
      if (error instanceof Error && /^AEM_[A-Z_]+$/.test(error.message)) throw error;
      throw Error("AEM_TRANSPORT_UNAVAILABLE");
    }
  }
  async bytes(path: string): Promise<Uint8Array | undefined> {
    const response = await this.request(path);
    if (response.status === 404) { await response.body?.cancel(); return undefined; }
    if (response.status !== 200) { await response.body?.cancel(); throw Error("AEM_READ_FAILED"); }
    const reader = response.body?.getReader();
    if (!reader) throw Error("AEM_EMPTY_RESPONSE");
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 20_000_000) { await reader.cancel(); throw Error("AEM_RESPONSE_TOO_LARGE"); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
  }
  async json(path: string): Promise<Record<string, unknown> | undefined> {
    const bytes = await this.bytes(path);
    if (!bytes) return undefined;
    try { const result: unknown = JSON.parse(Buffer.from(bytes).toString()); if (!result || typeof result !== "object" || Array.isArray(result)) throw Error(); return result as Record<string, unknown>; }
    catch { throw Error("AEM_JSON_REQUIRED"); }
  }
  private async create(path: string, expectedDigest: string, current: () => Promise<string | undefined>, post: () => Promise<Response>, reuseIdentical = false): Promise<{ path: string; digest: string; reconciled: boolean }> {
    await mkdir(this.receipts, { recursive: true, mode: 0o700 });
    const file = join(this.receipts, sha256(path) + ".json");
    let receipt: { path: string; digest: string } | undefined;
    try { receipt = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const observed = await current();
    if (receipt) {
      if (receipt.path !== path || receipt.digest !== expectedDigest) throw Error("AEM_RECEIPT_MISMATCH");
      if (observed === expectedDigest) return { path, digest: expectedDigest, reconciled: true };
      throw Error("AEM_AMBIGUOUS_CREATE_REQUIRES_RECONCILIATION");
    }
    if (reuseIdentical && observed === expectedDigest) return { path, digest: expectedDigest, reconciled: true };
    if (observed !== undefined) throw Error("AEM_DESTINATION_EXISTS");
    // Persist intent before sending. A crash/timeout can only be reconciled by GET.
    await writeFile(file, JSON.stringify({ path, digest: expectedDigest, state: "intent", at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    const response = await post();
    const status = response.status; await response.body?.cancel();
    if (status !== 201) throw Error(status === 409 || status === 412 ? "AEM_CREATE_CONFLICT" : "AEM_CREATE_NOT_CONFIRMED");
    if (await current() !== expectedDigest) throw Error("AEM_CREATED_CONTENT_NOT_VERIFIED");
    return { path, digest: expectedDigest, reconciled: false };
  }
  async createPage(path: string, page: Record<string, unknown>, scope: string, jobId: string) {
    contentPath(path, scope);
    if (!/^[a-f0-9]{20}$/.test(jobId) || page["jcr:primaryType"] !== "cq:Page") throw Error("INVALID_AEM_PAGE");
    const content = page["jcr:content"];
    if (!content || typeof content !== "object" || Array.isArray(content)) throw Error("INVALID_AEM_PAGE");
    const marked = { ...page, "jcr:content": { ...content, maestroMigrationId: jobId } };
    const expected = sha256(JSON.stringify(marked));
    const subset = (actual: unknown, wanted: unknown): boolean => {
      if (Array.isArray(wanted)) return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(wanted);
      if (wanted && typeof wanted === "object") return !!actual && typeof actual === "object" && Object.entries(wanted).every(([k,v]) => Object.hasOwn(actual, k) && subset((actual as Record<string, unknown>)[k], v));
      return actual === wanted;
    };
    const current = async () => { const actual = await this.json(path + ".infinity.json"); return actual ? subset(actual, marked) ? expected : "different-content" : undefined; };
    const parent = path.slice(0, path.lastIndexOf("/"));
    if (!await this.json(parent + ".1.json")) throw Error("AEM_PARENT_MISSING");
    return this.create(path, expected, current, () => {
      const body = new FormData();
      body.set(":operation", "import"); body.set(":contentType", "json"); body.set(":name", path.split("/").at(-1)!);
      body.set(":replace", "false"); body.set(":replaceProperties", "false"); body.set(":content", JSON.stringify(marked));
      return this.request(parent, { method: "POST", body });
    });
  }
  async createAsset(path: string, data: Uint8Array, mimeType: string, scope: string) {
    contentPath(path, scope);
    if (!/^image\/(?:png|jpeg|webp|gif|svg\+xml|avif)$/.test(mimeType) || !data.length || data.length > 20_000_000) throw Error("INVALID_ASSET");
    const parent = path.slice(0, path.lastIndexOf("/"));
    await this.ensureDamFolder(parent, scope);
    const original = path + "/jcr:content/renditions/original";
    return this.create(path, sha256(data), async () => {
      const node = await this.json(path + ".1.json");
      if (!node) return undefined;
      const value = await this.bytes(original); return value ? sha256(value) : "existing-asset-without-original";
    },
      () => this.request("/api/assets" + path.slice("/content/dam".length), { method: "POST", headers: { "Content-Type": mimeType }, body: Buffer.from(data) }), true);
  }
  private async ensureDamFolder(path: string, scope: string): Promise<void> {
    if (path !== scope) contentPath(path, scope);
    const node = await this.json(path + ".1.json");
    if (node) {
      if (!["sling:Folder", "sling:OrderedFolder", "nt:folder"].includes(String(node["jcr:primaryType"]))) throw Error("DAM_PARENT_IS_NOT_FOLDER");
      return;
    }
    if (path === scope) throw Error("DAM_ROOT_MISSING");
    await this.ensureDamFolder(path.slice(0, path.lastIndexOf("/")), scope);
    const expected = sha256("folder:" + path);
    await this.create(path, expected, async () => {
      const current = await this.json(path + ".1.json");
      return !current ? undefined : ["sling:Folder", "sling:OrderedFolder", "nt:folder"].includes(String(current["jcr:primaryType"])) ? expected : "not-a-folder";
    }, () => this.request("/api/assets" + path.slice("/content/dam".length), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ class: "assetFolder", properties: { "jcr:title": path.split("/").at(-1) } }) }));
  }
}
