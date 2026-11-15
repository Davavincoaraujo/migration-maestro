import { runMaestriBridge } from "./maestro-maestri-bridge.js";
const [url, ...extra] = process.argv.slice(2);
if (!url || extra.length) {
  console.error('Uso: npm run maestri:run -- "https://exemplo.com/pagina"');
  process.exitCode = 1;
} else {
  try {
    console.log(JSON.stringify(await runMaestriBridge(url), null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "MAESTRI_BRIDGE_FAILED";
    console.error(/^[A-Z_]+$/.test(message) ? message : "MAESTRI_BRIDGE_FAILED");
    process.exitCode = 2;
  }
}
