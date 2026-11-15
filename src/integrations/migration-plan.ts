export type MigrationTask = { id: string; label: string; agent: string; dependsOn: string[]; status: "completed" | "review_required" | "pending" | "approval_required" };
export type MigrationPlan = { schemaVersion: 1; status: "review_required"; evidenceBlocks: number; tasks: MigrationTask[]; codeExecutionAuthorized: false; published: false };
/** Deterministic dependency graph. Evidence is not treated as a validated component specification. */
export function buildMigrationPlan(blocks: unknown[]): MigrationPlan {
 if (!Array.isArray(blocks) || blocks.length === 0) throw new Error("EMPTY_ANALYST_EVIDENCE");
 const tasks: MigrationTask[] = [
  { id: "evidence", label: "Coletar evidências da página", agent: "migration_analyst", dependsOn: [], status: "completed" },
  { id: "interpret", label: "Interpretar estrutura e componentes", agent: "planning_agent", dependsOn: ["evidence"], status: "review_required" },
  { id: "catalog", label: "Verificar reutilização no catálogo existente", agent: "component_catalog", dependsOn: ["interpret"], status: "pending" },
  { id: "ue_gate", label: "Validar padrões do Universal Editor", agent: "ue_pattern", dependsOn: ["catalog"], status: "pending" },
  { id: "spec", label: "Consolidar especificação e critérios de aceite", agent: "planning_agent", dependsOn: ["ue_gate"], status: "pending" },
  { id: "implementation", label: "Executar alterações em worktree isolada", agent: "coding_agent", dependsOn: ["spec"], status: "approval_required" },
  { id: "qa", label: "Executar verificações e testes", agent: "qa_agent", dependsOn: ["implementation"], status: "pending" },
  { id: "pr", label: "Preparar pull request para revisão", agent: "review_agent", dependsOn: ["qa"], status: "approval_required" }
 ];
 return { schemaVersion: 1, status: "review_required", evidenceBlocks: blocks.length, tasks, codeExecutionAuthorized: false, published: false };
}
