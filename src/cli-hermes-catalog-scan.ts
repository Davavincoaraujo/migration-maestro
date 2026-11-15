import { scanHermesComponentCatalog } from "./integrations/hermes-component-catalog-adapter.js";

const [portal, ...extra] = process.argv.slice(2);
if (!portal || extra.length) {
  console.error("Uso: npm run hermes:catalog-scan -- /caminho/para/iibr-fed-portalbradesco");
  process.exitCode = 1;
} else {
  try {
    const result = await scanHermesComponentCatalog(portal);
    console.log(JSON.stringify(result, null, 2));
    if (result.warnings.some(w => w.reason.startsWith("DUPLICATE_KEY:"))) process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "CATALOG_SCAN_FAILED");
    process.exitCode = 1;
  }
}
