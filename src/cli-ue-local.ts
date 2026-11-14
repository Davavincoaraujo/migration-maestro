import { runUePatternReadOnly, uePatternConfig } from "./integrations/local-ue-pattern.js";

const config = uePatternConfig();
if (!config) {
  process.stderr.write("Configure MAESTRO_UE_PATTERN_DIR e MAESTRO_COMPONENTS_PROJECT_DIR no terminal local.\n");
  process.exitCode = 2;
} else {
  const [command, argument] = process.argv.slice(2);
  if (command !== "topicos" && command !== "buscar" && command !== "validar") {
    process.stderr.write("Uso: npm run ue:local -- topicos | buscar <consulta> | validar <componente>\n");
    process.exitCode = 2;
  } else {
    try {
      const result = await runUePatternReadOnly(config, command, argument);
      process.stdout.write(result.output + "\n");
    } catch {
      process.stderr.write("Falha na consulta local ue-pattern. Confira caminhos, build e permissões.\n");
      process.exitCode = 1;
    }
  }
}
