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
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const hints: Record<string, string> = {
        UE_PATTERN_DIRECTORY_NOT_FOUND: "Diretório do ue-pattern não encontrado. Confira MAESTRO_UE_PATTERN_DIR.",
        COMPONENT_PROJECT_DIRECTORY_NOT_FOUND: "Diretório de componentes não encontrado. Confira MAESTRO_COMPONENTS_PROJECT_DIR.",
        UE_PATTERN_CLI_NOT_BUILT: "CLI do ue-pattern ausente. Execute npm install && npm run build no ue-pattern.",
        UE_PATTERN_COMMAND_FAILED: "A CLI do ue-pattern retornou erro. Execute diretamente: node \"$MAESTRO_UE_PATTERN_DIR/dist/cli.js\" topicos --projeto \"$MAESTRO_COMPONENTS_PROJECT_DIR\".",
      };
      process.stderr.write((hints[code] ?? "Falha na consulta local ue-pattern. Confira permissões e configuração.") + "\n");
      process.exitCode = 1;
    }
  }
}
