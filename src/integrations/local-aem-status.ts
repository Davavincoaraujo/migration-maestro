export interface LocalAemStatus {
  configured: boolean;
  state: "not-configured" | "reachable" | "authentication-required" | "unavailable";
  message: string;
}
/** Local-only, opt-in, read-only AEM reachability probe. Never reads or persists content. */
export async function checkLocalAem(env: NodeJS.ProcessEnv = process.env): Promise<LocalAemStatus> {
  const configured = env.MAESTRO_AEM_AUTHOR_URL;
  if (!configured) return { configured: false, state: "not-configured", message: "Configure o AEM local para verificar a conexão." };
  let url: URL;
  try {
    url = new URL(configured);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.port !== "4502" || url.username || url.password || url.search || url.hash ||
        !url.pathname.startsWith("/sites.html/content/")) throw new Error("Invalid AEM URL");
  } catch {
    return { configured: true, state: "unavailable", message: "Endereço AEM inválido. Use o Author local na porta 4502." };
  }
  // Probe a known non-mutating endpoint. The HTML response body is never consumed.
  const probe = new URL("/libs/granite/core/content/login.html", url.origin);
  try {
    const response = await fetch(probe, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(2500), headers: { Accept: "text/html" } });
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) {
      return { configured: true, state: "authentication-required", message: "AEM respondeu, mas exige autenticação." };
    }
    if (response.status >= 200 && response.status < 400) {
      return { configured: true, state: "reachable", message: "Servidor AEM local acessível. Acesso ao conteúdo ainda não foi verificado." };
    }
    return { configured: true, state: "unavailable", message: "AEM respondeu, mas a verificação não foi concluída." };
  } catch {
    return { configured: true, state: "unavailable", message: "AEM local indisponível. Verifique se o Author está iniciado na porta 4502." };
  }
}
