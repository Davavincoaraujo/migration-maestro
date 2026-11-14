import { evaluateUeValidationGate } from "./integrations/ue-validation-gate.js";
const [componentPath, ...extra] = process.argv.slice(2);
if (!componentPath || extra.length || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(componentPath) || componentPath.length > 180) {
  process.stderr.write("Uso: npm run ue:gate -- caminho/relativo/do/componente\n");
  process.exitCode = 1;
} else {
  const result = await evaluateUeValidationGate(componentPath);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.cliSucceeded) process.exitCode = 2;
}
