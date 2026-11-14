/** Local AEM Author read-only metadata connector. No content persistence, writes, redirects or remote hosts. */
export interface AemPageSummary { name: string; title: string; hasContent: boolean; }
export interface AemPagesResult {
  state: "not-configured" | "credentials-required" | "connected" | "authentication-failed" | "unavailable";
  message: string;
  root: string;
  pages: AemPageSummary[];
  truncated: boolean;
}
export function parseAemAuthorUrl(value: string): { origin: string; root: string } {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.port !== "4502" || url.username || url.password || url.search || url.hash ||
      !/^\/sites\.html\/content\/[a-zA-Z0-9_/-]+$/.test(url.pathname) ||
      url.pathname.includes("//") || url.pathname.split("/").includes("..")) {
    throw new Error("Invalid local AEM Author URL");
  }
  return { origin: url.origin, root: url.pathname.replace(/^\/sites\.html/, "") };
}
function metadata(value: unknown): AemPageSummary[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid AEM metadata");
  const nodes = Object.entries(value as Record<string, unknown>);
  const result: AemPageSummary[] = [];
  for (const [name, node] of nodes) {
    if (result.length === 100) break;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(name) || !node || typeof node !== "object" || Array.isArray(node)) continue;
    const obj = node as Record<string, unknown>;
    if (obj["jcr:primaryType"] !== "cq:Page") continue;
    const content = obj["jcr:content"];
    const props = content && typeof content === "object" && !Array.isArray(content) ? content as Record<string, unknown> : {};
    const title = typeof props["jcr:title"] === "string" ? props["jcr:title"].slice(0, 120) : name;
    result.push({ name, title, hasContent: Boolean(content) });
  }
  return result;
}
export async function readLocalAemPages(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Promise<AemPagesResult> {
  const value = env.MAESTRO_AEM_AUTHOR_URL;
  const empty = (state: AemPagesResult["state"], message: string, root = ""): AemPagesResult =>
    ({ state, message, root, pages: [], truncated: false });
  if (!value) return empty("not-configured", "Configure o endereço do AEM Author local.");
  let author: ReturnType<typeof parseAemAuthorUrl>;
  try { author = parseAemAuthorUrl(value); }
  catch { return empty("unavailable", "Endereço AEM inválido. Use localhost:4502/sites.html/content/...", ""); }
  const user = env.MAESTRO_AEM_USER, password = env.MAESTRO_AEM_PASSWORD;
  if (!user || !password) return empty("credentials-required", "Configure as credenciais de leitura apenas no ambiente local.", author.root);
  // Only fetch direct children of the explicitly configured root; never follow redirects.
  const endpoint = author.origin + author.root + ".1.json";
  try {
    const response = await fetcher(endpoint, {
      method: "GET", redirect: "manual", signal: AbortSignal.timeout(4000),
      headers: { Accept: "application/json", Authorization: "Basic " + Buffer.from(user + ":" + password).toString("base64") },
    });
    if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel();
      return empty("authentication-failed", "AEM exige autenticação válida ou acesso autorizado à pasta.", author.root);
    }
    if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("json")) {
      await response.body?.cancel();
      return empty("unavailable", "Não foi possível consultar os metadados das páginas.", author.root);
    }
    // Bound payload size before parsing; never expose or store raw AEM JSON.
    const limit = 512_000;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > limit) { await response.body?.cancel(); return empty("unavailable", "Resposta AEM excede o limite de leitura.", author.root); }
    const reader = response.body?.getReader();
    if (!reader) return empty("unavailable", "AEM retornou resposta vazia.", author.root);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > limit) { await reader.cancel(); return empty("unavailable", "Resposta AEM excede o limite de leitura.", author.root); }
        chunks.push(chunk);
      }
    } finally { reader.releaseLock(); }
    const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const pages = metadata(raw);
    return { state: "connected", message: "Metadados consultados no AEM Author local (somente leitura).", root: author.root, pages, truncated: pages.length === 100 };
  } catch {
    return empty("unavailable", "Não foi possível consultar o AEM local. Confira conexão e permissões.", author.root);
  }
}
