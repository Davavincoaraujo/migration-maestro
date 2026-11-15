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
const unknown = (): CatalogField => ({ name: null, label: null, type: null, unresolved: true });
function helper(call: ts.CallExpression, constants: Map<string, string>): CatalogField[] | null {
  if (!ts.isIdentifier(call.expression)) return null;
  const fn = call.expression.text;
  const arg = (index: number) => literal(call.arguments[index], constants);
  const single = (name: string | null, label: string | null, type: string): CatalogField[] =>
    name ? [{ name, label, type }] : [unknown()];
  const tabs: Record<string, [string, string]> = {
    tabConteudo: ["tabConteudo", "Conteúdo"],
    tabAparencia: ["tabAparencia", "Aparência"],
    tabAvancado: ["tabAvancado", "Avançado"]
  };
  if (fn === "tab" && call.arguments.length === 2) return single(arg(0), arg(1), "tab");
  if (tabs[fn] && !call.arguments.length) return single(tabs[fn][0], tabs[fn][1], "tab");
  if (fn === "anchorField" && !call.arguments.length) return single("anchorId", "Âncora (identificador da seção)", "text");
  if (fn === "dividerField" && !call.arguments.length) return single("divisor", "Linha divisória acima da seção", "boolean");
  if (fn === "overlapField" && !call.arguments.length) return single("sobreposicao", "Encaixe com o banner acima", "select");
  if (fn === "layoutField" && call.arguments.length === 1) return single("layout", "Visual do legado (migração)", "select");
  if (fn === "dimensoesFields" && call.arguments.length === 2) {
    const name = arg(0), label = arg(1);
    return name && label ? [
      { name: name + "Largura", label: label + " · largura original (px)", type: "text" },
      { name: name + "Altura", label: label + " · altura original (px)", type: "text" }
    ] : [unknown()];
  }
  const types: Record<string, string> = {
    textField: "text", richTextField: "richtext", imageField: "asset",
    documentField: "asset", videoField: "asset", altField: "text",
    linkField: "aem-content", newTabField: "boolean", headingLevelField: "select"
  };
  if (types[fn]) {
    const name = arg(0);
    const label = fn === "newTabField" ? "Abrir o link em uma nova aba" :
      fn === "altField" && call.arguments.length === 1 ? "Descrição da imagem (texto alternativo)" : arg(1);
    return single(name, label, types[fn]);
  }
  return null;
}
function fields(expr: ts.Expression | undefined, constants: Map<string, string>): CatalogField[] {
  if (!expr) return [];
  if (!ts.isArrayLiteralExpression(expr)) return [unknown()];
  const output: CatalogField[] = [];
  for (const element of expr.elements) {
    if (ts.isSpreadElement(element)) {
      if (ts.isCallExpression(element.expression)) output.push(...(helper(element.expression, constants) ?? [unknown()]));
      else output.push(unknown());
      continue;
    }
    if (ts.isCallExpression(element)) {
      output.push(...(helper(element, constants) ?? [unknown()]));
      continue;
    }
    if (!ts.isObjectLiteralExpression(element)) {
      output.push(unknown());
      continue;
    }
    const nested = property(element, "fields");
    const field: CatalogField = {
      name: literal(property(element, "name"), constants),
      label: literal(property(element, "label"), constants),
      type: literal(property(element, "type"), constants)
    };
    if (nested) field.fields = fields(nested, constants);
    if (!field.name || !field.type || (nested && !ts.isArrayLiteralExpression(nested))) field.unresolved = true;
    output.push(field);
  }
  return output;
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
