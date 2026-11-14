import { readFileSync } from "node:fs";
import { extractUmlModel, renderUmlModel, umlSourceFiles } from "./uml-ast.js";

/** Compatibility entry point: always reads the current TypeScript source declarations. */
export function renderUmlClassDiagram(): string {
  const files = Object.fromEntries(umlSourceFiles.map(path => [
    path, readFileSync(new URL("../../" + path, import.meta.url), "utf8"),
  ]));
  return renderUmlModel(extractUmlModel(files));
}
