import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { UePatternConfig } from "./local-ue-pattern.js";
const validPath = /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/;
export interface Binding { catalogId: string; componentPath: string; }
export interface BindingManifest { bindings: Binding[]; }
export function parseBindingManifest(value: unknown): BindingManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_BINDINGS");
  const bindings = (value as { bindings?: unknown }).bindings;
  if (!Array.isArray(bindings) || bindings.length > 100) throw new Error("INVALID_BINDINGS");
  const ids = new Set<string>(), paths = new Set<string>();
  for (const entry of bindings) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("INVALID_BINDINGS");
    const b = entry as Record<string, unknown>;
    if (typeof b.catalogId !== "string" || !b.catalogId.trim() || b.catalogId.length > 200 ||
        typeof b.componentPath !== "string" || b.componentPath.length > 180 || !validPath.test(b.componentPath) ||
        ids.has(b.catalogId) || paths.has(b.componentPath)) throw new Error("INVALID_BINDINGS");
    ids.add(b.catalogId); paths.add(b.componentPath);
  }
  return { bindings: bindings.map(b => ({ catalogId: b.catalogId as string, componentPath: b.componentPath as string })) };
}
export async function readBindingManifest(file: string): Promise<BindingManifest> {
  const path = resolve(file), info = await stat(path);
  if (!info.isFile() || info.size > 16000) throw new Error("INVALID_BINDINGS");
  return parseBindingManifest(JSON.parse(await readFile(path, "utf8")));
}
function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}
/** Only the configured main project tree is trusted. No recursive scans or worktree fallback. */
export async function verifyBoundComponent(config: UePatternConfig, componentPath: string): Promise<boolean> {
  if (!validPath.test(componentPath) || componentPath.length > 180) return false;
  try {
    const root = await realpath(join(config.projectDirectory, "src", "frontend", "components"));
    const directory = await realpath(join(root, componentPath));
    if (!inside(root, directory) || directory.split(sep).includes(".claude")) return false;
    const definition = await realpath(join(directory, "definition.ts"));
    if (!inside(directory, definition) || !(await stat(definition)).isFile()) return false;
    return true;
  } catch { return false; }
}
