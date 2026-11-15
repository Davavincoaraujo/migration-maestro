import ts from "typescript";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export type CatalogField = {
  name: string | null; label: string | null; type: string | null;
  fields?: CatalogField[]; unresolved?: boolean;
};
export type CatalogComponent = {
  key: string; name: string; version: string; group: string;
  modelId: string | null; title: string | null; description: string | null;
  icon: string | null; singleton: boolean | null; minDsVersion: string | null;
  fields: CatalogField[]; unresolvedFields: number; hasMapper: boolean; path: string;
};
export type CatalogScan = {
  mode: "read-only"; source: string; total: number; components: CatalogComponent[];
  warnings: { path: string; reason: string }[];
};

function property(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
    if (key === name) return p.initializer;
  }
  return undefined;
}
function literal(expr: ts.Expression | undefined, constants: Map<string, string>): string | null {
  if (!expr) return null;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isIdentifier(expr)) return constants.get(expr.text) ?? null;
  return null;
}
function fields(expr: ts.Expression | undefined, constants: Map<string, string>): CatalogField[] {
  if (!expr) return [];
  if (!ts.isArrayLiteralExpression(expr)) return [{ name: null, label: null, type: null, unresolved: true }];
  return expr.elements.map(element => {
    if (!ts.isObjectLiteralExpression(element)) {
      return { name: null, label: null, type: null, unresolved: true };
    }
    const nested = property(element, "fields");
    const field: CatalogField = {
      name: literal(property(element, "name"), constants),
      label: literal(property(element, "label"), constants),
      type: literal(property(element, "type"), constants)
    };
    if (nested) field.fields = fields(nested, constants);
    if (!field.name || !field.type || (nested && !ts.isArrayLiteralExpression(nested)))
      field.unresolved = true;
    return field;
  });
}
function countUnresolved(items: CatalogField[]): number {
  return items.reduce((n, item) => n + (item.unresolved ? 1 : 0) + countUnresolved(item.fields ?? []), 0);
}
function parse(content: string, path: string, hasMapper: boolean): CatalogComponent | null {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics = ts.transpileModule(content, { fileName: path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } }).diagnostics ?? [];
  if (diagnostics.some(d => d.category === ts.DiagnosticCategory.Error)) throw Error("INVALID_TYPESCRIPT");
  const constants = new Map<string, string>();
  let definition: ts.ObjectLiteralExpression | null = null;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const value = decl.initializer;
      if (value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)))
        constants.set(decl.name.text, value.text);
      const annotated = decl.type?.getText(source).replace(/\s/g, "") === "ComponentDefinition";
      if (annotated && value && ts.isObjectLiteralExpression(value)) definition = value;
    }
  }
  if (!definition) return null;
  const obj = definition as ts.ObjectLiteralExpression;
  const name = literal(property(obj, "name"), constants);
  const group = literal(property(obj, "group"), constants);
  const version = literal(property(obj, "version"), constants);
  if (!name || !group || !version) throw Error("MISSING_COMPONENT_IDENTITY");
  const fieldList = fields(property(obj, "fields"), constants);
  const singleton = property(obj, "singleton");
  return {
    key: group + "/" + name + "@" + version, name, group, version,
    modelId: literal(property(obj, "modelId"), constants),
    title: literal(property(obj, "title"), constants),
    description: literal(property(obj, "description"), constants),
    icon: literal(property(obj, "icon"), constants),
    singleton: singleton?.kind === ts.SyntaxKind.TrueKeyword ? true :
      singleton?.kind === ts.SyntaxKind.FalseKeyword ? false : null,
    minDsVersion: literal(property(obj, "minDsVersion"), constants),
    fields: fieldList, unresolvedFields: countUnresolved(fieldList), hasMapper, path
  };
}
export async function scanHermesComponentCatalog(portalDirectory: string): Promise<CatalogScan> {
  const portal = resolve(portalDirectory);
  const info = await lstat(portal);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error("UNSAFE_PORTAL_DIRECTORY");
  const root = await realpath(portal);
  const componentsRoot = join(root, "src", "frontend", "components");
  const componentsInfo = await lstat(componentsRoot);
  if (!componentsInfo.isDirectory() || componentsInfo.isSymbolicLink()) throw Error("UNSAFE_COMPONENTS_DIRECTORY");
  const found: CatalogComponent[] = [];
  const warnings: CatalogScan["warnings"] = [];
  let scanned = 0;
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 20) throw Error("CATALOG_DEPTH_LIMIT");
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) { warnings.push({ path: relative(root, path), reason: "SYMLINK_SKIPPED" }); continue; }
      if (entry.isDirectory()) { await walk(path, depth + 1); continue; }
      if (!entry.isFile() || entry.name !== "definition.ts") continue;
      if (++scanned > 5000) throw Error("CATALOG_FILE_LIMIT");
      const pathInfo = await lstat(path);
      if (pathInfo.size > 512 * 1024) { warnings.push({ path: relative(root, path), reason: "FILE_TOO_LARGE" }); continue; }
      const source = await readFile(path, "utf8");
      const siblings = await readdir(dir);
      try {
        const component = parse(source, relative(root, path), siblings.includes("mapper.ts"));
        if (component) found.push(component);
        else warnings.push({ path: relative(root, path), reason: "DEFINITION_NOT_STATIC" });
      } catch (error) {
        warnings.push({ path: relative(root, path), reason: error instanceof Error ? error.message : "PARSE_FAILED" });
      }
    }
  }
  await walk(componentsRoot, 0);
  found.sort((a, b) => a.key.localeCompare(b.key));
  const seen = new Set<string>();
  for (const item of found) {
    if (seen.has(item.key)) warnings.push({ path: item.path, reason: "DUPLICATE_KEY:" + item.key });
    seen.add(item.key);
    if (item.unresolvedFields) warnings.push({ path: item.path, reason: "UNRESOLVED_FIELDS:" + item.unresolvedFields });
  }
  return { mode: "read-only", source: root, total: found.length, components: found, warnings };
}
