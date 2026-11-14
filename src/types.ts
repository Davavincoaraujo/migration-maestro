export type Stage = "discover" | "analyze" | "transform" | "validate" | "review" | "publish";
export interface LegacyPage { path: string; title: string; body: string; }
export interface MigratedPage { path: string; title: string; components: Array<{ resourceType: string; props: Record<string, string> }>; }
export interface Finding { level: "error" | "warning"; message: string; }
export interface MigrationResult { source: LegacyPage; target: MigratedPage; findings: Finding[]; approved: boolean; }
export interface Agent<I, O> { name: string; run(input: I): Promise<O>; }
